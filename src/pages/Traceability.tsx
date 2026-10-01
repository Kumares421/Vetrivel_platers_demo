import React, { useState, useEffect } from 'react';
import { 
  Network, Search, CheckCircle2, AlertTriangle, ArrowRight, Printer,
  Building, ShoppingCart, PackageCheck, Layers, Factory, ShieldCheck,
  Truck, Receipt, CreditCard, ChevronRight, RefreshCw, Calendar, 
  User, CheckCircle, Clock, ExternalLink, X, Filter
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { QuantityBadge } from '../components/QuantityBadge';

interface TraceabilityOrderData {
  order: any;
  order_items: any[];
  inwards: any[];
  job_cards: any[];
  production_executions: any[];
  qc_inspections: any[];
  dispatches: any[];
  invoices: any[];
  payments: any[];
  summary: {
    ordered_qty: number;
    inward_accepted_qty: number;
    inward_rejected_qty: number;
    remaining_to_inward: number;
    job_allocated_qty: number;
    remaining_to_allocate: number;
    production_processed_qty: number;
    qc_accepted_qty: number;
    dispatched_qty: number;
    remaining_to_dispatch: number;
    invoiced_amount: number;
    paid_amount: number;
    outstanding_amount: number;
    lifecycle_stage: string;
  };
}

interface TraceabilityProps {
  initialOrderId?: string;
  initialJobCardId?: string;
  onNavigate?: (tab: string) => void;
}

export const Traceability: React.FC<TraceabilityProps> = ({ 
  initialOrderId, 
  initialJobCardId,
  onNavigate 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ orders: any[]; job_cards: any[] }>({ orders: [], job_cards: [] });
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Active loaded data
  const [orderData, setOrderData] = useState<TraceabilityOrderData | null>(null);
  const [jobCardData, setJobCardData] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'ORDER' | 'JOB_CARD'>('ORDER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Active section filter or collapse
  const [activeStage, setActiveStage] = useState<string>('all');

  // Quick recent orders for immediate inspection
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  useEffect(() => {
    loadRecentOrders();
    if (initialOrderId) {
      loadOrderTrace(initialOrderId);
    } else if (initialJobCardId) {
      loadJobCardTrace(initialJobCardId);
    }
  }, [initialOrderId, initialJobCardId]);

  const loadRecentOrders = async () => {
    try {
      const orders = await apiFetch<any[]>('/customer-orders');
      if (Array.isArray(orders)) {
        setRecentOrders(orders.slice(0, 8));
        // If nothing is loaded yet, load the first order automatically
        if (!initialOrderId && !initialJobCardId && orders.length > 0 && !orderData) {
          loadOrderTrace(orders[0].id);
        }
      }
    } catch (e) {
      // ignore
    }
  };

  // Search handler
  const handleSearch = async (val: string) => {
    setSearchQuery(val);
    if (!val || val.trim().length < 2) {
      setSearchResults({ orders: [], job_cards: [] });
      setShowDropdown(false);
      return;
    }

    setSearching(true);
    try {
      const res = await apiFetch<{ orders: any[]; job_cards: any[] }>(`/traceability/search?q=${encodeURIComponent(val.trim())}`);
      setSearchResults(res || { orders: [], job_cards: [] });
      setShowDropdown(true);
    } catch (err: any) {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  // Load Order trace
  const loadOrderTrace = async (orderId: string) => {
    setLoading(true);
    setError('');
    setShowDropdown(false);
    try {
      const data = await apiFetch<TraceabilityOrderData>(`/traceability/order/${orderId}`);
      setOrderData(data);
      setJobCardData(null);
      setViewMode('ORDER');
      setSearchQuery(`${data.order.order_number} (${data.order.customer_name})`);
    } catch (err: any) {
      setError(err.message || 'Failed to load order traceability');
    } finally {
      setLoading(false);
    }
  };

  // Load Job Card trace
  const loadJobCardTrace = async (jobCardId: string) => {
    setLoading(true);
    setError('');
    setShowDropdown(false);
    try {
      const data = await apiFetch<any>(`/traceability/job-card/${jobCardId}`);
      setJobCardData(data);
      setViewMode('JOB_CARD');
      setSearchQuery(`${data.job_card.job_card_number} (${data.job_card.customer_name})`);
    } catch (err: any) {
      setError(err.message || 'Failed to load job card traceability');
    } finally {
      setLoading(false);
    }
  };

  const getStageBadgeColor = (stage: string) => {
    switch (stage) {
      case 'SETTLED':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'INVOICED':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'DISPATCHED':
        return 'bg-indigo-100 text-indigo-800 border-indigo-300';
      case 'QC_INSPECTED':
        return 'bg-teal-100 text-teal-800 border-teal-300';
      case 'IN_PRODUCTION':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'JOB_CARD_RELEASED':
        return 'bg-cyan-100 text-cyan-800 border-cyan-300';
      case 'PARTS_RECEIVED':
        return 'bg-violet-100 text-violet-800 border-violet-300';
      case 'ORDER_CONFIRMED':
        return 'bg-slate-100 text-slate-800 border-slate-300';
      case 'CANCELLED':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-teal-50 text-teal-600 rounded-lg">
              <Network className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">End-to-End Operational Traceability</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Auditable lifecycle tracking: <b>Customer Order → Parts Inward → Job Card → Production → QC → Dispatch → Invoice → Payment</b>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {orderData && (
            <button
              onClick={() => window.print()}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
              title="Print Full Audit Report"
            >
              <Printer className="w-4 h-4" />
              <span>Print Audit Trail</span>
            </button>
          )}
          <button
            onClick={() => {
              if (orderData?.order?.id) loadOrderTrace(orderData.order.id);
              else if (jobCardData?.job_card?.id) loadJobCardTrace(jobCardData.job_card.id);
            }}
            className="px-3.5 py-2 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Search & Selector Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Search Input */}
          <div className="relative w-full md:w-96">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => {
                  if (searchResults.orders.length > 0 || searchResults.job_cards.length > 0) {
                    setShowDropdown(true);
                  }
                }}
                placeholder="Search Order #, PO #, Job Card #, Inward #..."
                className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setShowDropdown(false);
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Autocomplete Dropdown */}
            {showDropdown && (searchResults.orders.length > 0 || searchResults.job_cards.length > 0) && (
              <div className="absolute z-30 mt-1 w-full bg-white rounded-lg border border-slate-200 shadow-xl max-h-80 overflow-y-auto">
                {searchResults.orders.length > 0 && (
                  <div className="p-2 border-b border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 flex items-center gap-1">
                      <ShoppingCart className="w-3 h-3 text-teal-600" /> Customer Orders
                    </div>
                    {searchResults.orders.map((ord) => (
                      <div
                        key={ord.id}
                        onClick={() => loadOrderTrace(ord.id)}
                        className="px-2.5 py-1.5 hover:bg-teal-50 cursor-pointer rounded text-xs flex justify-between items-center transition-colors"
                      >
                        <div>
                          <span className="font-bold text-slate-900">{ord.order_number}</span>
                          {ord.customer_po_number && (
                            <span className="text-slate-500 text-[11px] ml-1.5">(PO: {ord.customer_po_number})</span>
                          )}
                          <div className="text-[11px] text-slate-500">{ord.customer_name}</div>
                        </div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {ord.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {searchResults.job_cards.length > 0 && (
                  <div className="p-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-cyan-600" /> Job Cards
                    </div>
                    {searchResults.job_cards.map((jc) => (
                      <div
                        key={jc.id}
                        onClick={() => loadJobCardTrace(jc.id)}
                        className="px-2.5 py-1.5 hover:bg-cyan-50 cursor-pointer rounded text-xs flex justify-between items-center transition-colors"
                      >
                        <div>
                          <span className="font-bold text-slate-900">{jc.job_card_number}</span>
                          <span className="text-slate-500 text-[11px] ml-1.5">({jc.part_number})</span>
                          <div className="text-[11px] text-slate-500">{jc.customer_name} • Ord: {jc.order_number}</div>
                        </div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700">
                          {jc.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Recent Order Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto py-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap mr-1">
              Recent Orders:
            </span>
            {recentOrders.map((ord) => (
              <button
                key={ord.id}
                onClick={() => loadOrderTrace(ord.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors ${
                  orderData?.order?.id === ord.id
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {ord.order_number}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading or Error State */}
      {loading && (
        <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
          <RefreshCw className="w-8 h-8 text-teal-600 animate-spin mx-auto mb-2" />
          <p className="text-xs font-bold text-slate-600">Reconstructing operational audit trail...</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ----------------- ORDER TRACEABILITY VIEW ----------------- */}
      {!loading && viewMode === 'ORDER' && orderData && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/50">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <h2 className="text-lg font-black text-slate-900">
                    Order {orderData.order.order_number}
                  </h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStageBadgeColor(orderData.summary.lifecycle_stage)}`}>
                    Stage: {orderData.summary.lifecycle_stage.replace(/_/g, ' ')}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-slate-200 text-slate-700 uppercase">
                    Status: {orderData.order.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-y-1 gap-x-4">
                  <span>Customer: <strong className="text-slate-800">{orderData.order.customer_name} ({orderData.order.customer_code})</strong></span>
                  {orderData.order.customer_po_number && (
                    <span>PO Ref: <strong className="text-slate-800">{orderData.order.customer_po_number}</strong></span>
                  )}
                  <span>Order Date: <strong>{new Date(orderData.order.order_date).toLocaleDateString()}</strong></span>
                  {orderData.order.customer_gstin && (
                    <span>GSTIN: <strong className="text-slate-800">{orderData.order.customer_gstin}</strong></span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (onNavigate) onNavigate('customer-orders');
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                >
                  <ShoppingCart className="w-3.5 h-3.5 text-teal-600" />
                  <span>Open in Orders</span>
                </button>
              </div>
            </div>

            {/* Summary Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-slate-100 bg-white">
              <div className="p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ordered Qty</div>
                <div className="text-lg font-black text-slate-900 mt-1">{orderData.summary.ordered_qty.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Lines: {orderData.order_items.length}</div>
              </div>

              <div className="p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Inward Accepted</div>
                <div className="text-lg font-black text-emerald-600 mt-1">{orderData.summary.inward_accepted_qty.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Pending: {orderData.summary.remaining_to_inward.toLocaleString()}</div>
              </div>

              <div className="p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Job Card Qty</div>
                <div className="text-lg font-black text-cyan-600 mt-1">{orderData.summary.job_allocated_qty.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Pending: {orderData.summary.remaining_to_allocate.toLocaleString()}</div>
              </div>

              <div className="p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dispatched Qty</div>
                <div className="text-lg font-black text-indigo-600 mt-1">{orderData.summary.dispatched_qty.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Pending: {orderData.summary.remaining_to_dispatch.toLocaleString()}</div>
              </div>

              <div className="p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Invoiced Total</div>
                <div className="text-lg font-black text-slate-900 mt-1">₹{orderData.summary.invoiced_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Invoices: {orderData.invoices.length}</div>
              </div>

              <div className="p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Outstanding</div>
                <div className={`text-lg font-black mt-1 ${orderData.summary.outstanding_amount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  ₹{orderData.summary.outstanding_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Paid: ₹{orderData.summary.paid_amount.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* 8-Stage Interactive Lineage Stepper */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm print:hidden">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span>Operational Pipeline Verification</span>
              <span className="text-[11px] font-normal normal-case text-slate-400">Click any stage to filter section</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {[
                { id: 'orders', label: '1. Order', count: 1, icon: ShoppingCart, color: 'text-teal-600', active: true },
                { id: 'items', label: '2. Lines', count: orderData.order_items.length, icon: Layers, color: 'text-blue-600', active: orderData.order_items.length > 0 },
                { id: 'inwards', label: '3. Inward', count: orderData.inwards.length, icon: PackageCheck, color: 'text-violet-600', active: orderData.inwards.length > 0 },
                { id: 'jobs', label: '4. Job Card', count: orderData.job_cards.length, icon: Layers, color: 'text-cyan-600', active: orderData.job_cards.length > 0 },
                { id: 'production', label: '5. Production', count: orderData.production_executions.length, icon: Factory, color: 'text-amber-600', active: orderData.production_executions.length > 0 },
                { id: 'qc', label: '6. QC Check', count: orderData.qc_inspections.length, icon: ShieldCheck, color: 'text-teal-600', active: orderData.qc_inspections.length > 0 },
                { id: 'dispatch', label: '7. Dispatch', count: orderData.dispatches.length, icon: Truck, color: 'text-indigo-600', active: orderData.dispatches.length > 0 },
                { id: 'invoices', label: '8. Invoicing', count: orderData.invoices.length, icon: Receipt, color: 'text-emerald-600', active: orderData.invoices.length > 0 }
              ].map((stage) => {
                const Icon = stage.icon;
                const isSelected = activeStage === stage.id;
                return (
                  <button
                    key={stage.id}
                    onClick={() => setActiveStage(activeStage === stage.id ? 'all' : stage.id)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/60 ring-2 ring-teal-500/20'
                        : stage.active
                        ? 'border-slate-200 hover:border-slate-300 bg-white'
                        : 'border-slate-100 bg-slate-50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Icon className={`w-3.5 h-3.5 ${stage.active ? stage.color : 'text-slate-400'}`} />
                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                        stage.count > 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {stage.count}
                      </span>
                    </div>
                    <div className="text-[11px] font-bold text-slate-800 leading-tight">{stage.label}</div>
                    <div className="text-[9px] font-semibold mt-0.5 text-slate-500">
                      {stage.count > 0 ? 'Verified' : 'Pending'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ================= STAGE SECTIONS ================= */}

          {/* Stage 1 & 2: Order Lines */}
          {(activeStage === 'all' || activeStage === 'items' || activeStage === 'orders') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-teal-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Stage 1 & 2: Customer Order Lines ({orderData.order_items.length})
                  </h3>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                      <th className="py-2.5 px-4">Part #</th>
                      <th className="py-2.5 px-4">Part Description</th>
                      <th className="py-2.5 px-4">Process / Coating</th>
                      <th className="py-2.5 px-4 text-right">Ordered Qty</th>
                      <th className="py-2.5 px-4 text-right">Rate</th>
                      <th className="py-2.5 px-4 text-right">Line Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {orderData.order_items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-4 font-bold text-slate-900">{item.part_number}</td>
                        <td className="py-2.5 px-4">{item.part_name}</td>
                        <td className="py-2.5 px-4">
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[10px]">
                            {item.process_type || 'Standard Plating'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-slate-900">
                          {item.quantity.toLocaleString()} {item.base_unit || 'pcs'}
                        </td>
                        <td className="py-2.5 px-4 text-right">₹{item.rate.toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{item.line_amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Stage 3: Parts Inward Receipts */}
          {(activeStage === 'all' || activeStage === 'inwards') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-violet-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Stage 3: Parts Inward Receipts ({orderData.inwards.length})
                  </h3>
                </div>
                {orderData.summary.remaining_to_inward > 0 && (
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Pending Inward: {orderData.summary.remaining_to_inward.toLocaleString()} pcs
                  </span>
                )}
              </div>
              {orderData.inwards.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No parts inward recorded against this customer order yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                        <th className="py-2.5 px-4">Inward #</th>
                        <th className="py-2.5 px-4">DC / Challan #</th>
                        <th className="py-2.5 px-4">Part</th>
                        <th className="py-2.5 px-4">Received Date</th>
                        <th className="py-2.5 px-4 text-right">Accepted Qty</th>
                        <th className="py-2.5 px-4 text-right">Rejected Qty</th>
                        <th className="py-2.5 px-4">Received By</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {orderData.inwards.map((inw) => (
                        <tr key={inw.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-bold text-slate-900">{inw.inward_number}</td>
                          <td className="py-2.5 px-4 font-semibold text-slate-800">{inw.challan_number || '—'}</td>
                          <td className="py-2.5 px-4">
                            <span className="font-semibold text-slate-900">{inw.part_number}</span>
                            <span className="text-slate-400 text-[11px] ml-1">({inw.part_name})</span>
                          </td>
                          <td className="py-2.5 px-4">{new Date(inw.received_date).toLocaleDateString()}</td>
                          <td className="py-2.5 px-4 text-right font-bold text-emerald-600">
                            {inw.accepted_qty.toLocaleString()} {inw.base_unit || 'pcs'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold text-rose-500">
                            {inw.rejected_qty > 0 ? inw.rejected_qty.toLocaleString() : '0'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{inw.received_by_name}</td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-50 text-violet-700">
                              {inw.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Stage 4: Job Cards */}
          {(activeStage === 'all' || activeStage === 'jobs') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Stage 4: Production Job Cards ({orderData.job_cards.length})
                  </h3>
                </div>
                {orderData.summary.remaining_to_allocate > 0 && (
                  <span className="text-[11px] font-bold text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200">
                    Remaining Inward to Allocate: {orderData.summary.remaining_to_allocate.toLocaleString()} pcs
                  </span>
                )}
              </div>
              {orderData.job_cards.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No Job Cards created for these parts yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                        <th className="py-2.5 px-4">Job Card #</th>
                        <th className="py-2.5 px-4">Source Inward #</th>
                        <th className="py-2.5 px-4">Part #</th>
                        <th className="py-2.5 px-4">Process</th>
                        <th className="py-2.5 px-4">Tank</th>
                        <th className="py-2.5 px-4 text-right">Allocated Qty</th>
                        <th className="py-2.5 px-4">Target Date</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                        <th className="py-2.5 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {orderData.job_cards.map((jc) => (
                        <tr key={jc.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-bold text-slate-900">{jc.job_card_number}</td>
                          <td className="py-2.5 px-4 font-semibold text-slate-600">{jc.inward_number}</td>
                          <td className="py-2.5 px-4 font-medium">{jc.part_number}</td>
                          <td className="py-2.5 px-4">
                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">
                              {jc.plating_process}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{jc.tank_code || jc.tank_name || '—'}</td>
                          <td className="py-2.5 px-4 text-right font-bold text-cyan-700">
                            {jc.allocated_qty.toLocaleString()} {jc.base_unit || 'pcs'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500">
                            {jc.target_date ? new Date(jc.target_date).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              jc.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' :
                              jc.status === 'IN_PRODUCTION' ? 'bg-amber-50 text-amber-700' :
                              jc.status === 'CANCELLED' ? 'bg-rose-50 text-rose-700' :
                              'bg-cyan-50 text-cyan-700'
                            }`}>
                              {jc.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <button
                              onClick={() => loadJobCardTrace(jc.id)}
                              className="text-teal-600 hover:text-teal-800 text-[11px] font-bold flex items-center justify-center gap-1 mx-auto"
                            >
                              <span>Trace</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Stage 5: Production Execution */}
          {(activeStage === 'all' || activeStage === 'production') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Factory className="w-4 h-4 text-amber-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Stage 5: Production Executions ({orderData.production_executions.length})
                  </h3>
                </div>
              </div>
              {orderData.production_executions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No production runs recorded for this order yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                        <th className="py-2.5 px-4">Production #</th>
                        <th className="py-2.5 px-4">Job Card #</th>
                        <th className="py-2.5 px-4">Plating Tank</th>
                        <th className="py-2.5 px-4">Run Date</th>
                        <th className="py-2.5 px-4 text-right">Processed Qty</th>
                        <th className="py-2.5 px-4 text-right">Rejections</th>
                        <th className="py-2.5 px-4">Operator</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {orderData.production_executions.map((pe) => (
                        <tr key={pe.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-bold text-slate-900">{pe.production_number}</td>
                          <td className="py-2.5 px-4 font-semibold text-cyan-700">{pe.job_card_number}</td>
                          <td className="py-2.5 px-4 text-slate-600">{pe.tank_code || pe.tank_name || 'Tank'}</td>
                          <td className="py-2.5 px-4">{new Date(pe.production_date).toLocaleDateString()}</td>
                          <td className="py-2.5 px-4 text-right font-bold text-amber-700">{pe.processed_qty.toLocaleString()} pcs</td>
                          <td className="py-2.5 px-4 text-right font-bold text-rose-500">{pe.rejected_qty || 0}</td>
                          <td className="py-2.5 px-4 text-slate-600">{pe.operator_name}</td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800">
                              {pe.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Stage 6: QC Inspections */}
          {(activeStage === 'all' || activeStage === 'qc') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Stage 6: Quality Control Inspections ({orderData.qc_inspections.length})
                  </h3>
                </div>
              </div>
              {orderData.qc_inspections.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No QC inspections recorded for this order yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                        <th className="py-2.5 px-4">QC Report #</th>
                        <th className="py-2.5 px-4">Production #</th>
                        <th className="py-2.5 px-4">Job Card #</th>
                        <th className="py-2.5 px-4">Inspection Date</th>
                        <th className="py-2.5 px-4 text-right">Inspected</th>
                        <th className="py-2.5 px-4 text-right">Accepted</th>
                        <th className="py-2.5 px-4 text-right">Rejected</th>
                        <th className="py-2.5 px-4 text-center">QC Verdict</th>
                        <th className="py-2.5 px-4">Inspector</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {orderData.qc_inspections.map((qc) => (
                        <tr key={qc.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-bold text-slate-900">{qc.qc_number}</td>
                          <td className="py-2.5 px-4 text-slate-600">{qc.production_number}</td>
                          <td className="py-2.5 px-4 font-semibold text-cyan-700">{qc.job_card_number}</td>
                          <td className="py-2.5 px-4">{new Date(qc.inspection_date).toLocaleDateString()}</td>
                          <td className="py-2.5 px-4 text-right font-medium">{qc.inspected_qty.toLocaleString()}</td>
                          <td className="py-2.5 px-4 text-right font-bold text-emerald-600">{qc.accepted_qty.toLocaleString()} pcs</td>
                          <td className="py-2.5 px-4 text-right font-bold text-rose-500">{qc.rejected_qty || 0}</td>
                          <td className="py-2.5 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                              qc.status === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {qc.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{qc.inspector_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Stage 7: Dispatches */}
          {(activeStage === 'all' || activeStage === 'dispatch') && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Stage 7: Finished Goods Dispatches ({orderData.dispatches.length})
                  </h3>
                </div>
              </div>
              {orderData.dispatches.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No dispatches recorded for this order yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                        <th className="py-2.5 px-4">Dispatch DC #</th>
                        <th className="py-2.5 px-4">Job Card #</th>
                        <th className="py-2.5 px-4">QC #</th>
                        <th className="py-2.5 px-4">Dispatch Date</th>
                        <th className="py-2.5 px-4">Vehicle / Challan</th>
                        <th className="py-2.5 px-4 text-right">Dispatched Qty</th>
                        <th className="py-2.5 px-4">Dispatched By</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {orderData.dispatches.map((disp) => (
                        <tr key={disp.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-bold text-slate-900">{disp.dispatch_number}</td>
                          <td className="py-2.5 px-4 font-semibold text-cyan-700">{disp.job_card_number}</td>
                          <td className="py-2.5 px-4 text-slate-600">{disp.qc_number}</td>
                          <td className="py-2.5 px-4">{new Date(disp.dispatch_date).toLocaleDateString()}</td>
                          <td className="py-2.5 px-4 text-slate-600">{disp.vehicle_number || disp.challan_number || 'Direct'}</td>
                          <td className="py-2.5 px-4 text-right font-bold text-indigo-700">{disp.dispatched_qty.toLocaleString()} pcs</td>
                          <td className="py-2.5 px-4 text-slate-600">{disp.dispatched_by_name}</td>
                          <td className="py-2.5 px-4 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700">
                              {disp.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Stage 8: Invoices & Payment Settlements */}
          {(activeStage === 'all' || activeStage === 'invoices') && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Invoices */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                      Stage 8A: Tax Invoices ({orderData.invoices.length})
                    </h3>
                  </div>
                </div>
                {orderData.invoices.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    No invoices generated for this order yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                          <th className="py-2.5 px-3">Invoice #</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3 text-right">Taxable</th>
                          <th className="py-2.5 px-3 text-right">GST</th>
                          <th className="py-2.5 px-3 text-right">Total</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {orderData.invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-bold text-slate-900">{inv.invoice_number}</td>
                            <td className="py-2.5 px-3">{new Date(inv.invoice_date).toLocaleDateString()}</td>
                            <td className="py-2.5 px-3 text-right">₹{inv.subtotal.toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-right text-slate-600">₹{inv.tax_amount.toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-700">₹{inv.total_amount.toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700">
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Payments */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                      Stage 8B: Payment Settlements ({orderData.payments.length})
                    </h3>
                  </div>
                </div>
                {orderData.payments.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    No payment collections allocated to these invoices yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                          <th className="py-2.5 px-3">Receipt #</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Mode</th>
                          <th className="py-2.5 px-3">Invoice #</th>
                          <th className="py-2.5 px-3 text-right">Allocated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {orderData.payments.map((pay) => (
                          <tr key={pay.allocation_id || pay.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-bold text-slate-900">{pay.payment_number || pay.receipt_number}</td>
                            <td className="py-2.5 px-3">{new Date(pay.payment_date).toLocaleDateString()}</td>
                            <td className="py-2.5 px-3">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                                {pay.payment_mode}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-600">{pay.invoice_number}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-600">
                              ₹{pay.allocated_amount.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ----------------- JOB CARD FOCUSED TRACE VIEW ----------------- */}
      {!loading && viewMode === 'JOB_CARD' && jobCardData && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-cyan-50/30">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <h2 className="text-lg font-black text-slate-900">
                    Job Card {jobCardData.job_card.job_card_number}
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-100 text-cyan-800 border border-cyan-300">
                    Status: {jobCardData.job_card.status}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                    Process: {jobCardData.job_card.plating_process}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-y-1 gap-x-4">
                  <span>Customer: <strong className="text-slate-800">{jobCardData.job_card.customer_name}</strong></span>
                  <span>Part: <strong className="text-slate-800">{jobCardData.job_card.part_number} ({jobCardData.job_card.part_name})</strong></span>
                  <span>Allocated Qty: <strong className="text-slate-900">{jobCardData.job_card.allocated_qty} {jobCardData.job_card.base_unit || 'pcs'}</strong></span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadOrderTrace(jobCardData.job_card.customer_order_id)}
                  className="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>Trace Full Order #{jobCardData.job_card.order_number}</span>
                </button>
              </div>
            </div>

            {/* Upstream Provenance Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 p-4 bg-slate-50/50 text-xs">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <ShoppingCart className="w-3 h-3 text-teal-600" /> Originating Customer Order
                </div>
                <div className="font-bold text-slate-900">{jobCardData.job_card.order_number}</div>
                <div className="text-slate-500 text-[11px]">PO Ref: {jobCardData.job_card.customer_po_number || 'N/A'}</div>
                <div className="text-slate-500 text-[11px]">Date: {new Date(jobCardData.job_card.order_date).toLocaleDateString()}</div>
              </div>

              <div className="sm:pl-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <PackageCheck className="w-3 h-3 text-violet-600" /> Source Parts Inward
                </div>
                <div className="font-bold text-slate-900">{jobCardData.job_card.inward_number}</div>
                <div className="text-slate-500 text-[11px]">Challan #: {jobCardData.job_card.challan_number || '—'}</div>
                <div className="text-slate-500 text-[11px]">Inward Total: {jobCardData.job_card.inward_accepted_qty} pcs</div>
              </div>

              <div className="sm:pl-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Factory className="w-3 h-3 text-amber-600" /> Target Station & Release
                </div>
                <div className="font-bold text-slate-900">{jobCardData.job_card.tank_code || jobCardData.job_card.tank_name || 'Designated Tank'}</div>
                <div className="text-slate-500 text-[11px]">Released by: {jobCardData.job_card.released_by_name}</div>
                <div className="text-slate-500 text-[11px]">Target Date: {jobCardData.job_card.target_date ? new Date(jobCardData.job_card.target_date).toLocaleDateString() : 'N/A'}</div>
              </div>
            </div>
          </div>

          {/* Downstream Execution Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Production Executions */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
                <Factory className="w-4 h-4 text-amber-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Production Runs ({jobCardData.downstream.production.length})
                </h4>
              </div>
              {jobCardData.downstream.production.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">No production runs recorded</div>
              ) : (
                <div className="space-y-2">
                  {jobCardData.downstream.production.map((p: any) => (
                    <div key={p.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>{p.production_number}</span>
                        <span className="text-amber-700">{p.processed_qty} pcs</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        Operator: {p.operator_name} • Date: {new Date(p.production_date).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* QC Inspections */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  QC Inspections ({jobCardData.downstream.qc.length})
                </h4>
              </div>
              {jobCardData.downstream.qc.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">No QC inspection recorded</div>
              ) : (
                <div className="space-y-2">
                  {jobCardData.downstream.qc.map((q: any) => (
                    <div key={q.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>{q.qc_number}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                          q.status === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {q.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-1">
                        Accepted: <strong>{q.accepted_qty} pcs</strong> {q.rejected_qty > 0 && `(Rej: ${q.rejected_qty})`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dispatches */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
                <Truck className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Dispatches ({jobCardData.downstream.dispatches.length})
                </h4>
              </div>
              {jobCardData.downstream.dispatches.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">No dispatches recorded</div>
              ) : (
                <div className="space-y-2">
                  {jobCardData.downstream.dispatches.map((d: any) => (
                    <div key={d.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>{d.dispatch_number}</span>
                        <span className="text-indigo-700">{d.dispatched_qty} pcs</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        DC: {d.delivery_challan_number || 'Direct'} • {new Date(d.dispatch_date).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Traceability;
