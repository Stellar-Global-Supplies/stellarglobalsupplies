import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, ConverseCommand, type ConverseRequest } from '@aws-sdk/client-bedrock-runtime';
import { createClient } from '@supabase/supabase-js';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const REGION         = process.env.AWS_REGION       ?? 'us-east-1';
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE!;
const GOOGLE_CLIENT_ID_PARAM     = process.env.GOOGLE_CLIENT_ID_PARAM!;
const GOOGLE_CLIENT_SECRET_PARAM = process.env.GOOGLE_CLIENT_SECRET_PARAM!;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN   ?? '*';
const BEDROCK_MODEL  = process.env.BEDROCK_MODEL    ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const ANALYTICS_BUCKET    = process.env.ANALYTICS_BUCKET ?? 'stellar-analytics-reports-471112840461';
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const s3Analytics = new S3Client({ region: REGION });
let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient(): ReturnType<typeof createClient> {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase environment variables are missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on agent-router.');
  }
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return supabaseClient;
}

// Message TTL: 30 days
const MESSAGE_TTL_SECONDS = 30 * 24 * 60 * 60;

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions:   { removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});

const ssm = new SSMClient({ region: REGION });

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
interface AgentProfile {
  agent_id:    string;
  name:        string;
  role:        string;
  description: string;
  color:       string;
  icon:        string;
  model:       string;
  created_at:  string;
}

interface ChatMessageRecord {
  PK:         string;
  SK:         string;
  GSI1PK:     string;
  GSI1SK:     string;
  entityType: 'MESSAGE';
  session_id: string;
  message_id: string;
  role:       'user' | 'assistant';
  content:    string;
  timestamp:  string;
  ttl:        number;
}

interface BusinessContext {
  recent_sales_summary:   string;
  purchase_summary:       string;
  profit_summary:         string;
  gst_summary:            string;
  top_skus:               string;
  top_customers:          string;
  top_suppliers:          string;
  monthly_revenue:        string;
  material_split:         string;
  item_margin:            string;
  total_records_ingested: number;
}

interface ChatRequest {
  session_id?: string;
  message:     string;
  user_id:     string;
}

interface ChatResponse {
  session_id:   string;
  message_id:   string;
  content:      string;
  agent_id:     string;
  timestamp:    string;
  context_used: {
    sales_records:   number;
    recent_invoices: number;
    analytics_snap:  boolean;
    google_tools_used?: string[];
  };
}

interface AnalyticsSummary {
  period:            string;
  total_revenue:     number;
  total_purchase:    number;
  gross_profit:      number;
  gross_margin_pct:  number;
  total_invoices:    number;
  avg_invoice_value: number;
  customer_count:    number;
  supplier_count:    number;
  top_customers:     TopCustomer[];
  top_suppliers:     TopSupplier[];
  top_skus:          TopSKU[];
  revenue_by_month:  MonthlyRevenue[];
  business_by_month: MonthlyBusiness[];
  gst_by_month:      MonthlyGST[];
  item_margin:       ItemMargin[];
  material_split:    { SS: number; MS: number; SERVICE?: number; OTHER?: number };
  growth_rate:       number;
}

interface TopCustomer  { customer_name: string; total_revenue: number; invoice_count: number; }
interface TopSupplier  { supplier_name: string; total_purchase: number; invoice_count: number; }
interface TopSKU       { sku: string; total_revenue: number; total_qty: number; material_type: string; }
interface MonthlyRevenue { month: string; revenue: number; invoices: number; }
interface MonthlyBusiness {
  month: string;
  sales: number;
  purchases: number;
  gross_profit: number;
  gross_margin_pct: number;
  sales_invoices: number;
  purchase_invoices: number;
}
interface MonthlyGST { month: string; output_gst: number; input_gst: number; net_gst: number; }
interface ItemMargin {
  item_name: string;
  sales_qty: number;
  purchase_qty: number;
  sales_amount: number;
  purchase_amount: number;
  gross_profit: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared Bedrock client (lazy, cached across warm invocations)
// ────────────────────────────────────────────────────────────────────────────
let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (bedrockClient) return bedrockClient;

  bedrockClient = new BedrockRuntimeClient({ region: REGION });
  return bedrockClient;
}

// ────────────────────────────────────────────────────────────────────────────
// Google OAuth — token storage, refresh, and API helpers
// (Used by the Executive Assistant agent for Calendar + Gmail access)
// ────────────────────────────────────────────────────────────────────────────
interface GoogleTokenItem {
  PK:            string;
  SK:            string;
  entityType:    'GOOGLE_TOKEN';
  refresh_token: string;
  scope:         string;
  google_email?: string;
  connected_at:  string;
}

let cachedGoogleClientId:     string | null = null;
let cachedGoogleClientSecret: string | null = null;

async function getGoogleOAuthCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  if (cachedGoogleClientId && cachedGoogleClientSecret) {
    return { clientId: cachedGoogleClientId, clientSecret: cachedGoogleClientSecret };
  }

  const [idResult, secretResult] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: GOOGLE_CLIENT_ID_PARAM, WithDecryption: true })),
    ssm.send(new GetParameterCommand({ Name: GOOGLE_CLIENT_SECRET_PARAM, WithDecryption: true })),
  ]);

  const clientId     = idResult.Parameter?.Value;
  const clientSecret = secretResult.Parameter?.Value;
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured.');

  cachedGoogleClientId     = clientId;
  cachedGoogleClientSecret = clientSecret;
  return { clientId, clientSecret };
}

async function getGoogleTokenItem(userId: string): Promise<GoogleTokenItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key:       { PK: `USER#${userId}`, SK: 'GOOGLE_TOKEN#v0' },
    }),
  );
  return (result.Item as GoogleTokenItem) ?? null;
}

/**
 * Exchanges the stored refresh token for a short-lived access token.
 * Returns null if the user has not connected their Google account, or if
 * the refresh token has been revoked.
 */
async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const tokenItem = await getGoogleTokenItem(userId);
  if (!tokenItem?.refresh_token) return null;

  const { clientId, clientSecret } = await getGoogleOAuthCredentials();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: tokenItem.refresh_token,
      grant_type:    'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    console.error('[agent-router] Google token refresh failed', { status: res.status });
    return null;
  }

  const json = await res.json() as { access_token?: string };
  return json.access_token ?? null;
}

// ── Calendar API ──────────────────────────────────────────────────────────
interface CalendarEventInput {
  summary:     string;
  description?: string;
  start:       string; // ISO 8601 datetime
  end:         string; // ISO 8601 datetime
  attendees?:  string[];
  location?:   string;
  timeZone?:   string;
}

