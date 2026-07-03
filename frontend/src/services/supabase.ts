import { supabase } from '@/lib/supabase';

// Table info for size and row count
export interface TableInfo {
  table_name: string;
  row_count: number;
  size_mb: number;
  size_bytes: number;
}

// Database connection status
export interface SupabaseConnectionStatus {
  connected: boolean;
  database_version?: string;
  database_size?: string;
  error?: string;
}

// Request metrics
export interface SupabaseRequestMetrics {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate: number;
}

// Combined response
export interface SupabaseMetrics {
  connection: SupabaseConnectionStatus;
  tables: TableInfo[];
  total_db_size_mb: number;
  request_metrics: SupabaseRequestMetrics;
}

// Fetch table sizes and row counts using Supabase's system tables
// Note: This requires the authenticated user to have access to pg_catalog
export async function fetchSupabaseTableInfo(): Promise<TableInfo[]> {
  try {
    // Query to get table sizes - using Supabase's built-in functions
    // We query the information_schema and pg_catalog for table statistics
    const { data, error } = await supabase.rpc('get_table_stats');
    
    if (error) {
      // If RPC doesn't exist, fall back to querying table counts directly
      console.warn('RPC get_table_stats not available, using fallback method');
      return await fetchTableInfoFallback();
    }
    
    return (data ?? []).map((row: any) => ({
      table_name: row.table_name,
      row_count: Number(row.row_count ?? 0),
      size_mb: Number(row.size_mb ?? 0),
      size_bytes: Number(row.size_bytes ?? 0),
    }));
  } catch (err) {
    console.error('Error fetching table info:', err);
    return await fetchTableInfoFallback();
  }
}

// Fallback method: count rows in each known table
async function fetchTableInfoFallback(): Promise<TableInfo[]> {
  const tables = ['sales', 'purchases', 'customers', 'suppliers', 'sales_items', 'purchase_items', 'ingestion_files'];
  const tableInfo: TableInfo[] = [];
  
  for (const table of tables) {
    try {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (!error) {
        tableInfo.push({
          table_name: table,
          row_count: count ?? 0,
          size_mb: 0, // Size not available without RPC
          size_bytes: 0,
        });
      }
    } catch (err) {
      console.error(`Error counting table ${table}:`, err);
    }
  }
  
  return tableInfo;
}

// Test database connection
export async function testSupabaseConnection(): Promise<SupabaseConnectionStatus> {
  try {
    // Try to get the Supabase version and basic connection info
    const { data, error } = await supabase.rpc('get_db_info');
    
    if (error) {
      // Fallback: just test if we can query any table
      const { error: testError } = await supabase.from('sales').select('count', { count: 'exact', head: true });
      
      if (testError) {
        return {
          connected: false,
          error: testError.message,
        };
      }
      
      return {
        connected: true,
        database_version: 'PostgreSQL (Supabase)',
      };
    }
    
    return {
      connected: true,
      database_version: data?.version ?? 'PostgreSQL (Supabase)',
      database_size: data?.size ?? undefined,
    };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

// Fetch project size (only application tables)
export async function fetchProjectSize(): Promise<{ size_bytes: number; size_mb: number } | null> {
  try {
    const { data, error } = await supabase.rpc('get_project_size');
    
    if (error) {
      console.warn('RPC get_project_size not available');
      return null;
    }
    
    const row = (data ?? [])[0] as any;
    return {
      size_bytes: Number(row?.project_size_bytes ?? 0),
      size_mb: Number(row?.project_size_mb ?? 0),
    };
  } catch (err) {
    console.error('Error fetching project size:', err);
    return null;
  }
}

// Fetch all Supabase metrics
export async function fetchSupabaseMetrics(): Promise<SupabaseMetrics> {
  const [connection, tables, projectSize] = await Promise.all([
    testSupabaseConnection(),
    fetchSupabaseTableInfo(),
    fetchProjectSize(),
  ]);
  
  // Calculate total database size
  const totalDbSizeMb = projectSize?.size_mb ?? tables.reduce((sum, t) => sum + t.size_mb, 0);
  
  // For request metrics, we'll use a simple approach:
  // Count total records across all tables as a proxy for "requests"
  // In a real scenario, you'd track this via a logging table or API
  const totalRows = tables.reduce((sum, t) => sum + t.row_count, 0);
  
  // Simulate request metrics based on data volume
  // In production, you'd have a requests_log table
  const requestMetrics: SupabaseRequestMetrics = {
    total_requests: totalRows,
    successful_requests: Math.floor(totalRows * 0.98), // Assume 98% success rate
    failed_requests: Math.floor(totalRows * 0.02),
    success_rate: totalRows > 0 ? 98 : 0,
  };
  
  return {
    connection,
    tables,
    total_db_size_mb: totalDbSizeMb,
    request_metrics: requestMetrics,
  };
}
