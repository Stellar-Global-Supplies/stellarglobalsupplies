# Stellar Global Supplies — Ops Control Center
## Architecture & DynamoDB Single-Table Design

---

## System Overview

```
Browser (PWA)
  │
  ├── HTTPS ──► CloudFront  ──► S3 (frontend bucket)  [static assets]
  │              (ops.stellarglobalsupplies.com)
  │
  ├── API ───► API Gateway (HTTP API v2)
  │              │
  │              ├── POST /upload/presign  ──► Lambda: presign       ──► S3 pre-signed URL
  │              ├── POST /agents/{id}/chat ──► Lambda: agent-router  ──► DynamoDB + Bedrock
  │              ├── GET  /agents           ──► Lambda: agent-router  ──► DynamoDB
  │              └── GET  /analytics/summary──► Lambda: agent-router  ──► DynamoDB
  │
  └── Direct PUT ──► S3 (data bucket / raw-ingest/)
                        │
                        └── S3 Event ──► Lambda: ingest ──► DynamoDB (batch-write)
```

---

## DynamoDB Single-Table Design

**Table Name:** `stellar-ops-{environment}`
**Billing:** PAY_PER_REQUEST
**Keys:** PK (String) + SK (String)
**GSIs:** GSI1 (GSI1PK + GSI1SK), GSI2 (GSI2PK + GSI2SK)

---

### Entity Map

| Entity            | PK Pattern             | SK Pattern                    | GSI1PK                    | GSI1SK              | GSI2PK               | GSI2SK         |
|-------------------|------------------------|-------------------------------|---------------------------|---------------------|----------------------|----------------|
| Sale Invoice      | `SALE#YYYYMM`          | `INV#<invoice_id>`            | `CUSTOMER#<name_slug>`    | `DATE#<ISO8601>`    | `SKU#<sku>`          | `DATE#<ISO>`   |
| Customer Profile  | `CUSTOMER#<id>`        | `PROFILE#v0`                  | `SEGMENT#<tier>`          | `CUSTOMER#<id>`     | —                    | —              |
| Product Catalog   | `PRODUCT#<sku>`        | `DETAILS#v0`                  | `MATERIAL#<SS\|MS>`       | `SKU#<sku>`         | —                    | —              |
| Purchase Order    | `PO#YYYYMM`            | `PO#<po_id>`                  | `VENDOR#<vendor_id>`      | `DATE#<ISO>`        | `STATUS#<status>`    | `DATE#<ISO>`   |
| Agent Profile     | `AGENT#<agent_id>`     | `PROFILE#v0`                  | `ROLE#<role_slug>`        | `AGENT#<agent_id>`  | —                    | —              |
| Chat Session Meta | `SESSION#<session_id>` | `META#v0`                     | `AGENT#<agent_id>`        | `SESSION#<id>`      | `USER#<user_id>`     | `TS#<ISO>`     |
| Chat Message      | `SESSION#<session_id>` | `MSG#<ISO_timestamp>#<msgId>` | `AGENT#<agent_id>`        | `TS#<ISO>`          | —                    | —              |
| Google OAuth Token| `USER#<user_id>`       | `GOOGLE_TOKEN#v0`              | —                          | —                   | —                    | —              |
| Analytics Snap    | `ANALYTICS#YYYYMM`     | `SNAP#<metric_type>`          | `TYPE#<metric_type>`      | `DATE#<ISO>`        | —                    | —              |

---

### Key Access Patterns

| Pattern                                       | Index          | Query                                      |
|-----------------------------------------------|----------------|--------------------------------------------|
| All invoices in a month                       | Main           | PK = `SALE#YYYYMM`                        |
| All invoices for a customer                   | GSI1           | GSI1PK = `CUSTOMER#<name>`               |
| All invoices for a product SKU                | GSI2           | GSI2PK = `SKU#<sku>`                     |
| Chat history for a session                    | Main           | PK = `SESSION#<id>`, SK begins_with `MSG#`|
| All sessions for an agent                     | GSI1           | GSI1PK = `AGENT#<id>`                    |
| Purchase orders by status                     | GSI2           | GSI2PK = `STATUS#<pending\|approved>`     |
| Agents by role                                | GSI1           | GSI1PK = `ROLE#<sales_analyst>`          |
| Analytics snapshots by metric type           | GSI1           | GSI1PK = `TYPE#<revenue>`               |

---

### Sample Item Shapes

