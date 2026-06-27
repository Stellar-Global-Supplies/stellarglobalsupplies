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
  content_type: 'text/csv' | 'application/json';
  file_size:    number;
}

export interface PresignResponse {
  upload_url:  string;
  key:         string;
  expires_in:  number;
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

export type NavSection = 'dashboard' | 'agents' | 'ingest' | 'analytics' | 'web' | 'meta' | 'inventory' | 'registers' | 'cloud' | 'tasks';

export interface AppNotification {
  id:      string;
  type:    'success' | 'error' | 'info' | 'warning';
  title:   string;
  message: string;
  ts:      number;
}

// -----------------------------------------------------------
// Web analytics and Meta marketing types (from analytics S3 bucket)
// -----------------------------------------------------------

export interface TrafficDay {
  date:     string;
  requests: number;
}

export interface TopPage {
  page:       string;
  visits:     number;
  bounce_pct: number;
}

export interface GeoEntry {
  country:  string;
  requests: number;
  pct:      number;
}

export interface PeakHour {
  hour:     number;
  requests: number;
}

export interface MetaInsights {
  recommended_objective: string;
  top_locations:         string[];
  best_placement:        string;
  best_ad_time:          string;
  warm_audience_size:    number;
  high_intent_visits:    number;
}

export interface WebAnalyticsSummary {
  total_requests: number;
  unique_ips:     number;
  avg_daily:      number;
  top_country:    string;
  mobile_pct:     number;
  desktop_pct:    number;
  bounce_rate:    number;
  peak_hour:      string;
}

export interface WebAnalyticsData {
  period:           string;
  label:            string;
  generated_at:     string;
  summary:          WebAnalyticsSummary;
  traffic_over_time: TrafficDay[];
  top_pages:        TopPage[];
  geo_distribution: GeoEntry[];
  device_split:     Array<{ device: string; pct: number }>;
  peak_hours:       PeakHour[];
  meta_insights:    MetaInsights;
}

export type MetaAnalyticsData = WebAnalyticsData;

export type AnalyticsPeriod = 'weekly' | 'monthly';
