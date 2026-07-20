// -----------------------------------------------------------
// Domain types for the Stellar Global Ops Control Center
// -----------------------------------------------------------

export type MaterialType = 'SS' | 'MS' | 'SERVICE' | 'OTHER';

export interface SaleRecord {
  invoice_id:   string;
  date:         string;          // ISO 8601 date string
  customer_name: string;
  product_sku:  string;
  quantity:     number;
  unit_price:   number;
  total_amount: number;
  material_type: MaterialType;
  created_at:   string;
}

export interface Customer {
  customer_id:  string;
  name:         string;
  segment:      'enterprise' | 'mid-market' | 'sme';
  email?:       string;
  phone?:       string;
  created_at:   string;
}

export interface Product {
  sku:           string;
  name:          string;
  material_type: MaterialType;
  unit:          string;
  base_price:    number;
  category:      string;
}

export interface PurchaseOrder {
  po_id:       string;
  date:        string;
  vendor_id:   string;
  vendor_name: string;
  items:       POLineItem[];
  total_amount: number;
  status:      'pending' | 'approved' | 'fulfilled' | 'cancelled';
  created_at:  string;
}

export interface POLineItem {
  sku:        string;
  quantity:   number;
  unit_price: number;
  amount:     number;
}

// -----------------------------------------------------------
// AI Agent types
// -----------------------------------------------------------

export type AgentRole =
  | 'sales-analyst'
  | 'sales-strategist'
  | 'business-analyst'
  | 'cloud-engineer'
  | 'marketing-manager'
  | 'executive-assistant'
  | 'demand-forecasting';

export interface AgentProfile {
  agent_id:    string;
  name:        string;
  role:        AgentRole;
  description: string;
  color:       string;       // Hex color for avatar/accent
  icon:        string;       // lucide-react icon name
  model:       string;
  created_at:  string;
}

export interface ChatMessage {
  message_id:  string;
  session_id:  string;
  role:        'user' | 'assistant' | 'system';
  content:     string;
  timestamp:   string;
  isStreaming?: boolean;
  toolsUsed?:  string[];
}

export interface ChatSession {
  session_id:  string;
  agent_id:    string;
  user_id:     string;
  started_at:  string;
  messages:    ChatMessage[];
}

// -----------------------------------------------------------
// API request/response shapes
// -----------------------------------------------------------

export interface PresignRequest {
  filename:     string;
  content_type: 'text/csv' | 'application/json' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'video/mp4' | 'video/quicktime' | 'video/webm' | 'video/mpeg' | 'video/x-msvideo' | 'video/x-ms-wmv';
  file_size:    number;
}

export interface PresignResponse {
  upload_url:  string;
  key:         string;
  expires_in:  number;
  read_url?:   string;
}

export interface ChatRequest {
  session_id?: string;
  message:     string;
  user_id:     string;
}

export interface ChatResponse {
  session_id:  string;
  message_id:  string;
  content:     string;
  agent_id:    string;
  timestamp:   string;
  context_used: {
    sales_records:    number;
    recent_invoices:  number;
    analytics_snap:   boolean;
    tools_used?: string[];
  };
}

export interface GoogleConnectionStatus {
  connected:    boolean;
  google_email: string | null;
  connected_at: string | null;
  scope:        string | null;
}

export interface AnalyticsSummary {
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
  material_split:    MaterialSplit;
  growth_rate:       number;
}

export interface TopCustomer {
  customer_name: string;
  total_revenue: number;
  invoice_count: number;
}

export interface TopSKU {
  sku:           string;
  total_revenue: number;
  total_qty:     number;
  material_type: MaterialType;
}

export interface TopSupplier {
  supplier_name: string;
  total_purchase: number;
  invoice_count: number;
}

export interface MonthlyRevenue {
  month:   string;  // "2025-01"
  revenue: number;
  invoices: number;
}

export interface MonthlyBusiness {
  month: string;
  sales: number;
  purchases: number;
  gross_profit: number;
  gross_margin_pct: number;
  sales_invoices: number;
  purchase_invoices: number;
}

export interface MonthlyGST {
  month: string;
  output_gst: number;
  input_gst: number;
  net_gst: number;
}

export interface ItemMargin {
  item_name: string;
  sales_qty: number;
  purchase_qty: number;
  sales_amount: number;
  purchase_amount: number;
  gross_profit: number;
}

export interface MaterialSplit {
  SS: number;
  MS: number;
  SERVICE?: number;
  OTHER?: number;
}

// -----------------------------------------------------------
// Inventory types (from inventory_summary view)
// -----------------------------------------------------------

