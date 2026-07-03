import { supabase } from '@/lib/supabase';
import type { Order, OrderSummary, OrderFilters, FinancialYear } from '@/types';

export async function fetchOrders(filters?: OrderFilters): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  // Apply filters
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.financialYear) {
    const fy = filters.financialYear;
    const startDate = `${fy.startYear}-04-01`;
    const endDate = `${fy.startYear + 1}-03-31`;
    query = query.gte('created_at', startDate).lte('created_at', endDate);
  } else if (filters?.year) {
    const year = filters.year;
    if (filters?.month) {
      const month = String(filters.month).padStart(2, '0');
      const lastDay = new Date(year, filters.month, 0).getDate();
      const startDate = `${year}-${month}-01`;
      const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    } else {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching orders:', error);
    throw new Error(`Failed to fetch orders: ${error.message}`);
  }

  return data ?? [];
}

export async function fetchOrderSummary(filters?: OrderFilters): Promise<OrderSummary> {
  const orders = await fetchOrders(filters);

  // Calculate summary metrics
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + o.sale_cost, 0);
  const pendingOrders = orders.filter(o => o.status === 'Order Received' || o.status === 'Processing').length;
  const deliveredOrders = orders.filter(o => o.status === 'Delivered').length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Group by status
  const statusMap = new Map<string, number>();
  orders.forEach(o => {
    statusMap.set(o.status, (statusMap.get(o.status) || 0) + 1);
  });
  const ordersByStatus = Array.from(statusMap.entries()).map(([status, count]) => ({
    status: status as Order['status'],
    count,
  }));

  // Group by payment status
  const paymentMap = new Map<string, number>();
  orders.forEach(o => {
    paymentMap.set(o.payment_status, (paymentMap.get(o.payment_status) || 0) + 1);
  });
  const ordersByPayment = Array.from(paymentMap.entries()).map(([payment_status, count]) => ({
    payment_status: payment_status as Order['payment_status'],
    count,
  }));

  // Get recent orders (last 10)
  const recentOrders = orders.slice(0, 10);

  return {
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    pending_orders: pendingOrders,
    delivered_orders: deliveredOrders,
    avg_order_value: avgOrderValue,
    orders_by_status: ordersByStatus,
    orders_by_payment: ordersByPayment,
    recent_orders: recentOrders,
  };
}

export async function createOrder(order: Omit<Order, 'id' | 'created_at' | 'updated_at'>): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .insert([order])
    .select()
    .single();

  if (error) {
    console.error('Error creating order:', error);
    throw new Error(`Failed to create order: ${error.message}`);
  }

  return data;
}

export async function updateOrder(id: string, updates: Partial<Order>): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating order:', error);
    throw new Error(`Failed to update order: ${error.message}`);
  }

  return data;
}

export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting order:', error);
    throw new Error(`Failed to delete order: ${error.message}`);
  }
}