async function createCalendarEvent(accessToken: string, input: CalendarEventInput): Promise<{ id: string; htmlLink: string }> {
  const tz = input.timeZone ?? 'Asia/Kolkata';

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary:     input.summary,
      description: input.description,
      location:    input.location,
      start: { dateTime: input.start, timeZone: tz },
      end:   { dateTime: input.end,   timeZone: tz },
      attendees: input.attendees?.map((email) => ({ email })),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Calendar event creation failed (${res.status}): ${errBody}`);
  }

  const json = await res.json() as { id: string; htmlLink: string };
  return { id: json.id, htmlLink: json.htmlLink };
}

async function listUpcomingEvents(accessToken: string, maxResults = 10): Promise<string[]> {
  const params = new URLSearchParams({
    timeMin:      new Date().toISOString(),
    maxResults:   String(maxResults),
    singleEvents: 'true',
    orderBy:      'startTime',
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) throw new Error(`Calendar list failed (${res.status})`);

  const json = await res.json() as {
    items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }>;
  };

  return (json.items ?? []).map((e) => {
    const start = e.start?.dateTime ?? e.start?.date ?? 'unknown';
    return `${e.summary ?? '(no title)'} — ${start}`;
  });
}

// ── Gmail API ─────────────────────────────────────────────────────────────
function buildRawEmail(to: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendGmailMessage(accessToken: string, to: string, subject: string, body: string): Promise<{ id: string }> {
  const raw = buildRawEmail(to, subject, body);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${errBody}`);
  }

  const json = await res.json() as { id: string };
  return { id: json.id };
}

async function listRecentEmails(accessToken: string, maxResults = 5): Promise<string[]> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);

  const listJson = await listRes.json() as { messages?: Array<{ id: string }> };
  const ids = (listJson.messages ?? []).map((m) => m.id);

  const summaries: string[] = [];
  for (const id of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) continue;

    const msgJson = await msgRes.json() as {
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const headers = msgJson.payload?.headers ?? [];
    const from    = headers.find((h) => h.name === 'From')?.value ?? 'unknown';
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)';

    summaries.push(`From: ${from} | Subject: ${subject} | ${msgJson.snippet ?? ''}`);
  }

  return summaries;
}

// ────────────────────────────────────────────────────────────────────────────
// Bedrock tool definitions (Claude function calling format)
// ────────────────────────────────────────────────────────────────────────────
const GOOGLE_TOOLS = [
  {
    name: 'create_calendar_event',
    description: 'Creates a new event on the user\'s primary Google Calendar. Use this when the user asks to schedule a meeting, touchpoint, or calendar event.',
    input_schema: {
      type: 'object',
      properties: {
        summary:     { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Event description / agenda notes' },
        start:       { type: 'string', description: 'Start datetime in ISO 8601 format, e.g. 2026-06-15T10:00:00+05:30' },
        end:         { type: 'string', description: 'End datetime in ISO 8601 format, e.g. 2026-06-15T11:00:00+05:30' },
        attendees:   { type: 'array', items: { type: 'string' }, description: 'List of attendee email addresses' },
        location:    { type: 'string', description: 'Event location (optional, can be a video call link)' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'list_upcoming_calendar_events',
    description: 'Lists the user\'s upcoming events on their primary Google Calendar. Use this to check availability before scheduling, or to summarise the week ahead.',
    input_schema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Maximum number of events to return (default 10)' },
      },
    },
  },
  {
    name: 'send_email',
    description: 'Sends an email from the user\'s Gmail account. Use this when the user explicitly asks to send a follow-up email, synopsis, or message to a client.',
    input_schema: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body:    { type: 'string', description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_recent_emails',
    description: 'Lists recent emails from the user\'s Gmail inbox (sender, subject, snippet). Use this to build meeting synopses or summarise recent client communication.',
    input_schema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Maximum number of emails to return (default 5)' },
      },
    },
  },
];

/**
 * Executes a Bedrock/Claude function call against the live Google APIs.
 * Returns a plain-object result suitable for feeding back to Bedrock as a
 * tool_result part.
 */
async function executeGoogleTool(
  name: string,
  args: Record<string, unknown>,
  accessToken: string,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'create_calendar_event': {
      const result = await createCalendarEvent(accessToken, {
        summary:     String(args.summary ?? ''),
        description: args.description ? String(args.description) : undefined,
        start:       String(args.start ?? ''),
        end:         String(args.end ?? ''),
        attendees:   Array.isArray(args.attendees) ? args.attendees.map(String) : undefined,
        location:    args.location ? String(args.location) : undefined,
      });
      return { success: true, event_id: result.id, link: result.htmlLink };
    }

    case 'list_upcoming_calendar_events': {
      const events = await listUpcomingEvents(accessToken, Number(args.max_results ?? 10));
      return { success: true, events };
    }

    case 'send_email': {
      const result = await sendGmailMessage(
        accessToken,
        String(args.to ?? ''),
        String(args.subject ?? ''),
        String(args.body ?? ''),
      );
      return { success: true, message_id: result.id };
    }

    case 'list_recent_emails': {
      const emails = await listRecentEmails(accessToken, Number(args.max_results ?? 5));
      return { success: true, emails };
    }

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CORS helpers
// ────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json',
};

function respond(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body:    JSON.stringify(body),
  };
}

function parseBody<T>(event: APIGatewayProxyEventV2): T | null {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// DynamoDB helpers
// ────────────────────────────────────────────────────────────────────────────
async function getAgentProfile(agentId: string): Promise<AgentProfile | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key:       { PK: `AGENT#${agentId}`, SK: 'PROFILE#v0' },
    }),
  );
  return (result.Item as AgentProfile) ?? null;
}

async function listAllAgents(): Promise<AgentProfile[]> {
  // Scan for all AGENT# PKs (single scan covers all 6 agents in one call)
  const scanResult = await ddb.send(
    new ScanCommand({
      TableName:                 DYNAMODB_TABLE,
      FilterExpression:          'begins_with(PK, :prefix) AND SK = :sk',
      ExpressionAttributeValues: {
        ':prefix': 'AGENT#',
        ':sk':     'PROFILE#v0',
      },
      ProjectionExpression: 'agent_id, #nm, #rl, description, color, icon, model, created_at',
      ExpressionAttributeNames: { '#nm': 'name', '#rl': 'role' },
    }),
  );

  return (scanResult.Items ?? []) as AgentProfile[];
}

async function getSessionMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName:                 DYNAMODB_TABLE,
      KeyConditionExpression:    'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk':       `SESSION#${sessionId}`,
        ':skPrefix': 'MSG#',
      },
      ScanIndexForward: true,  // ascending by SK (chronological)
      Limit:            40,    // cap history to last 40 messages to stay within context
    }),
  );
  return (result.Items ?? []) as ChatMessageRecord[];
}

