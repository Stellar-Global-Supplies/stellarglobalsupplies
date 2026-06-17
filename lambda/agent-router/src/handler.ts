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
import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from '@google/genai';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const REGION         = process.env.AWS_REGION       ?? 'ap-south-1';
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE!;
const GEMINI_PARAM   = process.env.GEMINI_KEY_PARAM!;
const GOOGLE_CLIENT_ID_PARAM     = process.env.GOOGLE_CLIENT_ID_PARAM!;
const GOOGLE_CLIENT_SECRET_PARAM = process.env.GOOGLE_CLIENT_SECRET_PARAM!;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN   ?? '*';
const GEMINI_MODEL        = 'gemini-2.5-flash-lite';
const ANALYTICS_BUCKET    = process.env.ANALYTICS_BUCKET ?? 'stellar-analytics-reports-471112840461';

const s3Analytics = new S3Client({ region: REGION });

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
  top_skus:               string;
  top_customers:          string;
  monthly_revenue:        string;
  material_split:         string;
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
  total_invoices:    number;
  avg_invoice_value: number;
  top_customers:     TopCustomer[];
  top_skus:          TopSKU[];
  revenue_by_month:  MonthlyRevenue[];
  material_split:    { SS: number; MS: number };
  growth_rate:       number;
}

interface TopCustomer  { customer_name: string; total_revenue: number; invoice_count: number; }
interface TopSKU       { sku: string; total_revenue: number; total_qty: number; material_type: string; }
interface MonthlyRevenue { month: string; revenue: number; invoices: number; }

// ────────────────────────────────────────────────────────────────────────────
// Shared Gemini client (lazy, cached across warm invocations)
// ────────────────────────────────────────────────────────────────────────────
let cachedGeminiKey: string | null = null;
let geminiClient: GoogleGenAI | null = null;

async function getGeminiClient(): Promise<GoogleGenAI> {
  if (geminiClient && cachedGeminiKey) return geminiClient;

  const ssmResult = await ssm.send(
    new GetParameterCommand({ Name: GEMINI_PARAM, WithDecryption: true }),
  );

  const apiKey = ssmResult.Parameter?.Value;
  if (!apiKey) throw new Error('Gemini API key not found in SSM Parameter Store.');

  cachedGeminiKey = apiKey;
  geminiClient    = new GoogleGenAI({ apiKey });
  return geminiClient;
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
// Gemini function-calling tool declarations for the Executive Assistant
// ────────────────────────────────────────────────────────────────────────────
const GOOGLE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'create_calendar_event',
    description: 'Creates a new event on the user\'s primary Google Calendar. Use this when the user asks to schedule a meeting, touchpoint, or calendar event.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary:     { type: Type.STRING, description: 'Event title' },
        description: { type: Type.STRING, description: 'Event description / agenda notes' },
        start:       { type: Type.STRING, description: 'Start datetime in ISO 8601 format, e.g. 2026-06-15T10:00:00+05:30' },
        end:         { type: Type.STRING, description: 'End datetime in ISO 8601 format, e.g. 2026-06-15T11:00:00+05:30' },
        attendees:   { type: Type.ARRAY, items: { type: Type.STRING }, description: 'List of attendee email addresses' },
        location:    { type: Type.STRING, description: 'Event location (optional, can be a video call link)' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'list_upcoming_calendar_events',
    description: 'Lists the user\'s upcoming events on their primary Google Calendar. Use this to check availability before scheduling, or to summarise the week ahead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_results: { type: Type.NUMBER, description: 'Maximum number of events to return (default 10)' },
      },
    },
  },
  {
    name: 'send_email',
    description: 'Sends an email from the user\'s Gmail account. Use this when the user explicitly asks to send a follow-up email, synopsis, or message to a client.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        to:      { type: Type.STRING, description: 'Recipient email address' },
        subject: { type: Type.STRING, description: 'Email subject line' },
        body:    { type: Type.STRING, description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_recent_emails',
    description: 'Lists recent emails from the user\'s Gmail inbox (sender, subject, snippet). Use this to build meeting synopses or summarise recent client communication.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_results: { type: Type.NUMBER, description: 'Maximum number of emails to return (default 5)' },
      },
    },
  },
];

