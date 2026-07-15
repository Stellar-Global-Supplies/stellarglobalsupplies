import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, DollarSign, Clock, CheckCircle, RefreshCw, Filter } from 'lucide-react';
import { fetchOrderSummary, fetchOrders } from '@/services/orders';
import type { Order, OrderFilters, FinancialYear } from '@/types';
import { format, parseISO } from 'date-fns';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

const FINANCIAL_YEAR_OPTIONS: FinancialYear[] = [
  { startYear: 2026, label: 'FY 2026-27' },
  { startYear: 2025, label: 'FY 2025-26' },
  { startYear: 2024, label: 'FY 2024-25' },
];

const MONTH_OPTIONS = [
  { value: 0, label: 'All Months' },
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Order Received', label: 'Order Received' },
  { value: 'Processing', label: 'Processing' },
  { value: 'Ready to Dispatch', label: 'Ready to Dispatch' },
  { value: 'Delivered', label: 'Delivered' },
];

// ────────────────────────────────────────────────────────────────────────────
// KPI Card Widget
// ────────────────────────────────────────────────────────────────────────────

interface WidgetCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
}

function WidgetCard({ title, value, subtitle, icon, color }: WidgetCardProps) {
  return (
    <div className="glass-card p-5 card-glow">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</p>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-slate-100 tabular-nums">{value}</p>
      {subtitle && <p className="text-2xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Orders Table
// ────────────────────────────────────────────────────────────────────────────

function OrdersTable({ orders }: { orders: Order[] }) {
  const getStatusColor = (status: Order['status']) => {
    switch (status) {
      case 'Order Received': return '#6366f1';
      case 'Processing': return '#f59e0b';
      case 'Ready to Dispatch': return '#38bdf8';
      case 'Delivered': return '#10b981';
      default: return '#64748b';
    }
  };

  const getPaymentColor = (status: Order['payment_status']) => {
    switch (status) {
      case 'Paid': return '#10b981';
      case 'Pending': return '#ef4444';
      case 'Partial': return '#f59e0b';
      default: return '#64748b';
    }
  };

  if (orders.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Package size={40} className="text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No orders found</p>
        <p className="text-2xs text-slate-500 mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-left border-b border-slate-800">
              <th className="p-3 font-medium">Order ID</th>
              <th className="p-3 font-medium">Customer</th>
              <th className="p-3 font-medium">Product</th>
              <th className="p-3 font-medium">Material</th>
              <th className="p-3 font-medium text-right">Qty</th>
              <th className="p-3 font-medium text-right">Cost</th>
              <th className="p-3 font-medium text-right">CGST</th>
              <th className="p-3 font-medium text-right">SGST</th>
              <th className="p-3 font-medium text-right">Total</th>
              <th className="p-3 font-medium">Payment</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="p-3 font-mono text-slate-300">
                    {order.id.slice(0, 8)}
                  </td>
                  <td className="p-3">
                    <div>
                      <p className="text-slate-200 font-medium">{order.customer_name}</p>
                      <p className="text-2xs text-slate-500">{order.phone}</p>
                    </div>
                  </td>
                  <td className="p-3 text-slate-300">{order.product_type}</td>
                  <td className="p-3">
                    <span
                      className="px-2 py-0.5 rounded text-2xs font-medium"
                      style={{
                        backgroundColor: order.material === 'SS' ? '#6366f120' : '#06b6d420',
                        color: order.material === 'SS' ? '#818cf8' : '#22d3ee',
                      }}
                    >
                      {order.material}
                    </span>
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {order.quantity} {order.unit}
                  </td>
                  <td className="p-3 text-right text-slate-200 font-medium tabular-nums">
                    {fmt(order.sale_cost)}
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {fmt(order.cgst_total)}
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {fmt(order.sgst_total)}
                  </td>
                  <td className="p-3 text-right text-slate-200 font-semibold tabular-nums">
                    {fmt(order.sale_cost + order.cgst_total + order.sgst_total)}
                  </td>
                  <td className="p-3">
                    <span
                      className="px-2 py-0.5 rounded text-2xs font-medium"
                      style={{
                        backgroundColor: `${getPaymentColor(order.payment_status)}20`,
                        color: getPaymentColor(order.payment_status),
                      }}
                    >
                      {order.payment_status}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className="px-2 py-0.5 rounded text-2xs font-medium"
                      style={{
                        backgroundColor: `${getStatusColor(order.status)}20`,
                        color: getStatusColor(order.status),
                      }}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400 text-2xs">
                    {format(parseISO(order.created_at), 'MMM dd, yyyy')}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard Main
// ────────────────────────────────────────────────────────────────────────────

export default function OrderSummaryDashboard() {
  const [filters, setFilters] = useState<OrderFilters>({});
  const [selectedFY, setSelectedFY] = useState<FinancialYear | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(0); // 0 = all months
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['order-summary', filters],
    queryFn: () => fetchOrderSummary(filters),
    staleTime: 30_000,
  });

  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => fetchOrders(filters),
    staleTime: 30_000,
  });

  const isLoading = summaryLoading || ordersLoading;

  const handleFYChange = (fy: FinancialYear | null) => {
    setSelectedFY(fy);
    setFilters(fy ? { financialYear: fy } : {});
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    setSelectedFY(null);
    const newFilters: OrderFilters = { year };
    if (selectedMonth > 0) newFilters.month = selectedMonth;
    if (selectedStatus) newFilters.status = selectedStatus as Order['status'];
    setFilters(newFilters);
  };

  const handleMonthChange = (month: number) => {
    setSelectedMonth(month);
    const newFilters: OrderFilters = { year: selectedYear };
    if (month > 0) newFilters.month = month;
    if (selectedStatus) newFilters.status = selectedStatus as Order['status'];
    setFilters(newFilters);
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    const newFilters: OrderFilters = { year: selectedYear };
    if (status) newFilters.status = status as Order['status'];
    setFilters(newFilters);
  };

  const handleRefresh = () => {
    refetchSummary();
    refetchOrders();
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Order Summary</h2>
          <p className="text-sm text-slate-400 mt-0.5">Order management system overview</p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Filters</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-2xs text-slate-400 mb-1 block">Financial Year</label>
            <select
              value={selectedFY?.label ?? ''}
              onChange={(e) => {
                const fy = FINANCIAL_YEAR_OPTIONS.find(f => f.label === e.target.value) || null;
                handleFYChange(fy);
              }}
              className="w-full text-2xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="">All Time</option>
              {FINANCIAL_YEAR_OPTIONS.map((fy) => (
                <option key={fy.label} value={fy.label}>{fy.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-2xs text-slate-400 mb-1 block">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="w-full text-2xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
            >
              {[2026, 2025, 2024, 2023].map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-2xs text-slate-400 mb-1 block">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(Number(e.target.value))}
              className="w-full text-2xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-2xs text-slate-400 mb-1 block">Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full text-2xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* KPI Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <WidgetCard
          title="Total Orders"
          value={summary?.total_orders.toString() ?? '0'}
          subtitle="All time orders"
          icon={<Package size={20} />}
          color="#6366f1"
        />
        <WidgetCard
          title="Total Revenue"
          value={fmt(summary?.total_revenue ?? 0)}
          subtitle="From all orders"
          icon={<DollarSign size={20} />}
          color="#10b981"
        />
        <WidgetCard
          title="Pending Orders"
          value={summary?.pending_orders.toString() ?? '0'}
          subtitle="Awaiting processing"
          icon={<Clock size={20} />}
          color="#f59e0b"
        />
        <WidgetCard
          title="Delivered Orders"
          value={summary?.delivered_orders.toString() ?? '0'}
          subtitle="Successfully completed"
          icon={<CheckCircle size={20} />}
          color="#38bdf8"
        />
      </div>

      {/* Orders Table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Recent Orders</h3>
          <span className="text-2xs text-slate-500">
            Showing {orders?.length ?? 0} orders
          </span>
        </div>
        {isLoading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400 mx-auto"></div>
            <p className="text-xs text-slate-400 mt-2">Loading orders...</p>
          </div>
        ) : (
          <OrdersTable orders={orders ?? []} />
        )}
      </div>
    </div>
  );
}