// Callers supply GSI1PK/GSI1SK directly so the correct agentId is used.
async function persistMessage(msg: Omit<ChatMessageRecord, 'PK' | 'SK' | 'ttl'>): Promise<void> {
  const record: ChatMessageRecord = {
    ...msg,
    PK:  `SESSION#${msg.session_id}`,
    SK:  `MSG#${msg.timestamp}#${msg.message_id}`,
    ttl: Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS,
  };

  await ddb.send(
    new PutCommand({ TableName: DYNAMODB_TABLE, Item: record }),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Business context retrieval
// Pulls real business data from Supabase and formats it into a grounding block.
// ────────────────────────────────────────────────────────────────────────────
async function fetchBusinessContext(): Promise<{ ctx: BusinessContext; meta: { sales_records: number; recent_invoices: number; analytics_snap: boolean } }> {
  const supabase = getSupabaseClient();
  const [
    summaryResult,
    customersResult,
    skusResult,
    suppliersResult,
    businessResult,
    gstResult,
    materialResult,
    marginResult,
  ] = await Promise.all([
    supabase.from('analytics_summary').select('*').single(),
    supabase.from('top_customers').select('*').limit(5),
    supabase.from('top_skus').select('*').limit(5),
    supabase.from('top_suppliers').select('*').limit(5),
    supabase.from('monthly_business').select('*').order('month', { ascending: false }).limit(6),
    supabase.from('monthly_gst').select('*').order('month', { ascending: false }).limit(6),
    supabase.from('material_split').select('*'),
    supabase.from('item_margin').select('*').limit(5),
  ]);

  const firstError = [
    summaryResult.error,
    customersResult.error,
    skusResult.error,
    suppliersResult.error,
    businessResult.error,
    gstResult.error,
    materialResult.error,
    marginResult.error,
  ].find(Boolean);

  if (firstError) {
    throw new Error(`Supabase business context query failed: ${firstError.message}`);
  }

  const summary = summaryResult.data as {
    total_revenue?: number | string;
    total_purchase?: number | string;
    gross_profit?: number | string;
    customer_count?: number;
    supplier_count?: number;
    total_invoices?: number;
    avg_invoice_value?: number | string;
  } | null;

  const totalRevenue = Number(summary?.total_revenue ?? 0);
  const totalPurchase = Number(summary?.total_purchase ?? 0);
  const grossProfit = Number(summary?.gross_profit ?? 0);
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const totalInvoices = Number(summary?.total_invoices ?? 0);
  const avgInvoice = Number(summary?.avg_invoice_value ?? 0);

  const topCustomers = (customersResult.data ?? [])
    .map((row) => `${row.customer_name} (₹${Number(row.total_revenue ?? 0).toFixed(0)}, ${Number(row.invoice_count ?? 0)} invoices)`);

  const topSKUs = (skusResult.data ?? [])
    .map((row) => `${row.sku} [${row.material_type ?? 'OTHER'}] - ₹${Number(row.total_revenue ?? 0).toFixed(0)}, ${Number(row.total_qty ?? 0).toFixed(2)} units`);

  const topSuppliers = (suppliersResult.data ?? [])
    .map((row) => `${row.supplier_name} (₹${Number(row.total_purchase ?? 0).toFixed(0)}, ${Number(row.invoice_count ?? 0)} invoices)`);

  const businessRows = [...(businessResult.data ?? [])]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));

  const monthlyLines = businessRows.map((row) =>
    `${row.month}: sales ₹${Number(row.sales ?? 0).toFixed(0)}, purchases ₹${Number(row.purchases ?? 0).toFixed(0)}, GP ₹${Number(row.gross_profit ?? 0).toFixed(0)} (${Number(row.gross_margin_pct ?? 0).toFixed(1)}%)`,
  );

  const latestGst = [...(gstResult.data ?? [])]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)))
    .at(-1);

  const materialLines = (materialResult.data ?? [])
    .map((row) => `${row.material_type}: ₹${Number(row.total_revenue ?? 0).toFixed(0)}`);

  const marginLines = (marginResult.data ?? [])
    .map((row) => `${row.item_name}: sales ₹${Number(row.sales_amount ?? 0).toFixed(0)}, purchases ₹${Number(row.purchase_amount ?? 0).toFixed(0)}, GP ₹${Number(row.gross_profit ?? 0).toFixed(0)}`);

  const hasSnap = businessRows.length > 0;

  return {
    ctx: {
      recent_sales_summary:   totalInvoices > 0
        ? `${totalInvoices} sales invoices analysed from Supabase. Total revenue: ₹${totalRevenue.toFixed(2)}. Average invoice value: ₹${avgInvoice.toFixed(2)}. Active customers: ${Number(summary?.customer_count ?? 0)}.`
        : 'No sales records have been ingested yet. Ask the user to upload a sales CSV via the Data Ingest section.',

      purchase_summary:       totalPurchase > 0
        ? `Total purchases: ₹${totalPurchase.toFixed(2)} from ${Number(summary?.supplier_count ?? 0)} suppliers.`
        : 'No purchase records have been ingested yet.',

      profit_summary:         `Gross profit: ₹${grossProfit.toFixed(2)}. Gross margin: ${grossMargin.toFixed(2)}%.`,

      gst_summary:            latestGst
        ? `Latest GST month ${latestGst.month}: output GST ₹${Number(latestGst.output_gst ?? 0).toFixed(2)}, input GST ₹${Number(latestGst.input_gst ?? 0).toFixed(2)}, net GST ₹${Number(latestGst.net_gst ?? 0).toFixed(2)}.`
        : 'No GST line-item data available yet.',

      top_skus:               topSKUs.length > 0
        ? topSKUs.join('\n')
        : 'No SKU data available yet.',

      top_customers:          topCustomers.length > 0
        ? topCustomers.join('\n')
        : 'No customer data available yet.',

      top_suppliers:          topSuppliers.length > 0
        ? topSuppliers.join('\n')
        : 'No supplier data available yet.',

      monthly_revenue:        monthlyLines.length > 0
        ? monthlyLines.join('\n')
        : 'No monthly Supabase analytics available yet.',

      material_split:         materialLines.length > 0
        ? materialLines.join(' | ')
        : 'No material split available yet.',

      item_margin:            marginLines.length > 0
        ? marginLines.join('\n')
        : 'No item margin data available yet.',

      total_records_ingested: totalInvoices,
    },
    meta: {
      sales_records:   totalInvoices,
      recent_invoices: Math.min(totalInvoices, 20),
      analytics_snap:  hasSnap,
    },
  };
}