export interface InventoryItem {
  item_name:     string;
  purchased_qty: number;
  sold_qty:      number;
  current_stock: number;
  unit:          string;
  material_type: MaterialType;
}

// -----------------------------------------------------------
// Upload pipeline types
// -----------------------------------------------------------

export type UploadStatus = 'idle' | 'requesting-url' | 'uploading' | 'processing' | 'complete' | 'error';

export interface UploadJob {
  id:         string;
  filename:   string;
  file_size:  number;
  status:     UploadStatus;
  progress:   number;       // 0–100
  s3_key?:    string;
  error?:     string;
  started_at: string;
  completed_at?: string;
}

// -----------------------------------------------------------
// UI state
// -----------------------------------------------------------

// -----------------------------------------------------------
// Analytics types (for web traffic and meta marketing)
// -----------------------------------------------------------

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';

export interface GeoEntry {
  country: string;
  requests: number;
  pct: number;
}

export interface TopPage {
  page: string;
  visits: number;
  bounce_pct?: number;
}

export interface WebAnalyticsData {
  summary: {
    total_requests: number;
    unique_ips: number;
    avg_daily: number;
    top_country: string;
  };
  meta_insights: {
    high_intent_visits: number;
    warm_audience_size: number;
  };
  traffic_over_time: { date: string; requests: number }[];
  top_pages: TopPage[];
  geo_distribution: GeoEntry[];
  generated_at: string;
}

export interface MetaAnalyticsData {
  period?: string;
  label?: string;
  generated_at: string;
  summary: {
    total_requests: number;
    unique_ips: number;
    avg_daily: number;
    top_country: string;
    mobile_pct: number;
    desktop_pct: number;
    bounce_rate: number;
    peak_hour: string;
  };
  traffic_over_time: { date: string; requests: number }[];
  top_pages: TopPage[];
  geo_distribution: GeoEntry[];
  device_split: { device: string; pct: number }[];
  peak_hours: { hour: number; requests: number }[];
  meta_insights: {
    recommended_objective: string;
    top_locations: string[];
    best_placement: string;
    best_ad_time: string;
    warm_audience_size: number;
    high_intent_visits: number;
  };
  instagram?: {
    profile?: { name?: string; username?: string; followers?: number; following?: number; media_count?: number };
    summary?: { total_impressions?: number; total_reach?: number; profile_views?: number; website_clicks?: number; avg_daily_reach?: number; engagement_rate?: number };
    daily_reach?: { date: string; value: number }[];
    daily_impressions?: { date: string; value: number }[];
    daily_profile_views?: { date: string; value: number }[];
    age_gender?: Record<string, number>;
    city?: Record<string, number>;
    online_hours?: Record<string, number>;
    top_posts?: Array<{ id?: string; caption?: string; media_type?: string; impressions?: number; reach?: number; engagements?: number; likes?: number; comments?: number }>;
  };
  facebook?: {
    profile?: { name?: string; fans?: number; followers?: number; talking_about?: number; category?: string };
    summary?: { total_reach?: number; total_engagements?: number; total_page_views?: number; fans_added?: number; fans_removed?: number; video_views?: number };
    daily_reach?: { date: string; value: number }[];
    daily_engagements?: { date: string; value: number }[];
    fan_net_daily?: { date: string; value: number }[];
    fan_age_gender?: Record<string, number>;
    fan_cities?: Record<string, number>;
    top_posts?: Array<{ id?: string; message?: string; impressions?: number; reach?: number; engagements?: number; likes?: number; comments?: number }>;
  };
  ads?: {
    summary?: { total_spend?: number; impressions?: number; clicks?: number; ctr?: number; cpc?: number; cpm?: number; reach?: number; frequency?: number; link_clicks?: number; landing_views?: number; leads?: number; post_engagement?: number; roas?: number };
    daily_trend?: Array<{ date: string; spend?: number; clicks?: number; impressions?: number; reach?: number }>;
    campaigns?: Array<{ name?: string; campaign_name?: string; impressions?: number; clicks?: number; spend?: number; ctr?: number }>;
    age_gender?: Record<string, number>;
    regions?: Record<string, number>;
    placements?: Record<string, number>;
  };
  insights?: {
    ctr_status?: string;
    best_campaign?: string;
    best_region?: string;
    top_ig_post_type?: string;
    ig_engagement_rate?: number;
    fb_fan_growth?: number;
    recommendation?: string;
  };
}

export interface AppNotification {
  id:      string;
  type:    'success' | 'error' | 'info' | 'warning';
  title:   string;
  message: string;
  ts:      number;
}

