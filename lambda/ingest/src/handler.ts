/**
 * Stellar Global Supplies - Supabase data ingest Lambda.
 *
 * The SGS accounting exports repeat report headers on every row and sometimes
 * include embedded newlines in master records. This parser reads complete CSV
 * records, finds the actual data columns, and upserts only to Supabase.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Event, S3Handler } from 'aws-lambda';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const BATCH_SIZE = Number(process.env.SUPABASE_BATCH_SIZE ?? 500);

const s3 = new S3Client({ region: REGION });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type SGSFileType =
  | 'sales_register'
  | 'purchase_register'
  | 'item_sales'
  | 'item_purchase'
  | 'customers'
  | 'suppliers'
  | 'json';

type TableName =
  | 'ingestion_files'
  | 'customers'
  | 'suppliers'
  | 'sales'
  | 'purchases'
  | 'sales_items'
  | 'purchase_items';

interface ParsedRecord {
  table: TableName;
  row: Record<string, unknown>;
}

function detectFileType(key: string): SGSFileType {
  const k = key.toLowerCase();
  if (k.endsWith('.json')) return 'json';
  if (k.includes('customer')) return 'customers';
  if (k.includes('supplier')) return 'suppliers';
  if (k.includes('item') && k.includes('sale')) return 'item_sales';
  if (k.includes('item') && (k.includes('purchase') || k.includes('purch'))) return 'item_purchase';
  if (k.includes('purchase') || k.includes('purch')) return 'purchase_register';
  if (k.includes('sale')) return 'sales_register';
  return 'sales_register';
}

async function readBody(body: Readable): Promise<string> {
  let raw = '';
  for await (const chunk of body) {
    raw += (chunk as Buffer).toString('utf8');
  }
  return raw.replace(/^\uFEFF/, '');
}

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some((value) => value !== '')) records.push(row);
  return records;
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLine(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean) ?? '';
}

function cleanAmount(value: unknown): number {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function parseQuantity(value: unknown): { quantity: number; unit: string } {
  const raw = cleanText(value);
  const match = raw.match(/(-?[\d,.]+)\s*(.*)$/);
  if (!match) return { quantity: 0, unit: '' };
  return {
    quantity: cleanAmount(match[1]),
    unit: match[2].trim().toUpperCase(),
  };
}

function materialType(itemName: unknown): string {
  const name = cleanText(itemName).toUpperCase();
  if (name.startsWith('SS') || name.includes(' STAINLESS')) return 'SS';
  if (name.startsWith('MS') || name.includes(' MILD STEEL')) return 'MS';
  if (name.includes('FREIGHT') || name.includes('LOADING')) return 'SERVICE';
  return 'OTHER';
}

function rowKey(parts: unknown[]): string {
  return createHash('sha256')
    .update(parts.map((part) => cleanText(part)).join('|'))
    .digest('hex');
}

function firstDataIndex(record: string[]): number {
  return record.findIndex((value) => /^\d+$/.test(cleanText(value)));
}

function parseMaster(record: string[], sourceFile: string, type: 'customers' | 'suppliers'): ParsedRecord | null {
  const idx = firstDataIndex(record);
  if (idx < 0) return null;

  const name = firstLine(record[idx + 1]);
  if (!name || /^customer details|supplier details$/i.test(name)) return null;

  const gst = record.map(cleanText).find((value) => /\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]/.test(value));
  const table = type === 'customers' ? 'customers' : 'suppliers';
  const nameColumn = type === 'customers' ? 'customer_name' : 'supplier_name';

  return {
    table,
    row: {
      [nameColumn]: name,
      gstin: gst ?? null,
      source_file: sourceFile,
    },
  };
}

function parseSalesRegister(record: string[], sourceFile: string): ParsedRecord | null {
  const idx = firstDataIndex(record);
  if (idx < 0) return null;

  const invoiceNo = cleanText(record[idx + 1]);
  const invoiceDate = parseDate(record[idx + 2]);
  const customerName = cleanText(record[idx + 3]);
  const amount = cleanAmount(record[idx + 5]);

  if (!invoiceNo || !invoiceDate || !customerName || amount <= 0) return null;

  return {
    table: 'sales',
    row: {
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      customer_name: customerName,
      invoice_type: cleanText(record[idx + 4]) || null,
      total_amount: amount,
      source_file: sourceFile,
    },
  };
}

function parsePurchaseRegister(record: string[], sourceFile: string): ParsedRecord | null {
  const idx = firstDataIndex(record);
  if (idx < 0) return null;

  const invoiceId = cleanText(record[idx + 1]);
  const invoiceNo = cleanText(record[idx + 2]);
  const invoiceDate = parseDate(record[idx + 3]);
  const supplierName = cleanText(record[idx + 4]);
  const amount = cleanAmount(record[idx + 6]);

  if (!invoiceNo || !invoiceDate || !supplierName || amount <= 0) return null;

  return {
    table: 'purchases',
    row: {
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      supplier_name: supplierName,
      invoice_id: invoiceId || null,
      invoice_type: cleanText(record[idx + 5]) || null,
      total_amount: amount,
      source_file: sourceFile,
    },
  };
}

function parseSalesItem(record: string[], sourceFile: string): ParsedRecord | null {
  const idx = firstDataIndex(record);
  if (idx < 0) return null;

  const invoiceNo = cleanText(record[idx + 1]);
  const invoiceDate = parseDate(record[idx + 2]);
  const customerName = cleanText(record[idx + 3]);
  const itemName = cleanText(record[idx + 4]);
  const quantity = parseQuantity(record[idx + 5]);
  const baseAmount = cleanAmount(record[idx + 6]);
  const gstRate = cleanAmount(record[idx + 7]);
  const gstAmount = cleanAmount(record[idx + 8]);
  const totalAmount = cleanAmount(record[idx + 9]);

  if (!invoiceNo || !invoiceDate || !itemName || totalAmount <= 0) return null;

  return {
    table: 'sales_items',
    row: {
      row_key: rowKey([sourceFile, invoiceNo, invoiceDate, customerName, itemName, record[idx], totalAmount]),
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      customer_name: customerName,
      item_name: itemName,
      quantity: quantity.quantity,
      unit: quantity.unit,
      material_type: materialType(itemName),
      base_amount: baseAmount,
      gst_rate: gstRate,
      gst_amount: gstAmount,
      total_amount: totalAmount,
      source_file: sourceFile,
    },
  };
}

function parsePurchaseItem(record: string[], sourceFile: string): ParsedRecord | null {
  const idx = firstDataIndex(record);
  if (idx < 0) return null;

  const invoiceNo = cleanText(record[idx + 1]);
  const invoiceDate = parseDate(record[idx + 2]);
  const supplierName = cleanText(record[idx + 3]);
  const itemName = cleanText(record[idx + 4]);
  const quantity = parseQuantity(record[idx + 5]);
  const baseAmount = cleanAmount(record[idx + 6]);
  const gstRate = cleanAmount(record[idx + 7]);
  const gstAmount = cleanAmount(record[idx + 8]);
  const totalAmount = cleanAmount(record[idx + 9]);

  if (!invoiceNo || !invoiceDate || !itemName || totalAmount <= 0) return null;

  return {
    table: 'purchase_items',
    row: {
      row_key: rowKey([sourceFile, invoiceNo, invoiceDate, supplierName, itemName, record[idx], totalAmount]),
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      supplier_name: supplierName,
      item_name: itemName,
      quantity: quantity.quantity,
      unit: quantity.unit,
      material_type: materialType(itemName),
      base_amount: baseAmount,
      gst_rate: gstRate,
      gst_amount: gstAmount,
      total_amount: totalAmount,
      source_file: sourceFile,
    },
  };
}

function parseRecord(record: string[], fileType: SGSFileType, sourceFile: string): ParsedRecord | null {
  switch (fileType) {
    case 'customers':
      return parseMaster(record, sourceFile, 'customers');
    case 'suppliers':
      return parseMaster(record, sourceFile, 'suppliers');
    case 'sales_register':
      return parseSalesRegister(record, sourceFile);
    case 'purchase_register':
      return parsePurchaseRegister(record, sourceFile);
    case 'item_sales':
      return parseSalesItem(record, sourceFile);
    case 'item_purchase':
      return parsePurchaseItem(record, sourceFile);
    case 'json':
      return null;
  }
}

function conflictColumn(table: TableName): string {
  switch (table) {
    case 'customers':
      return 'customer_name';
    case 'suppliers':
      return 'supplier_name';
    case 'sales':
    case 'purchases':
      return 'invoice_no';
    case 'sales_items':
    case 'purchase_items':
      return 'row_key';
    case 'ingestion_files':
      return 'source_file';
  }
}

async function upsertRows(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictColumn(table) });

    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

function groupByTable(records: ParsedRecord[]): Map<TableName, Record<string, unknown>[]> {
  const grouped = new Map<TableName, Record<string, unknown>[]>();
  for (const record of records) {
    const rows = grouped.get(record.table) ?? [];
    rows.push(record.row);
    grouped.set(record.table, rows);
  }
  return grouped;
}

export const handler: S3Handler = async (event: S3Event) => {
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));
    const fileType = detectFileType(key);

    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!object.Body) throw new Error(`S3 object has no body: ${key}`);

    const raw = await readBody(object.Body as Readable);
    const records = parseCsv(raw)
      .map((record) => parseRecord(record, fileType, key))
      .filter((record): record is ParsedRecord => record !== null);

    const startedAt = new Date().toISOString();

    try {
      const grouped = groupByTable(records);
      for (const [table, rows] of grouped) {
        await upsertRows(table, rows);
      }

      await upsertRows('ingestion_files', [{
        source_file: key,
        bucket,
        file_type: fileType,
        row_count: records.length,
        status: 'complete',
        error_message: null,
        ingested_at: startedAt,
      }]);

      console.info('[ingest] complete', { key, fileType, rows: records.length });
    } catch (error) {
      await upsertRows('ingestion_files', [{
        source_file: key,
        bucket,
        file_type: fileType,
        row_count: records.length,
        status: 'error',
        error_message: error instanceof Error ? error.message : String(error),
        ingested_at: startedAt,
      }]);
      throw error;
    }
  }
};