function emptyBusinessContext(reason: string): { ctx: BusinessContext; meta: { sales_records: number; recent_invoices: number; analytics_snap: boolean } } {
  return {
    ctx: {
      recent_sales_summary: `Supabase business context is unavailable: ${reason}`,
      purchase_summary: 'Purchase data unavailable.',
      profit_summary: 'Profit data unavailable.',
      gst_summary: 'GST data unavailable.',
      top_skus: 'SKU data unavailable.',
      top_customers: 'Customer data unavailable.',
      top_suppliers: 'Supplier data unavailable.',
      monthly_revenue: 'Monthly revenue unavailable.',
      material_split: 'Material split unavailable.',
      item_margin: 'Item margin unavailable.',
      total_records_ingested: 0,
    },
    meta: {
      sales_records: 0,
      recent_invoices: 0,
      analytics_snap: false,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Agent system prompts
// ────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(agent: AgentProfile, ctx: BusinessContext): string {
  const liveDataSource = ctx.total_records_ingested > 0 ? 'live Supabase records' : 'FY 2025-26 uploaded business data (Sales, Purchase, Item registers)';

  const BASE = `
You are ${agent.name}, an expert AI agent inside the operations control center of Stellar Global Supplies (stellarglobalsupplies.com), a B2B supplier of Stainless Steel (SS) and Mild Steel (MS) products, Survey No. 169, Talawade, Pune — Maharashtra, India. Contact: 9637655556.

You have two sources of knowledge:
1. Your own training knowledge (general business, industry, and domain expertise)
2. Live business data from ${liveDataSource} (provided below)

Use BOTH sources. For internal company metrics, quote the specific numbers from the data below. For general business questions, industry context, best practices, or explanations, use your training knowledge freely. Never fabricate internal data — if a specific figure is unavailable in the data below, say so and suggest the next step.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STELLAR GLOBAL SUPPLIES — FY 2025–26 REAL BUSINESS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE KPIs:
${ctx.recent_sales_summary}
${ctx.purchase_summary}
${ctx.profit_summary}
${ctx.gst_summary}

TOP CUSTOMERS (by revenue):
${ctx.top_customers}

TOP PRODUCT SKUs:
${ctx.top_skus}

ITEM MARGIN SIGNALS:
${ctx.item_margin}

MONTHLY P&L TREND:
${ctx.monthly_revenue}

MATERIAL SPLIT:
${ctx.material_split}

TOP SUPPLIERS:
${ctx.top_suppliers}

KEY RISKS (data-driven):
1. Watch customer concentration in the Top Customers section.
2. Watch low or negative item-level gross profit in Item Margin Signals.
3. Watch supplier concentration in the Top Suppliers section.
4. Watch negative gross profit months in Monthly P&L Trend.

KEY OPPORTUNITIES (data-driven):
1. Scale items with strong positive gross profit in Item Margin Signals.
2. Upsell repeat customers visible in Top Customers.
3. Renegotiate items with weak spread between sales and purchases.
4. Use the active customer count in Headline KPIs to size acquisition headroom.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your role: ${agent.description}

Response rules:
- Lead with the most important insight using real numbers.
- Use ## headers for multi-section responses.
- Use tables for comparisons. ₹ lakh notation (₹X.XL) for large amounts.
- Be direct — management needs decisions, not summaries.
- Always end with 1–3 specific, numbered action items.
`.trim();

  const ROLE_ADDENDUM: Record<string, string> = {
    'sales-analyst': `
ANALYST FOCUS:
• Price trend analysis using the monthly P&L data above
• SKU velocity and margin analysis using Top Product SKUs and Item Margin Signals
• Customer concentration analysis using Top Customers
• Supplier concentration and purchase dependency using Top Suppliers
• Recommend margin improvement levers from Supabase item margin data`,

    'sales-strategist': `
STRATEGY FOCUS:
• Customer diversification is the #1 priority when Top Customers show concentration
• Target new enterprise accounts in manufacturing, construction, prefab segments
• Upsell repeat buyers shown in Top Customers to higher-margin items
• Re-engage one-time high-value buyers when visible in customer data
• Pricing recommendations must reference Item Margin Signals
• When designing outreach, reference our actual product SKUs and delivery track record`,

    'business-analyst': `
OPERATIONS FOCUS:
• Gross margin and purchase totals come from Headline KPIs
• Purchasing concentration comes from Top Suppliers
• Invoice velocity comes from sales invoice count and purchase summary
• Working capital signals come from negative GP months in Monthly P&L Trend
• EBITDA analysis: current data covers GM only; request overhead cost data for full picture`,

    'cloud-engineer': `
CLOUD FOCUS:
• This ops center runs on: API Gateway (HTTP v2) → Lambda (Node 22) → Supabase business data → Gemini AI
• S3 hosts frontend (CloudFront OAC) and data uploads (raw-ingest/); all private buckets
• DynamoDB remains for agent profiles, chat history, and Google OAuth tokens
• Supabase stores ingested sales, purchases, item rows, customers, suppliers, and analytics views
• Lambda functions: presign (256MB/10s), ingest (512MB/300s), agent-router (512MB/30s), google-auth (256MB/15s)
• Report on latency, error rates, and cost estimates based on current traffic patterns`,

    'demand-forecasting': `
DEMAND FORECASTING FOCUS:
• Analyze historical sales trends from Monthly P&L Trend and Top Product SKUs to predict future demand
• Consider Indian market conditions: monsoon season impact (Jun-Sep), festival seasons (Diwali, Dussehra), construction cycles
• Factor in Indian economic indicators: GDP growth, infrastructure spending, manufacturing PMI, steel import/export trends
• Account for regional factors: Maharashtra industrial growth, Pune MIDC expansion, real estate development
• Seasonal patterns: Q4 (Jan-Mar) typically strong for construction, Q2 (Jul-Sep) slower due to monsoons
• Material-specific forecasting: SS demand driven by food processing, pharma; MS by construction, manufacturing
• Use customer concentration data to assess demand stability vs. volatility risk
• Incorporate supplier lead times and inventory planning for procurement optimization
• Reference actual SKU velocity and margin data to prioritize high-value forecasts
• Consider macroeconomic factors: interest rates affecting construction, government infrastructure budgets
• Provide confidence intervals and risk scenarios (optimistic, realistic, pessimistic) for all forecasts
• Recommend inventory levels, procurement timing, and pricing strategies based on demand predictions`,

    'marketing-manager': `
MARKETING FOCUS:
• Use REAL product data: SS 202 Golden Mirror Finish Sheet, GI Sheets, MS Channels, Pipes, Tools
• Target audiences: procurement managers at manufacturing firms, construction companies, prefab builders
• Highlight: Stellar Global Supplies' location in Pune's MIDC industrial hub — credibility signal
• Key differentiators to promote: stock availability, range (SS + MS + Tools + Equipment), Pune delivery

LIVE WEBSITE & META ANALYTICS (from daily S3 data feed — USE THIS DATA IN ALL RECOMMENDATIONS):
WEEKLY (last 7 days):
• Total requests: 5,075 | Unique IPs: 451 | Real human visitors (high-intent): 49
• Top country: Netherlands 42% | Italy 12% | USA 11%
• Retargetable warm audience on Meta: 1,522 users
• SECURITY WARNING: /.env probed 44x, /.git/config probed 29x this week — automated scanners

MONTHLY (last 30 days):
• Total requests: 15,439 | Unique IPs: 1,499 | Real human visitors (high-intent): 83
• Top country: USA 34% | Netherlands 17% | Other 14% | India 5% | Singapore 5%
• Retargetable warm audience on Meta: 4,631 users
• Traffic spikes: May 24 (1,794 req), Jun 8 (1,410), Jun 2 (1,401) — likely bot sweeps, NOT real customers

META AD INTELLIGENCE:
• Recommended campaign objective: Brand Awareness
• Best ad placement: Feed + Right Column
• Best posting/ad time: 00:00–03:00 UTC = 05:30–08:30 IST (early morning India)
• Top geo targets for ads: USA, Netherlands, India (home market — separate INR campaign)
• High-intent retarget pool: 83 users (monthly) — small but qualified

KEY MARKETING INSIGHTS:
• 100% desktop traffic, 0% mobile = website has NO mobile optimisation → critical fix needed
• Homepage is the ONLY real content page (1,993 monthly visits) — product pages missing
• India represents only 5% of traffic despite being home market — local SEO/campaigns underinvested
• Bot traffic is ~99% of raw requests — do not use raw request count in any marketing reports
• Warm audience of 4,631 on Meta is retargetable NOW for B2B awareness campaign

MULTI-PLATFORM SOCIAL MEDIA STRATEGY:

📘 FACEBOOK:
• B2B industrial content for steel buyers, procurement managers, construction companies
• Long-form posts (500-800 chars) with product showcases, project highlights, customer testimonials
• Facebook Groups: target steel traders, construction professionals, manufacturing groups
• Facebook Marketplace: list excess inventory, special offers, bulk discounts
• Video content: factory tours, product demonstrations, customer site visits
• Event promotion: trade shows, exhibitions, industry meets in Pune/Mumbai
• Lead gen ads: gated content (catalogs, price lists, technical specs) for lead capture

📸 INSTAGRAM:
• Visual-first: high-quality product photos, infographics, behind-the-scenes content
• Reels: 60-second product demos, steel applications, "Did You Know?" educational content
• Stories: daily stock updates, new arrivals, customer spotlights, poll questions
• Carousel posts: "5 types of stainless steel sheets explained", "MS vs SS comparison"
• Hashtags: #StainlessSteel #MildSteel #PuneIndustry #B2BSteel #SteelSuppliers #IndustrialSteel #MetalFabrication
• IGTV: detailed product tutorials, installation guides, industry insights
• Shopping tags: tag products for direct inquiry (not direct sales — B2B model)

🐦 TWITTER/X:
• Real-time industry news sharing, steel price updates, government policy changes
• Thread format: "10 things to consider when buying stainless steel for your project"
• Engage with: @MakeInIndia, @CMOMaharashtra, industry influencers
• Quick tips, infographics, poll questions to drive engagement
• Customer service: respond to queries, share delivery updates

💼 LINKEDIN:
• B2B thought leadership: industry trends, market analysis, company growth stories
• Long-form articles (1300-2000 words): "Impact of GST on steel procurement", "Pune's manufacturing boom"
• Company page updates: new product launches, capacity expansions, team achievements
• Employee advocacy: encourage sales team to share content
• LinkedIn Articles: technical content on steel grades, applications, best practices
• Polls and surveys: "What's your biggest challenge in steel procurement?"

🎥 YOUTUBE:
• Product showcase videos: detailed specs, applications, comparisons
• Factory/warehouse tours: show inventory capacity, quality control processes
• Customer testimonial videos: case studies, project completions
• Educational series: "Steel 101" for new buyers, "How to choose the right steel grade"
• Live Q&A sessions: monthly sessions with technical team
• SEO-optimized titles: include keywords like "stainless steel supplier Pune", "MS channels manufacturer"

📱 WHATSAPP BUSINESS:
• Customer support: quick responses to inquiries, order status updates
• Broadcast lists: new product alerts, special offers, price change notifications
• Catalog sharing: digital product catalogs with pricing
• Order placement: enable WhatsApp orders for quick purchases
• Customer feedback: post-delivery satisfaction surveys

📧 EMAIL MARKETING:
• Monthly newsletters: industry insights, company updates, new products
• Drip campaigns: welcome series for new leads, nurture sequences
• Transactional emails: order confirmations, delivery updates, invoices
• Re-engagement campaigns: win back inactive customers
• Seasonal campaigns: festival offers, year-end deals, monsoon specials

When creating content for ANY platform:
• Always reference real SGS products and verified analytics data
• Tailor tone and format to platform (casual for Instagram, professional for LinkedIn)
• Use the warm audience data (4,631 Meta users) for retargeting campaigns
• Focus on India market (5% traffic) with separate INR campaigns
• Address the mobile gap — create mobile-first content despite 0% mobile traffic
• Create product page content — homepage is the only real page (1,993 visits/month)
• Never use raw bot traffic numbers — focus on 83 real high-intent visitors/month`,

    'executive-assistant': `
EXECUTIVE SUPPORT FOCUS:
• Schedule monthly P&L reviews using the Supabase Monthly P&L Trend
• Key meetings should be based on Top Customers and Top Suppliers
• Follow-up priorities should reference customer revenue and invoice count
• Supplier reviews should use purchase concentration and item margin signals
• Draft communications in professional B2B tone appropriate for Pune manufacturing sector
• All calendar events default to IST (Asia/Kolkata) timezone`,
  };

  const addendum = ROLE_ADDENDUM[agent.role] ?? '';
  return `${BASE}${addendum ? '\n\n' + addendum.trim() : ''}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Route: GET /agents
// ────────────────────────────────────────────────────────────────────────────
async function handleListAgents(): Promise<APIGatewayProxyResultV2> {
  try {
    const agents = await listAllAgents();
    return respond(200, agents);
  } catch (err) {
    console.error('[agent-router] listAgents error', err);
    return respond(500, { error: 'Failed to list agents.' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Route: GET /analytics/summary
// ────────────────────────────────────────────────────────────────────────────
async function handleAnalyticsSummary(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const supabase = getSupabaseClient();
    const monthsStr = event.queryStringParameters?.months ?? '6';
    const months    = Math.min(Math.max(parseInt(monthsStr, 10) || 6, 1), 24);

    const [
      summaryResult,
      customersResult,
      skusResult,
      suppliersResult,
      revenueResult,
      businessResult,
      gstResult,
      materialResult,
      marginResult,
    ] = await Promise.all([
      supabase.from('analytics_summary').select('*').single(),
      supabase.from('top_customers').select('*').limit(10),
      supabase.from('top_skus').select('*').limit(10),
      supabase.from('top_suppliers').select('*').limit(10),
      supabase.from('monthly_revenue').select('*').order('month', { ascending: false }).limit(months),
      supabase.from('monthly_business').select('*').order('month', { ascending: false }).limit(months),
      supabase.from('monthly_gst').select('*').order('month', { ascending: false }).limit(months),
      supabase.from('material_split').select('*'),
      supabase.from('item_margin').select('*').limit(10),
    ]);

    const firstError = [
      summaryResult.error,
      customersResult.error,
      skusResult.error,
      suppliersResult.error,
      revenueResult.error,
      businessResult.error,
      gstResult.error,
      materialResult.error,
      marginResult.error,
    ].find(Boolean);

    if (firstError) {
      throw new Error(`Supabase analytics query failed: ${firstError.message}`);
    }

    const byMonthAsc = <T extends { month: string }>(rows: T[] | null) =>
      [...(rows ?? [])].sort((a, b) => a.month.localeCompare(b.month));

    const revenueByMonth: MonthlyRevenue[] = byMonthAsc(revenueResult.data).map((row) => ({
      month: row.month,
      revenue: Number(row.revenue ?? 0),
      invoices: Number(row.invoices ?? 0),
    }));

    const businessByMonth: MonthlyBusiness[] = byMonthAsc(businessResult.data).map((row) => ({
      month: row.month,
      sales: Number(row.sales ?? 0),
      purchases: Number(row.purchases ?? 0),
      gross_profit: Number(row.gross_profit ?? 0),
      gross_margin_pct: Number(row.gross_margin_pct ?? 0),
      sales_invoices: Number(row.sales_invoices ?? 0),
      purchase_invoices: Number(row.purchase_invoices ?? 0),
    }));

    const gstByMonth: MonthlyGST[] = byMonthAsc(gstResult.data).map((row) => ({
      month: row.month,
      output_gst: Number(row.output_gst ?? 0),
      input_gst: Number(row.input_gst ?? 0),
      net_gst: Number(row.net_gst ?? 0),
    }));

    const totalRevenue = Number(summaryResult.data?.total_revenue ?? 0);
    const totalPurchase = Number(summaryResult.data?.total_purchase ?? 0);
    const grossProfit = Number(summaryResult.data?.gross_profit ?? 0);
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const topCustomers: TopCustomer[] = (customersResult.data ?? []).map((row) => ({
      customer_name: row.customer_name,
      total_revenue: Number(row.total_revenue ?? 0),
      invoice_count: Number(row.invoice_count ?? 0),
    }));

    const topSKUs: TopSKU[] = (skusResult.data ?? []).map((row) => ({
      sku: row.sku,
      total_revenue: Number(row.total_revenue ?? 0),
      total_qty: Number(row.total_qty ?? 0),
      material_type: row.material_type ?? 'OTHER',
    }));

    const topSuppliers: TopSupplier[] = (suppliersResult.data ?? []).map((row) => ({
      supplier_name: row.supplier_name,
      total_purchase: Number(row.total_purchase ?? 0),
      invoice_count: Number(row.invoice_count ?? 0),
    }));

    const itemMargin: ItemMargin[] = (marginResult.data ?? []).map((row) => ({
      item_name: row.item_name,
      sales_qty: Number(row.sales_qty ?? 0),
      purchase_qty: Number(row.purchase_qty ?? 0),
      sales_amount: Number(row.sales_amount ?? 0),
      purchase_amount: Number(row.purchase_amount ?? 0),
      gross_profit: Number(row.gross_profit ?? 0),
    }));

    const materialSplit = (materialResult.data ?? []).reduce(
      (acc, row) => {
        const key = String(row.material_type ?? 'OTHER') as keyof AnalyticsSummary['material_split'];
        acc[key] = (acc[key] ?? 0) + Number(row.total_revenue ?? 0);
        return acc;
      },
      { SS: 0, MS: 0, SERVICE: 0, OTHER: 0 } as AnalyticsSummary['material_split'],
    );

    const firstMonth = businessByMonth.at(0);
    const lastMonth = businessByMonth.at(-1);
    const growthRate =
      firstMonth && lastMonth && firstMonth.sales > 0
        ? ((lastMonth.sales - firstMonth.sales) / firstMonth.sales) * 100
        : 0;

    const period = revenueByMonth.length > 0
      ? `${revenueByMonth[0].month} to ${revenueByMonth[revenueByMonth.length - 1].month}`
      : `Last ${months} months`;

    const summary: AnalyticsSummary = {
      period,
      total_revenue:     totalRevenue,
      total_purchase:    totalPurchase,
      gross_profit:      grossProfit,
      gross_margin_pct:  grossMarginPct,
      total_invoices:    Number(summaryResult.data?.total_invoices ?? 0),
      avg_invoice_value: Number(summaryResult.data?.avg_invoice_value ?? 0),
      customer_count:    Number(summaryResult.data?.customer_count ?? 0),
      supplier_count:    Number(summaryResult.data?.supplier_count ?? 0),
      top_customers:     topCustomers,
      top_suppliers:     topSuppliers,
      top_skus:          topSKUs,
      revenue_by_month:  revenueByMonth,
      business_by_month: businessByMonth,
      gst_by_month:      gstByMonth,
      item_margin:       itemMargin,
      material_split:    materialSplit,
      growth_rate:       growthRate,
    };

    return respond(200, summary);
  } catch (err) {
    console.error('[agent-router] analyticsSummary error', err);
    return respond(500, { error: 'Failed to compute analytics summary.' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Route: GET /auth/google/status
// ────────────────────────────────────────────────────────────────────────────
async function handleGoogleStatus(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) {
    return respond(400, { error: '`user_id` query parameter is required.' });
  }

  try {
    const tokenItem = await getGoogleTokenItem(userId);
    return respond(200, {
      connected:    !!tokenItem,
      google_email: tokenItem?.google_email ?? null,
      connected_at: tokenItem?.connected_at ?? null,
      scope:        tokenItem?.scope ?? null,
    });
  } catch (err) {
    console.error('[agent-router] googleStatus error', err);
    return respond(500, { error: 'Failed to check Google connection status.' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Route: POST /auth/google/disconnect
// ────────────────────────────────────────────────────────────────────────────
async function handleGoogleDisconnect(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<{ user_id?: string }>(event);
  const userId = body?.user_id;
  if (!userId) {
    return respond(400, { error: '`user_id` is required in the request body.' });
  }

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: DYNAMODB_TABLE,
        Key:       { PK: `USER#${userId}`, SK: 'GOOGLE_TOKEN#v0' },
      }),
    );
    return respond(200, { success: true });
  } catch (err) {
    console.error('[agent-router] googleDisconnect error', err);
    return respond(500, { error: 'Failed to disconnect Google account.' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Route: POST /agents/{agentId}/chat
// ────────────────────────────────────────────────────────────────────────────
async function handleAgentChat(
  agentId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<ChatRequest>(event);
  if (!body) {
    return respond(400, { error: 'Request body is required and must be valid JSON.' });
  }

  const { session_id, message, user_id } = body;

  if (!message?.trim()) {
    return respond(400, { error: '`message` is required and must be non-empty.' });
  }
  if (!user_id?.trim()) {
    return respond(400, { error: '`user_id` is required.' });
  }

  // Resolve or create session ID
  const sessionId = session_id ?? `${agentId}_${randomUUID()}`;
  const now       = new Date().toISOString();

  // ── 1. Load agent profile ────────────────────────────────────────────────
  const agent = await getAgentProfile(agentId);
  if (!agent) {
    return respond(404, { error: `Agent "${agentId}" not found.` });
  }

  // ── 2. Fetch live business context ──────────────────────────────────────
  let businessContext: Awaited<ReturnType<typeof fetchBusinessContext>>;
  try {
    businessContext = await fetchBusinessContext();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent-router] Supabase business context unavailable', err);
    businessContext = emptyBusinessContext(message);
  }
  const { ctx, meta } = businessContext;

  // ── 3. Load session message history ─────────────────────────────────────
  const historyRecords = await getSessionMessages(sessionId);

  // ── 4. Persist user message ──────────────────────────────────────────────
  const userMsgId = randomUUID();
  await persistMessage({
    entityType: 'MESSAGE',
    session_id: sessionId,
    message_id: userMsgId,
    role:       'user',
    content:    message.trim(),
    timestamp:  now,
    GSI1PK:     `AGENT#${agentId}`,
    GSI1SK:     `TS#${now}`,
  });

  // ── 5. Build Bedrock message history ────────────────────────────────────
  // Convert DynamoDB history to Bedrock Converse format
  const bedrockMessages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }> = historyRecords.map((m) => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: [{ text: m.content }],
  }));

  // ── 6. Call Bedrock API ──────────────────────────────────────────────────
  let assistantContent = '';
  let toolsUsed: string[] = [];

  try {
    const bedrock       = getBedrockClient();
    const systemPrompt  = buildSystemPrompt(agent, ctx);

    const isExecutiveAssistant = agent.role === 'executive-assistant';
    let googleAccessToken: string | null = null;
    let googleConnected = false;

    if (isExecutiveAssistant) {
      googleAccessToken = await getGoogleAccessToken(user_id);
      googleConnected   = !!googleAccessToken;
    }

    // Append a note about Google connection status to the system prompt so
    // the agent knows whether it can actually call Calendar/Gmail tools.
    const googleNote = isExecutiveAssistant
      ? googleConnected
        ? '\n\nThe user has connected their personal Google account. You MAY use the create_calendar_event, list_upcoming_calendar_events, send_email, and list_recent_emails tools to take real action when the user asks for it. Always confirm what you did (e.g. share the calendar event link, confirm the email was sent).'
        : '\n\nThe user has NOT connected their Google account yet. You cannot create calendar events or send emails. If the user asks you to do so, politely explain they need to click "Connect Google Account" in the Executive Assistant panel first, and offer to draft the content instead.'
      : '';

    const toolConfig: { tools?: Array<{ toolSpec: { name: string; description: string; inputSchema: { json: Record<string, unknown> } } }> } = {};
    // Google Calendar/Gmail only for Executive Assistant when connected
    if (isExecutiveAssistant && googleConnected) {
      toolConfig.tools = GOOGLE_TOOLS.map((tool) => ({
        toolSpec: {
          name:        tool.name,
          description: tool.description,
          inputSchema: { json: tool.input_schema },
        },
      }));
    }

    const converseRequest: ConverseRequest = {
      modelId:     agent.model ?? BEDROCK_MODEL,
      system:      [{ text: systemPrompt + googleNote }],
      messages:    [...bedrockMessages, { role: 'user', content: [{ text: message.trim() }] }],
      inferenceConfig: {
        temperature: 0.7,
        topP:        0.95,
        maxTokens:   2048,
      },
      ...(toolConfig.tools ? { toolConfig } : {}),
    };

    let bedrockResponse = await bedrock.send(new ConverseCommand(converseRequest));

    // ── Tool-calling loop (max 5 rounds to avoid runaway loops) ────────────
    let rounds = 0;
    while (
      bedrockResponse.output?.message?.stopReason === 'tool_use' &&
      rounds < 5
    ) {
      rounds++;
      const toolResults: Array<{ toolResult: { toolUseId: string; content: Array<{ json: Record<string, unknown> }> } }> = [];
      const assistantMessage = bedrockResponse.output.message;

      if (assistantMessage.content) {
        for (const block of assistantMessage.content) {
          if (block.toolUse) {
            const fnName = block.toolUse.name;
            const fnArgs = (block.toolUse.input ?? {}) as Record<string, unknown>;
            const toolUseId = block.toolUse.toolUseId;

            console.info('[agent-router] Executing tool', { fnName, fnArgs, agent: agent.role });
            toolsUsed.push(fnName);

            let result: Record<string, unknown>;
            try {
              if (isExecutiveAssistant && googleAccessToken) {
                result = await executeGoogleTool(fnName, fnArgs, googleAccessToken);
              } else {
                result = { success: false, error: 'Tool not available for this agent or Google account not connected.' };
              }
            } catch (toolErr) {
              console.error('[agent-router] Tool execution failed', { fnName, error: (toolErr as Error).message });
              result = { success: false, error: (toolErr as Error).message };
            }

            toolResults.push({
              toolResult: {
                toolUseId,
                content: [{ json: result }],
              },
            });
          }
        }
      }

      // Add assistant message and tool results to history
      bedrockMessages.push(assistantMessage as { role: 'assistant'; content: Array<{ text?: string; toolUse?: { name: string; input: Record<string, unknown>; toolUseId: string } }> });
      bedrockMessages.push({
        role:    'user',
        content: toolResults.map((tr) => ({
          toolResult: tr.toolResult,
        })),
      } as unknown as { role: 'user'; content: Array<{ text: string }> });

      // Continue conversation with tool results
      const continueRequest: ConverseRequest = {
        modelId:     agent.model ?? BEDROCK_MODEL,
        system:      [{ text: systemPrompt + googleNote }],
        messages:    bedrockMessages,
        inferenceConfig: {
          temperature: 0.7,
          topP:        0.95,
          maxTokens:   2048,
        },
        ...(toolConfig.tools ? { toolConfig } : {}),
      };

      bedrockResponse = await bedrock.send(new ConverseCommand(continueRequest));
    }

    // Extract final response
    const finalMessage = bedrockResponse.output?.message;
    if (finalMessage?.content) {
      const textParts = finalMessage.content
        .filter((block): block is { text: string } => 'text' in block)
        .map((block) => block.text);
      assistantContent = textParts.join('\n');
    }

    if (!assistantContent) {
      throw new Error('Bedrock returned an empty response.');
    }
  } catch (bedrockErr) {
    console.error('[agent-router] Bedrock API error', bedrockErr);
    return respond(502, {
      error: 'AI service temporarily unavailable. Please try again in a moment.',
    });
  }

  // ── 7. Persist assistant message ─────────────────────────────────────────
  const assistantMsgId = randomUUID();
  const assistantTs    = new Date().toISOString();

  await persistMessage({
    entityType: 'MESSAGE',
    session_id: sessionId,
    message_id: assistantMsgId,
    role:       'assistant',
    content:    assistantContent,
    timestamp:  assistantTs,
    GSI1PK:     `AGENT#${agentId}`,
    GSI1SK:     `TS#${assistantTs}`,
  });

  // ── 8. Return response ────────────────────────────────────────────────────
  const response: ChatResponse = {
    session_id:   sessionId,
    message_id:   assistantMsgId,
    content:      assistantContent,
    agent_id:     agentId,
    timestamp:    assistantTs,
    context_used: {
      ...meta,
      ...(toolsUsed.length > 0 ? { tools_used: toolsUsed } : {}),
    },
  };

  return respond(200, response);
}