```jsonc
// Sale Invoice
{
  "PK":           "SALE#202501",
  "SK":           "INV#INV-20250115-001",
  "GSI1PK":       "CUSTOMER#acme-steel-corp",
  "GSI1SK":       "DATE#2025-01-15T00:00:00Z",
  "GSI2PK":       "SKU#SS-304-2MM-SHEET",
  "GSI2SK":       "DATE#2025-01-15T00:00:00Z",
  "entityType":   "SALE",
  "invoice_id":   "INV-20250115-001",
  "date":         "2025-01-15",
  "customer_name":"Acme Steel Corp",
  "product_sku":  "SS-304-2MM-SHEET",
  "quantity":     500,
  "unit_price":   145.50,
  "total_amount": 72750.00,
  "material_type":"SS",
  "created_at":   "2025-01-15T08:32:00Z"
}

// Agent Profile
{
  "PK":           "AGENT#sales-analyst",
  "SK":           "PROFILE#v0",
  "GSI1PK":       "ROLE#sales-analyst",
  "GSI1SK":       "AGENT#sales-analyst",
  "entityType":   "AGENT",
  "agent_id":     "sales-analyst",
  "name":         "Sales Analyst",
  "role":         "sales-analyst",
  "color":        "#6366f1",
  "icon":         "TrendingUp",
  "description":  "Examines raw metal pricing, historical metrics, and predicts volume patterns.",
  "model":        "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "created_at":   "2025-01-01T00:00:00Z"
}

// Chat Message
{
  "PK":           "SESSION#sess-abc123",
  "SK":           "MSG#2025-01-15T09:00:00.000Z#msg-001",
  "GSI1PK":       "AGENT#sales-analyst",
  "GSI1SK":       "TS#2025-01-15T09:00:00.000Z",
  "entityType":   "MESSAGE",
  "session_id":   "sess-abc123",
  "message_id":   "msg-001",
  "role":         "user",
  "content":      "What were our top 5 SKUs by revenue last month?",
  "timestamp":    "2025-01-15T09:00:00.000Z",
  "ttl":          1768464000
}

// Google OAuth Token (Executive Assistant — personal Calendar/Gmail access)
{
  "PK":            "USER#manager-001",
  "SK":            "GOOGLE_TOKEN#v0",
  "entityType":    "GOOGLE_TOKEN",
  "refresh_token": "1//0g....(encrypted at rest via DynamoDB SSE)",
  "scope":         "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email",
  "google_email":  "manager@gmail.com",
  "connected_at":  "2025-01-15T09:00:00.000Z"
}
```

---

## Lambda Architecture

### `presign` (128 MB, 10s timeout)
- Validates filename, content-type, and file size
- Generates S3 pre-signed PUT URL (15 minute TTL) for `raw-ingest/{uuid}/{filename}`
- Returns `{ uploadUrl, key, expiresIn }`

### `ingest` (512 MB, 300s timeout) — S3-triggered
- Streams S3 object line-by-line using Node.js streams
- Validates CSV headers: `Invoice_ID,Date,Customer_Name,Product_SKU,Quantity,Unit_Price,Total_Amount,Material_Type`
- Batch-writes 25 items at a time to DynamoDB (BatchWriteItem limit)
- Updates a `ANALYTICS#YYYYMM` snapshot item for each month processed

### `agent-router` (512 MB, 30s timeout) — API Gateway proxy
- Routes by HTTP method + path
- For `/agents`: Scans DynamoDB for all `AGENT#*` profiles
- For `/agents/{id}/chat`: 
  1. Retrieves agent system prompt from DynamoDB
  2. Pulls contextual business data (recent sales summary, top SKUs, open POs)
  3. Reconstructs conversation history from DynamoDB
  4. Calls AWS Bedrock (Claude Sonnet 4.5) with full context
  5. For the **Executive Assistant** agent, also checks for a connected
     Google account (`USER#<id>/GOOGLE_TOKEN#v0`) and, if present, enables
     Bedrock tool use for Google Calendar and Gmail
     (`create_calendar_event`, `list_upcoming_calendar_events`,
     `send_email`, `list_recent_emails`)
  6. Persists user + assistant messages to DynamoDB
  7. Returns streaming-compatible response
- For `/analytics/summary`: Aggregates DynamoDB scan into dashboard metrics
- For `/auth/google/status` and `/auth/google/disconnect`: checks/clears the
  stored Google refresh token for a user

### `google-auth` (256 MB, 15s timeout) — API Gateway proxy
- `GET /auth/google/url` — builds the Google OAuth 2.0 consent URL
  (Calendar + Gmail scopes, `access_type=offline`, `prompt=consent`) and
  302-redirects the browser to Google
- `GET /auth/google/callback` — exchanges the returned `code` for an
  access/refresh token pair, fetches the connected account's email, stores
  the refresh token in DynamoDB (`USER#<id>/GOOGLE_TOKEN#v0`), and redirects
  back to the frontend with `?google_connected=true|false`