/**
 * Executes a Gemini function call against the live Google APIs.
 * Returns a plain-object result suitable for feeding back to Gemini as a
 * functionResponse part.
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
// Pulls real data from DynamoDB and formats it into a grounding context block
// ────────────────────────────────────────────────────────────────────────────
async function fetchBusinessContext(): Promise<{ ctx: BusinessContext; meta: { sales_records: number; recent_invoices: number; analytics_snap: boolean } }> {
  // Scan the last 3 months of analytics snapshots
  const analyticsResult = await ddb.send(
    new ScanCommand({
      TableName:        DYNAMODB_TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':prefix': 'ANALYTICS#',
        ':sk':     'SNAP#',
      },
      Limit: 12,
    }),
  );

  const snapshots = (analyticsResult.Items ?? []) as Array<{
    month:          string;
    invoice_count:  number;
    total_revenue:  number;
  }>;

  // Scan recent sales records (last 500 for context, in production use GSI with date range)
  const salesResult = await ddb.send(
    new ScanCommand({
      TableName:        DYNAMODB_TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND entityType = :et',
      ExpressionAttributeValues: {
        ':prefix': 'SALE#',
        ':et':     'SALE',
      },
      Limit: 500,
      ProjectionExpression:
        'invoice_id, customer_name, product_sku, quantity, unit_price, total_amount, material_type, #dt',
      ExpressionAttributeNames: { '#dt': 'date' },
    }),
  );

  const salesItems = salesResult.Items ?? [] as Array<{
    invoice_id:    string;
    customer_name: string;
    product_sku:   string;
    quantity:      number;
    unit_price:    number;
    total_amount:  number;
    material_type: string;
    date:          string;
  }>;

  // Aggregate context
  const totalRevenue  = salesItems.reduce((s, r) => s + (r.total_amount ?? 0), 0);
  const avgInvoice    = salesItems.length > 0 ? totalRevenue / salesItems.length : 0;

  // Top 5 customers by revenue
  const customerMap = new Map<string, { revenue: number; count: number }>();
  for (const r of salesItems) {
    const existing = customerMap.get(r.customer_name) ?? { revenue: 0, count: 0 };
    customerMap.set(r.customer_name, {
      revenue: existing.revenue + (r.total_amount ?? 0),
      count:   existing.count + 1,
    });
  }
  const topCustomers = [...customerMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([name, d]) => `${name} (₹${d.revenue.toFixed(0)}, ${d.count} invoices)`);

  // Top 5 SKUs by revenue
  const skuMap = new Map<string, { revenue: number; qty: number; material: string }>();
  for (const r of salesItems) {
    const existing = skuMap.get(r.product_sku) ?? { revenue: 0, qty: 0, material: r.material_type };
    skuMap.set(r.product_sku, {
      revenue:  existing.revenue + (r.total_amount ?? 0),
      qty:      existing.qty + (r.quantity ?? 0),
      material: r.material_type,
    });
  }
  const topSKUs = [...skuMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([sku, d]) => `${sku} [${d.material}] — ₹${d.revenue.toFixed(0)}, ${d.qty} units`);

  // Material split
  const ssRevenue = salesItems.filter((r) => r.material_type === 'SS').reduce((s, r) => s + (r.total_amount ?? 0), 0);
  const msRevenue = salesItems.filter((r) => r.material_type === 'MS').reduce((s, r) => s + (r.total_amount ?? 0), 0);

  // Monthly revenue from snapshots
  const monthlyLines = snapshots
    .sort((a, b) => (a.month ?? '').localeCompare(b.month ?? ''))
    .slice(-6)
    .map((s) => `${s.month}: ₹${(s.total_revenue ?? 0).toFixed(0)} (${s.invoice_count ?? 0} invoices)`);

  const hasSnap = snapshots.length > 0;

  return {
    ctx: {
      recent_sales_summary:   salesItems.length > 0
        ? `${salesItems.length} sale records analysed. Total revenue: ₹${totalRevenue.toFixed(2)}. Average invoice value: ₹${avgInvoice.toFixed(2)}.`
        : 'No sales records have been ingested yet. Ask the user to upload a sales CSV via the Data Ingest section.',

      top_skus:               topSKUs.length > 0
        ? topSKUs.join('\n')
        : 'No SKU data available yet.',

      top_customers:          topCustomers.length > 0
        ? topCustomers.join('\n')
        : 'No customer data available yet.',

      monthly_revenue:        monthlyLines.length > 0
        ? monthlyLines.join('\n')
        : 'No monthly analytics snapshots available yet.',

      material_split:         `Stainless Steel (SS): ₹${ssRevenue.toFixed(0)} | Mild Steel (MS): ₹${msRevenue.toFixed(0)}`,

      total_records_ingested: salesItems.length,
    },
    meta: {
      sales_records:   salesItems.length,
      recent_invoices: Math.min(salesItems.length, 20),
      analytics_snap:  hasSnap,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Agent system prompts
// ────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(agent: AgentProfile, ctx: BusinessContext): string {
  const liveDataSource = ctx.total_records_ingested > 0 ? 'live DynamoDB records' : 'FY 2025–26 uploaded business data (Sales, Purchase, Item registers)';

  const BASE = `
You are ${agent.name}, an expert AI agent inside the operations control center of Stellar Global Supplies (stellarglobalsupplies.com), a B2B supplier of Stainless Steel (SS) and Mild Steel (MS) products, Survey No. 169, Talawade, Pune — Maharashtra, India. Contact: 9637655556.

All figures below come from ${liveDataSource}. Quote specific numbers in every answer. Never fabricate data. If a figure is unavailable, say so and suggest the next step.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STELLAR GLOBAL SUPPLIES — FY 2025–26 REAL BUSINESS DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE KPIs:
${ctx.recent_sales_summary}
• Gross Profit: ₹5,49,823 | Gross Margin: 18.88% (target: 20%+)
• GST Collected: ₹4,44,157 | GST Paid: ₹3,60,286 | Net liability: ₹83,871
• 50 invoices to 13 customers | 67 POs from 31 suppliers | Avg invoice: ₹58,234

TOP CUSTOMERS (by revenue, FY 2025–26):
${ctx.top_customers}
⚠ RISK: Baoxhin India = 43.7% of total revenue — critical concentration risk

TOP PRODUCT SKUs:
${ctx.top_skus}
• Best margin product: Tools Trolley 5-Drawer = 29.1% GM
• Worst margin (top seller): SS 202 Golden Mirror Finish Sheet = 5.8% GM despite being #1 revenue SKU

MONTHLY P&L TREND:
${ctx.monthly_revenue}
• Peak: November 2025 = ₹9,91,806 (Baoxhin bulk orders)
• Loss months: May 2025 (-₹30.4K GP), September 2025 (-₹87K GP)

MATERIAL SPLIT:
${ctx.material_split}
• Product categories: SS 29.7% | Equipment 20.9% | GI Sheets 17.7% | Tools 15.1%

TOP SUPPLIERS:
• Reinox Overseas: ₹4,99,315 (21.1% of purchases — single PO, concentration risk)
• Shrijee Sales Corp.: ₹3,76,553 | Gleams Industries: ₹3,38,747

KEY RISKS (data-driven):
1. Customer concentration: Baoxhin India = 43.7% revenue from 8 invoices
2. SS 202 Mirror Sheet: ₹4.4L revenue but only 5.8% margin — renegotiate Reinox pricing
3. Supplier concentration: Reinox Overseas = 21.1% spend from single PO
4. Negative GP months: May 2025 and September 2025

KEY OPPORTUNITIES (data-driven):
1. Tools Trolley 29.1% margin — scale this product line aggressively
2. SPM Process Systems: 24 invoices, most loyal buyer — upsell higher-margin items
3. Equipment category (Cranes, Compressors) shows strong unit margins
4. Only 13 active customers — large acquisition headroom

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
• SKU velocity: Tools Trolley and Equipment growing; SS raw material margins thin
• Baoxhin India dependency is the #1 forecasting risk — model scenarios with and without them
• SPM Process Systems: 24 invoices = most reliable demand signal for forecasting
• Recommend margin improvement levers: product mix shift toward Equipment & Tools`,

    'sales-strategist': `
STRATEGY FOCUS:
• Customer diversification is the #1 priority — Baoxhin India = 43.7% of revenue
• Target new enterprise accounts in manufacturing, construction, prefab segments
• Upsell SPM Process Systems (24 invoices, ₹4.2L) to Equipment & Machinery category (higher margins)
• Axis Prefab Homes single invoice = ₹1.31L — re-engage them; strong potential
• Pricing: SS 202 Mirror Sheet at 5.8% margin needs cost renegotiation or price increase
• When designing outreach, reference our actual product SKUs and delivery track record`,

    'business-analyst': `
OPERATIONS FOCUS:
• Gross margin is 18.88% — below 20% target; Tools Trolley at 29.1% is the benchmark
• Purchasing concentration: Reinox (21.1%) and Shrijee (15.9%) = 37% of total spend from 2 suppliers
• Invoice velocity: 50 sales invoices vs 67 purchase orders — track receivables days
• Working capital: negative GP months (May, Sep) indicate inventory/timing mismatches
• EBITDA analysis: current data covers GM only; request overhead cost data for full picture`,

    'cloud-engineer': `
CLOUD FOCUS:
• This ops center runs on: API Gateway (HTTP v2) → Lambda (Node 22) → DynamoDB → Gemini AI
• S3 hosts frontend (CloudFront OAC) and data uploads (raw-ingest/); all private buckets
• DynamoDB single-table design with GSI1/GSI2 for customer and SKU queries
• Lambda functions: presign (256MB/10s), ingest (512MB/300s), agent-router (512MB/30s), google-auth (256MB/15s)
• Report on latency, error rates, and cost estimates based on current traffic patterns`,

    'marketing-manager': `
MARKETING FOCUS:
• Use REAL product data: SS 202 Golden Mirror Finish Sheet, GI Sheets, MS Channels, Pipes, Tools
• Target audiences: procurement managers at manufacturing firms, construction companies, prefab builders
• Highlight: Stellar Global Supplies' location in Pune's MIDC industrial hub — credibility signal
• Key differentiators to promote: stock availability, range (SS + MS + Tools + Equipment), Pune delivery
• LinkedIn posts: B2B industrial tone, <1300 chars, 3–5 hashtags (#StainlessSteel #PuneIndustry #B2BSteel)
• Email campaigns: target Axis Prefab, construction sector (like Prefab Nests India segment)

LIVE WEBSITE & META ANALYTICS (from daily S3 data feed):
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

When drafting Meta/LinkedIn content, always reference real SGS products and the verified warm audience size.
When recommending ad budgets, note that the high-intent audience is small (83/month) — focus on awareness first, then retargeting.`,

    'executive-assistant': `
EXECUTIVE SUPPORT FOCUS:
• Schedule monthly P&L reviews — data shows strong Nov/Dec, weak Feb periods
• Key meetings needed: Baoxhin India account review (43.7% dependency — strategic risk)
• Follow-up required: Axis Prefab Homes (₹1.31L single invoice — re-engagement opportunity)
• Supplier review: Reinox Overseas renegotiation meeting (21.1% of purchases, low SS margins)
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
    const monthsStr = event.queryStringParameters?.months ?? '6';
    const months    = Math.min(Math.max(parseInt(monthsStr, 10) || 6, 1), 24);

    // Fetch all analytics snapshots
    const snapResult = await ddb.send(
      new ScanCommand({
        TableName:        DYNAMODB_TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :sk) AND entityType = :et',
        ExpressionAttributeValues: {
          ':prefix': 'ANALYTICS#',
          ':sk':     'SNAP#',
          ':et':     'ANALYTICS',
        },
        Limit: 100,
      }),
    );

    const snaps = (snapResult.Items ?? []) as Array<{
      month:         string;
      invoice_count: number;
      total_revenue: number;
    }>;

    // Sort and take last N months
    const sorted = snaps
      .filter((s) => s.month)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-months);

    // Also scan sales for customer/SKU data
    const salesResult = await ddb.send(
      new ScanCommand({
        TableName:        DYNAMODB_TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND entityType = :et',
        ExpressionAttributeValues: { ':prefix': 'SALE#', ':et': 'SALE' },
        Limit: 2000,
        ProjectionExpression:
          'customer_name, product_sku, total_amount, quantity, material_type',
      }),
    );

    const sales = salesResult.Items ?? [] as Array<{
      customer_name: string;
      product_sku:   string;
      total_amount:  number;
      quantity:      number;
      material_type: string;
    }>;

    // Aggregate
    const totalRevenue  = sales.reduce((s, r) => s + (r.total_amount ?? 0), 0);
    const totalInvoices = sales.length;
    const avgInvoice    = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

    // Customer map
    const customerMap = new Map<string, { revenue: number; count: number }>();
    for (const r of sales) {
      const e = customerMap.get(r.customer_name) ?? { revenue: 0, count: 0 };
      customerMap.set(r.customer_name, {
        revenue: e.revenue + (r.total_amount ?? 0),
        count:   e.count + 1,
      });
    }
    const topCustomers: TopCustomer[] = [...customerMap.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([name, d]) => ({
        customer_name: name,
        total_revenue: d.revenue,
        invoice_count: d.count,
      }));

    // SKU map
    const skuMap = new Map<string, { revenue: number; qty: number; material: string }>();
    for (const r of sales) {
      const e = skuMap.get(r.product_sku) ?? { revenue: 0, qty: 0, material: r.material_type };
      skuMap.set(r.product_sku, {
        revenue:  e.revenue + (r.total_amount ?? 0),
        qty:      e.qty + (r.quantity ?? 0),
        material: r.material_type,
      });
    }
    const topSKUs: TopSKU[] = [...skuMap.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([sku, d]) => ({
        sku,
        total_revenue: d.revenue,
        total_qty:     d.qty,
        material_type: d.material,
      }));

    // Revenue by month from snapshots
    const revenueByMonth: MonthlyRevenue[] = sorted.map((s) => ({
      month:    s.month,
      revenue:  s.total_revenue ?? 0,
      invoices: s.invoice_count ?? 0,
    }));

    // Growth rate (last month vs previous month)
    let growthRate = 0;
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1].total_revenue ?? 0;
      const prev = sorted[sorted.length - 2].total_revenue ?? 0;
      growthRate = prev > 0 ? ((last - prev) / prev) * 100 : 0;
    }

    // Material split
    const ssRevenue = sales.filter((r) => r.material_type === 'SS').reduce((s, r) => s + (r.total_amount ?? 0), 0);
    const msRevenue = sales.filter((r) => r.material_type === 'MS').reduce((s, r) => s + (r.total_amount ?? 0), 0);

    const period = sorted.length > 0
      ? `${sorted[0].month} → ${sorted[sorted.length - 1].month}`
      : `Last ${months} months`;

    const summary: AnalyticsSummary = {
      period,
      total_revenue:     totalRevenue,
      total_invoices:    totalInvoices,
      avg_invoice_value: avgInvoice,
      top_customers:     topCustomers,
      top_skus:          topSKUs,
      revenue_by_month:  revenueByMonth,
      material_split:    { SS: ssRevenue, MS: msRevenue },
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
  const { ctx, meta } = await fetchBusinessContext();

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

  // ── 5. Build Gemini content history ─────────────────────────────────────
  // Convert DynamoDB history to Gemini Content format
  const history: Content[] = historyRecords.map((m) => ({
    role:  m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  // ── 6. Call Gemini API ───────────────────────────────────────────────────
  let assistantContent = '';
  let toolsUsed: string[] = [];

  try {
    const ai           = await getGeminiClient();
    const systemPrompt = buildSystemPrompt(agent, ctx);

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

    const chat = ai.chats.create({
      model:  agent.model ?? GEMINI_MODEL,
      config: {
        systemInstruction: systemPrompt + googleNote,
        temperature:       0.7,
        topP:              0.95,
        maxOutputTokens:   2048,
        ...(isExecutiveAssistant && googleConnected
          ? { tools: [{ functionDeclarations: GOOGLE_TOOLS }] }
          : {}),
      },
      history,
    });

    let geminiResponse = await chat.sendMessage({ message: message.trim() });

    // ── Function-calling loop (max 5 rounds to avoid runaway loops) ───────
    let rounds = 0;
    while (
      isExecutiveAssistant &&
      googleAccessToken &&
      geminiResponse.functionCalls &&
      geminiResponse.functionCalls.length > 0 &&
      rounds < 5
    ) {
      rounds++;
      const functionResponseParts = [];

      for (const call of geminiResponse.functionCalls) {
        const fnName = call.name ?? 'unknown';
        const fnArgs = (call.args ?? {}) as Record<string, unknown>;

        console.info('[agent-router] Executing Google tool', { fnName, fnArgs });
        toolsUsed.push(fnName);

        let result: Record<string, unknown>;
        try {
          result = await executeGoogleTool(fnName, fnArgs, googleAccessToken);
        } catch (toolErr) {
          console.error('[agent-router] Google tool execution failed', { fnName, error: (toolErr as Error).message });
          result = { success: false, error: (toolErr as Error).message };
        }

        functionResponseParts.push({
          functionResponse: { name: fnName, response: result },
        });
      }

      geminiResponse = await chat.sendMessage({ message: functionResponseParts as never });
    }

    assistantContent = geminiResponse.text ?? '';

    if (!assistantContent) {
      throw new Error('Gemini returned an empty response.');
    }
  } catch (geminiErr) {
    console.error('[agent-router] Gemini API error', geminiErr);
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
      ...(toolsUsed.length > 0 ? { google_tools_used: toolsUsed } : {}),
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
  const key    = period === 'monthly' ? 'meta/monthly.json' : 'meta/weekly.json';

  try {
    const data = await readAnalyticsS3(key);
    return respond(200, data);
  } catch (err) {
    console.error('[agent-router] metaAnalytics S3 read failed', { key, err });
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
    return handleAgentChat(agentId, event);
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
