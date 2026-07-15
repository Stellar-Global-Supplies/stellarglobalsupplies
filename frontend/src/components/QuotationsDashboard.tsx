import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search, RefreshCw } from 'lucide-react';
import { fetchQuotes } from '@/services/quotes';
import type { Quote } from '@/types';
import { format, parseISO } from 'date-fns';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function getStatusColor(status: Quote['status']) {
  switch (status) {
    case 'draft': return '#64748b';
    case 'sent': return '#f59e0b';
    case 'accepted': return '#10b981';
    case 'rejected': return '#ef4444';
    default: return '#64748b';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton
// ────────────────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-slate-800 relative overflow-hidden ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
      aria-hidden="true"
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Quotations Table
// ────────────────────────────────────────────────────────────────────────────

function QuotationsTable({ quotes }: { quotes: Quote[] }) {
  if (quotes.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <FileText size={40} className="text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">No quotations found</p>
        <p className="text-2xs text-slate-500 mt-1">Try adjusting your search</p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-left border-b border-slate-800">
              <th className="p-3 font-medium">Quote #</th>
              <th className="p-3 font-medium">Customer</th>
              <th className="p-3 font-medium">GST Number</th>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Expiry</th>
              <th className="p-3 font-medium text-right">Items</th>
              <th className="p-3 font-medium text-right">Subtotal</th>
              <th className="p-3 font-medium text-right">CGST</th>
              <th className="p-3 font-medium text-right">SGST</th>
              <th className="p-3 font-medium text-right">Total</th>
              <th className="p-3 font-medium text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => {
              const customer = quote.quote_customers;
              const itemsCount = quote.items?.length || 0;
              
              return (
                <tr key={quote.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="p-3 font-mono text-slate-300">
                    {quote.quote_number}
                  </td>
                  <td className="p-3">
                    <p className="text-slate-200 font-medium">{customer?.company_name || 'N/A'}</p>
                    {customer?.contact_person && (
                      <p className="text-2xs text-slate-500">{customer.contact_person}</p>
                    )}
                  </td>
                  <td className="p-3 text-slate-400 font-mono text-2xs">
                    {customer?.gst_number || 'N/A'}
                  </td>
                  <td className="p-3 text-slate-300 text-2xs">
                    {format(parseISO(quote.date), 'MMM dd, yyyy')}
                  </td>
                  <td className="p-3 text-slate-400 text-2xs">
                    {quote.expiry_date ? format(parseISO(quote.expiry_date), 'MMM dd, yyyy') : 'N/A'}
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {itemsCount}
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {fmt(quote.sub_total)}
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {fmt(quote.cgst_amount)}
                  </td>
                  <td className="p-3 text-right text-slate-300 tabular-nums">
                    {fmt(quote.sgst_amount)}
                  </td>
                  <td className="p-3 text-right text-slate-200 font-semibold tabular-nums">
                    {fmt(quote.grand_total)}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className="px-2 py-0.5 rounded text-2xs font-medium"
                      style={{
                        backgroundColor: `${getStatusColor(quote.status)}20`,
                        color: getStatusColor(quote.status),
                      }}
                    >
                      {quote.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard Main
// ────────────────────────────────────────────────────────────────────────────

export default function QuotationsDashboard() {
  const [search, setSearch] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const { data: quotes = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['quotations', search, limit, offset],
    queryFn: () => fetchQuotes({ search: search || undefined, limit, offset }),
    staleTime: 5 * 60 * 1000,
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    setOffset(0); // Reset to first page on new search
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  const hasMore = quotes.length === limit;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Quotations</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {quotes.length > 0 ? `${quotes.length} quotation${quotes.length !== 1 ? 's' : ''} found` : 'No quotations yet'}
          </p>
        </div>

        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800/60 rounded-xl border border-slate-700">
        <Search size={16} className="text-slate-500 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by quote number..."
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-2xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Data table */}
      {isLoading ? (
        <div className="glass-card p-5 space-y-3">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-red-400 mb-2">Failed to load quotations</p>
          <p className="text-2xs text-slate-500 mb-4">{(error as Error)?.message}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <QuotationsTable quotes={quotes} />

          {/* Pagination */}
          {quotes.length > 0 && (
            <div className="flex items-center justify-between text-2xs text-slate-500">
              <span>
                Showing {offset + 1} - {offset + quotes.length} quotations
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={offset === 0}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg border border-slate-700 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={!hasMore}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-lg border border-slate-700 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}