// ────────────────────────────────────────────────────────────────────────────
// Route: GET /analytics/web and GET /analytics/meta
// Reads daily-refreshed JSON from the external analytics S3 bucket and
// returns the raw payload. The frontend renders charts from this directly.
// ────────────────────────────────────────────────────────────────────────────
async function readAnalyticsS3(s3Key: string): Promise<unknown> {
  const result = await s3Analytics.send(
    new GetObjectCommand({ Bucket: ANALYTICS_BUCKET, Key: s3Key }),
  );
  if (!result.Body) throw new Error(`Empty response from S3 key: ${s3Key}`);

  const chunks: Buffer[] = [];
  const stream = result.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

async function readFirstAnalyticsS3(keys: string[]): Promise<unknown> {
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await readAnalyticsS3(key);
    } catch (err) {
      lastError = err;
      console.warn('[agent-router] analytics key read failed', { key, err });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No analytics S3 key could be read.');
}

async function handleWebAnalytics(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const period = event.queryStringParameters?.period ?? 'weekly';
  const key    = period === 'monthly' ? 'reports/monthly.json' : 'reports/weekly.json';

  try {
    const data = await readAnalyticsS3(key);
    return respond(200, data);
  } catch (err) {
    console.error('[agent-router] webAnalytics S3 read failed', { key, err });
    return respond(503, { error: 'Analytics data temporarily unavailable. The report file may not yet exist for this period.' });
  }
}

async function handleMetaAnalytics(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const period = event.queryStringParameters?.period ?? 'weekly';
  const keys   = period === 'monthly'
    ? ['meta/monthly.json', 'meta_monthly.json', 'monthly.json']
    : ['meta/weekly.json', 'meta_weekly.json', 'weekly.json'];

  try {
    const data = await readFirstAnalyticsS3(keys);
    return respond(200, data);
  } catch (err) {
    console.error('[agent-router] metaAnalytics S3 read failed', { keys, err });
    return respond(503, { error: 'Meta analytics data temporarily unavailable.' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main Lambda handler — request router
// ────────────────────────────────────────────────────────────────────────────
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method  = event.requestContext.http.method.toUpperCase();
  const rawPath = event.rawPath ?? event.requestContext.http.path ?? '/';

  console.info('[agent-router] Incoming request', {
    method,
    path: rawPath,
    queryParams: event.queryStringParameters,
  });

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // ── Route: GET /agents ───────────────────────────────────────────────────
  if (method === 'GET' && rawPath === '/agents') {
    return handleListAgents();
  }

  // ── Route: GET /analytics/summary ───────────────────────────────────────
  if (method === 'GET' && rawPath === '/analytics/summary') {
    return handleAnalyticsSummary(event);
  }

  // ── Route: GET /analytics/web ───────────────────────────────────────────
  if (method === 'GET' && rawPath === '/analytics/web') {
    return handleWebAnalytics(event);
  }

  // ── Route: GET /analytics/meta ──────────────────────────────────────────
  if (method === 'GET' && rawPath === '/analytics/meta') {
    return handleMetaAnalytics(event);
  }

  // ── Route: GET /auth/google/status ──────────────────────────────────────
  if (method === 'GET' && rawPath === '/auth/google/status') {
    return handleGoogleStatus(event);
  }

  // ── Route: POST /auth/google/disconnect ─────────────────────────────────
  if (method === 'POST' && rawPath === '/auth/google/disconnect') {
    return handleGoogleDisconnect(event);
  }

  // ── Route: POST /agents/{agentId}/chat ──────────────────────────────────
  const chatMatch = rawPath.match(/^\/agents\/([^/]+)\/chat$/);
  if (method === 'POST' && chatMatch) {
    const agentId = decodeURIComponent(chatMatch[1]);
    try {
      return await handleAgentChat(agentId, event);
    } catch (err) {
      console.error('[agent-router] chat route error', err);
      return respond(500, {
        error: 'Agent chat failed.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Route: GET /sessions/{sessionId} ────────────────────────────────────
  const sessionMatch = rawPath.match(/^\/sessions\/([^/]+)$/);
  if (method === 'GET' && sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    try {
      const messages = await getSessionMessages(sessionId);
      return respond(200, { session_id: sessionId, messages });
    } catch (err) {
      console.error('[agent-router] getSession error', err);
      return respond(500, { error: 'Failed to retrieve session.' });
    }
  }

  return respond(404, { error: `Route ${method} ${rawPath} not found.` });
};