export type FinancialYear = {
  startYear: number;
  label: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Order Management types
// ────────────────────────────────────────────────────────────────────────────

export type OrderStatus = 'Order Received' | 'Processing' | 'Ready to Dispatch' | 'Delivered';
export type PaymentStatus = 'Pending' | 'Paid' | 'Partial';
export type UnitType = 'Pieces' | 'Kgs';

export interface Order {
  id:              string;
  customer_name:   string;
  phone:           string;
  email:           string;
  product_type:    string;
  material:        string;
  quantity:        number;
  unit:            UnitType;
  sale_cost:       number;
  cgst_total:      number;
  sgst_total:      number;
  igst_total?:     number;  // Optional - for inter-state sales
  payment_status:  PaymentStatus;
  delivery_timeline: string | null;  // ISO date string
  status:          OrderStatus;
  created_by:      string | null;
  updated_by:      string | null;
  created_at:      string;  // ISO timestamp
  updated_at:      string;  // ISO timestamp
}

export interface OrderSummary {
  total_orders:      number;
  total_revenue:     number;
  pending_orders:    number;
  delivered_orders:  number;
  avg_order_value:   number;
  orders_by_status:  { status: OrderStatus; count: number }[];
  orders_by_payment: { payment_status: PaymentStatus; count: number }[];
  recent_orders:     Order[];
}

export interface OrderFilters {
  financialYear?: FinancialYear;
  year?: number;
  month?: number;
  status?: OrderStatus;
}

// ────────────────────────────────────────────────────────────────────────────
// Quotation Management types
// ────────────────────────────────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

export interface QuoteCustomer {
  id: string;
  company_name: string;
  gst_number: string;
  address: string;
  city?: string;
  pin_code?: string;
  state: string;
  state_code: string;
  contact_person?: string;
  contact_number?: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface Quote {
  id: string;
  quote_number: string;
  customer_id: string;
  date: string;
  expiry_date?: string;
  items: QuoteItem[];
  sub_total: number;
  igst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  grand_total: number;
  notes?: string;
  status: QuoteStatus;
  quote_customers?: QuoteCustomer;
  created_at: string;
  updated_at: string;
}

export type NavSection =
  | 'dashboard'
  | 'agents'
  | 'ingest'
  | 'inventory'
  | 'analytics'
  | 'registers'
  | 'meta'
  | 'tasks'
  | 'orders'
  | 'quotations'
  | 'documents'
  | 'workflow-analytics';

// ────────────────────────────────────────────────────────────────────────────
// Workflow Analytics types
// ────────────────────────────────────────────────────────────────────────────

export interface WorkflowAnalyticsData {
  leads: {
    total: number;
    recent30: number;
    by_status: Record<string, number>;
    conversion_rate: number;
    by_industry: { industry: string; count: number }[];
    daily_30: { date: string; count: number }[];
    emails_sent: number;
    follow_ups: number;
    initial_emails: number;
  };
  social_posts: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    platform_counts: Record<string, number>;
    published_week: number;
    in_pipeline: number;
    ready_to_publish: number;
    weekly_8: { week: string; count: number }[];
  };
  blog_posts: {
    total: number;
    by_status: Record<string, number>;
    published_rate: number;
    top_tags: { tag: string; count: number }[];
    monthly_6: { month: string; count: number }[];
  };
  approvals: {
    pending: number;
    approval_rate: number;
    avg_review_hours: number;
    expired: number;
    by_workflow_type: Record<string, number>;
    daily_30: { date: string; approved: number; rejected: number }[];
  };
  cost: {
    total_usd: number;
    by_type: Record<string, number>;
  };
  workflow_runs: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    success_rate_by_type: { workflow_type: string; succeeded: number; total: number; rate: number }[];
    avg_duration_min: number;
    active_runs: { workflow_type: string; started_at: string }[];
    recent_failed: { workflow_type: string; started_at: string }[];
    daily_30: { date: string; succeeded: number; failed: number; running: number }[];
    recent: Array<{
      id: string;
      workflow_type: string;
      status: string;
      started_at: string;
      completed_at?: string;
      cost_usd?: string;
    }>;
  };
  schedules: {
    total: number;
    active: number;
    paused: number;
    by_frequency: Record<string, number>;
    by_type: Record<string, number>;
    list: WorkflowScheduleEntry[];
  };
}

export interface WorkflowScheduleEntry {
  id: string;
  label: string;
  workflow_type: string;
  frequency: string;
  enabled: boolean;
  run_time: string;
  days_of_week: string[] | null;
  day_of_month: number | null;
  created_at: string;
}