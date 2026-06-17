/**
 * Stellar Global Supplies — Data Ingest Lambda
 *
 * Handles the EXACT file formats exported from the SGS accounting system:
 *   Sales_.csv / Purchase.csv — Summary registers (6-7 columns)
 *   Item_sales.csv / Items_Purchase.csv — Line-item registers (10 columns)
 *   Customers.csv / Suppliers.csv — Master files (skipped, reference only)
 *
 * SGS CSV format: row 0 = company header, subsequent rows without a digit
 * in col[0] are sub-headers. Data rows always have a digit in col[0] (SR.NO).
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { S3Event, S3Handler } from 'aws-lambda';
import { Readable } from 'stream';
import { createInterface } from 'readline';

const REGION         = process.env.AWS_REGION    ?? 'ap-south-1';
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE!;
const BATCH_SIZE     = 25;

const s3  = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

type SGSFileType = 'sales_register'|'purchase_register'|'item_sales'|'item_purchase'|'master'|'json';

function detectFileType(key: string): SGSFileType {
  const k = key.toLowerCase();
  if (k.includes('item_sales') || k.includes('item-sales'))  return 'item_sales';
  if (k.includes('item') && (k.includes('purchase')||k.includes('purch'))) return 'item_purchase';
  if (k.includes('sales_') || /\/sales\./.test(k)) return 'sales_register';
  if (k.includes('purchase') || k.includes('purch')) return 'purchase_register';
  if (k.includes('customer') || k.includes('supplier')) return 'master';
  if (k.endsWith('.json')) return 'json';
  return 'sales_register';
}

function split(line: string): string[] {
  const out: string[] = [];
  let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else { inQ=!inQ; } }
    else if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  out.push(cur.trim()); return out;
}

const cleanAmt = (s: string|undefined): number => { const n = parseFloat(String(s??'').replace(/,/g,'').replace(/\s/g,'')); return isNaN(n)?0:n; };
function findDataRow(dataCols: string[]): string[] | null {
  const idx = dataCols.findIndex(v =>
    /^\d+$/.test(String(v).trim())
  );

  if (idx === -1) return null;

  return dataCols.slice(idx);
}
const slugify  = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);

function parseDate(s: string|undefined): string {
  if (!s) return '';
  const t = s.trim();
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,10);
  return t;
}

function ym(isoDate: string): string { return isoDate.slice(0,7).replace('-',''); }

function makeSaleRow(c: string[], src: string): Record<string,unknown>|null {
  // SR | INV_NO | DATE | PARTY | TYPE | AMOUNT
  const inv = c[1]?.trim(); const d = parseDate(c[2]); const party = c[3]?.trim(); const amt = cleanAmt(c[5]);
  if (!inv||!d||!party||amt===0) return null;
  const m=ym(d); const slug=slugify(party); const dISO=`${d}T00:00:00Z`;
  return { PK:`SALE#${m}`,SK:`INV#${inv}`,GSI1PK:`CUSTOMER#${slug}`,GSI1SK:`DATE#${dISO}`,GSI2PK:`TYPE#SALE`,GSI2SK:`DATE#${dISO}`,entityType:'SALE',invoice_id:inv,date:d,customer_name:party,total_amount:amt,source_key:src,ingested_at:new Date().toISOString() };
}

function makePurchRow(c: string[], src: string): Record<string,unknown>|null {
  // SR | INV_ID | INV_NO | DATE | PARTY | TYPE | AMOUNT
  const inv = c[2]?.trim(); const d = parseDate(c[3]); const party = c[4]?.trim(); const amt = cleanAmt(c[6]);
  if (!inv||!d||!party||amt===0) return null;
  const m=ym(d); const slug=slugify(party); const dISO=`${d}T00:00:00Z`;
  return { PK:`PO#${m}`,SK:`PO#${inv}`,GSI1PK:`VENDOR#${slug}`,GSI1SK:`DATE#${dISO}`,GSI2PK:`TYPE#PURCHASE`,GSI2SK:`DATE#${dISO}`,entityType:'PURCHASE',invoice_no:inv,date:d,vendor_name:party,total_amount:amt,source_key:src,ingested_at:new Date().toISOString() };
}

function makeItemSaleRow(c: string[], src: string): Record<string,unknown>|null {
  // SR | INV_NO | DATE | CUSTOMER | ITEM | QTY | BASE | GST% | GST_AMT | TOTAL
  const inv=c[1]?.trim(); const d=parseDate(c[2]); const cust=c[3]?.trim(); const item=c[4]?.trim();
  const base=cleanAmt(c[6]); const gst=cleanAmt(c[8]); const total=cleanAmt(c[9]);
  if (!inv||!d||!item||base===0) return null;
  const m=ym(d); const skuSlug=slugify(item).toUpperCase().slice(0,40); const custSlug=slugify(cust??''); const dISO=`${d}T00:00:00Z`;
  return { PK:`SALE#${m}`,SK:`ITEM#${inv}#${skuSlug}`,GSI1PK:`CUSTOMER#${custSlug}`,GSI1SK:`DATE#${dISO}`,GSI2PK:`SKU#${skuSlug}`,GSI2SK:`DATE#${dISO}`,entityType:'SALE_ITEM',invoice_no:inv,date:d,customer_name:cust,product_sku:item,quantity:c[5]?.trim(),base_amount:base,gst_amount:gst,total_amount:total,source_key:src,ingested_at:new Date().toISOString() };
}

function makeItemPurchRow(c: string[], src: string): Record<string,unknown>|null {
  // SR | INV_NO | DATE | SUPPLIER | ITEM | QTY | BASE | GST% | GST_AMT | TOTAL
  const inv=c[1]?.trim(); const d=parseDate(c[2]); const sup=c[3]?.trim(); const item=c[4]?.trim();
  const base=cleanAmt(c[6]); const gst=cleanAmt(c[8]); const total=cleanAmt(c[9]);
  if (!inv||!d||!item||base===0) return null;
  const m=ym(d); const skuSlug=slugify(item).toUpperCase().slice(0,40); const supSlug=slugify(sup??''); const dISO=`${d}T00:00:00Z`;
  return { PK:`PO#${m}`,SK:`ITEM#${inv}#${skuSlug}`,GSI1PK:`VENDOR#${supSlug}`,GSI1SK:`DATE#${dISO}`,GSI2PK:`SKU#${skuSlug}`,GSI2SK:`DATE#${dISO}`,entityType:'PURCHASE_ITEM',invoice_no:inv,date:d,vendor_name:sup,product_sku:item,quantity:c[5]?.trim(),base_amount:base,gst_amount:gst,total_amount:total,source_key:src,ingested_at:new Date().toISOString() };
}

async function* streamCSV(
  body: Readable,
  ft: SGSFileType,
  src: string
): AsyncGenerator<Record<string, unknown>> {

  const rl = createInterface({
    input: body,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;

    const cols = split(t);

    const dataCols = findDataRow(cols);
    console.log("RAW COLS:", cols.slice(0, 15));
    console.log("DATA COLS:", dataCols?.slice(0, 15));
    if (!dataCols) continue;

    let row: Record<string, unknown> | null = null;

    if (ft === 'sales_register') {
      row = makeSaleRow(dataCols, src);
    } else if (ft === 'purchase_register') {
      row = makePurchRow(dataCols, src);
    } else if (ft === 'item_sales') {
      row = makeItemSaleRow(dataCols, src);
    } else if (ft === 'item_purchase') {
      row = makeItemPurchRow(dataCols, src);
    }

    if (row) {
      yield row;
    }
  }
}

async function* streamJSON(body: Readable): AsyncGenerator<Record<string,unknown>> {
  let raw = ''; for await (const c of body) raw += (c as Buffer).toString('utf-8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error('JSON must be array');
  for (const r of arr) yield r as Record<string,unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function flush(items: Record<string,unknown>[]): Promise<void> {
  if (!items.length) return;
  // Cast required: DynamoDB SDK's BatchWriteCommand has a complex union type
  // that doesn't accept plain Record<string,unknown>; the doc client handles marshalling at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rem: any[] = items.map(i => ({ PutRequest: { Item: i } })); let att = 0;
  while (rem.length && att < 5) {
    const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [DYNAMODB_TABLE]: rem } }));
    const unp = res.UnprocessedItems?.[DYNAMODB_TABLE];
    if (!unp?.length) break;
    rem = unp; att++;
    await new Promise(r => setTimeout(r, Math.min(100*2**att,2000)));
  }
}

async function updateSnapshot(month: string, ic: number, rev: number): Promise<void> {
  const yyyy=month.slice(0,4); const mm=month.slice(4,6);
  await ddb.send(new UpdateCommand({
    TableName: DYNAMODB_TABLE,
    Key: { PK:`ANALYTICS#${month}`, SK:'SNAP#revenue' },
    UpdateExpression: 'SET entityType=:et,#mo=:mo,GSI1PK=:g1pk,GSI1SK=:g1sk,invoice_count=if_not_exists(invoice_count,:z)+:ic,total_revenue=if_not_exists(total_revenue,:z)+:rev,updated_at=:now',
    ExpressionAttributeNames: { '#mo':'month' },
    ExpressionAttributeValues: { ':et':'ANALYTICS',':mo':`${yyyy}-${mm}`,':g1pk':'TYPE#revenue',':g1sk':`DATE#${yyyy}-${mm}-01T00:00:00Z`,':ic':ic,':rev':rev,':z':0,':now':new Date().toISOString() },
  }));
}

export const handler: S3Handler = async (event: S3Event) => {
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key    = decodeURIComponent(rec.s3.object.key.replace(/\+/g,' '));
    const ft     = detectFileType(key);

    if (ft === 'master') { console.info('[ingest] Skipping master file', key); continue; }

    let body: Readable;
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket:bucket, Key:key }));
      if (!r.Body) { console.error('[ingest] Empty body', key); continue; }
      body = r.Body as Readable;
    } catch (e) { console.error('[ingest] S3 error', key, e); continue; }

    const gen = ft==='json' ? streamJSON(body) : streamCSV(body, ft, key);
    let buf: Record<string,unknown>[] = [];
    let written = 0;
    const mDeltas = new Map<string,{ic:number;rev:number}>();

    try {
      for await (const item of gen) {
        buf.push(item);
        if (ft==='sales_register'||ft==='purchase_register') {
          const pk = String(item.PK??'');
          const m  = pk.replace('SALE#','').replace('PO#','');
          if (/^\d{6}$/.test(m)) {
            const ex = mDeltas.get(m) ?? {ic:0,rev:0};
            mDeltas.set(m,{ic:ex.ic+1,rev:ex.rev+(Number(item.total_amount)||0)});
          }
        }
        if (buf.length>=BATCH_SIZE) { await flush(buf); written+=buf.length; buf=[]; }
      }
      if (buf.length) { await flush(buf); written+=buf.length; }
    } catch (e) {
      if (buf.length) { try { await flush(buf); written+=buf.length; } catch{} }
      throw e;
    }

    for (const [m,d] of mDeltas) {
      try { await updateSnapshot(m,d.ic,d.rev); } catch(e) { console.error('[ingest] snapshot err',m,e); }
    }

    console.info('[ingest] Done', { key, ft, written });
  }
};
