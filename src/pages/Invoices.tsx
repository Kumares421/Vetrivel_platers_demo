import React, { useState, useEffect } from 'react';
import { 
  Receipt, AlertTriangle, Plus, Search, Filter, Printer, XCircle, 
  CheckCircle2, FileText, Building2, User, Calendar, ShieldAlert, Check, RefreshCw
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QuantityBadge } from '../components/QuantityBadge';
import { StatusBadge } from '../components/StatusBadge';

interface PendingDispatch {
  dispatch_id: string;
  dispatch_number: string;
  dispatch_date: string;
  dispatched_qty: number;
  already_invoiced_qty: number;
  remaining_invoiceable_qty: number;
  suggested_unit_price: number;
  vehicle_number?: string;
  challan_number?: string;
  job_card_id: string;
  job_card_number: string;
  plating_process: string;
  part_id: string;
  part_number: string;
  part_name: string;
  base_unit: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  customer_address?: string;
  customer_gstin?: string;
}

interface InvoiceLine {
  id?: string;
  dispatch_id: string;
  dispatch_number?: string;
  job_card_number?: string;
  part_number?: string;
  part_name?: string;
  description: string;
  quantity: number;
  remaining_invoiceable_qty?: number;
  unit_price: number;
  taxable_value: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
}

interface InvoiceRecord {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  customer_master_address?: string;
  customer_phone?: string;
  customer_email?: string;
  invoice_date: string;
  subtotal: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_amount: number;
  discount_amount: number;
  round_off: number;
  total_amount: number;
  place_of_supply?: string;
  billing_address?: string;
  shipping_address?: string;
  gstin?: string;
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  cancellation_reason?: string;
  cancelled_at?: string;
  created_by_name?: string;
  cancelled_by_name?: string;
  line_count?: number;
  total_quantity?: number;
  lines?: InvoiceLine[];
}

export const Invoices: React.FC = () => {
  const { user, isAdmin, isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Dashboard Stats & Lists
  const [stats, setStats] = useState<any>({});
  const [pendingQueue, setPendingQueue] = useState<PendingDispatch[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);

  // Filters for Invoice Register
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');

  // Multi-dispatch selection state for queue
  const [selectedDispatchIds, setSelectedDispatchIds] = useState<string[]>([]);

  // Create Invoice Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createCustomerId, setCreateCustomerId] = useState('');
  const [createInvoiceDate, setCreateInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [createPlaceOfSupply, setCreatePlaceOfSupply] = useState('Tamil Nadu');
  const [createBillingAddress, setCreateBillingAddress] = useState('');
  const [createShippingAddress, setCreateShippingAddress] = useState('');
  const [createGstin, setCreateGstin] = useState('');
  const [createDiscount, setCreateDiscount] = useState<number>(0);
  const [createRoundOff, setCreateRoundOff] = useState<number>(0);
  const [isInterstate, setIsInterstate] = useState(false);
  const [createLines, setCreateLines] = useState<{
    dispatch_id: string;
    dispatch_number: string;
    job_card_number: string;
    part_name: string;
    part_number: string;
    dispatched_qty: number;
    already_invoiced_qty: number;
    remaining_invoiceable_qty: number;
    quantity: number;
    unit_price: number;
    gst_rate: number;
    description: string;
  }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Detail / Print Modal State
  const [viewInvoice, setViewInvoice] = useState<InvoiceRecord | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Cancel Modal State
  const [cancelInvoiceTarget, setCancelInvoiceTarget] = useState<InvoiceRecord | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [pendingRes, invoicesRes, statsRes] = await Promise.all([
        apiFetch<PendingDispatch[]>('/invoices/pending'),
        apiFetch<InvoiceRecord[]>('/invoices'),
        apiFetch<any>('/reports/dashboard-stats')
      ]);

      setPendingQueue(pendingRes || []);
      setInvoices(invoicesRes || []);
      setStats(statsRes || {});
    } catch (err: any) {
      console.error('Failed to load invoice data:', err);
      setError(err.message || 'Failed to load invoice records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keyboard shortcut: close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPrintModal) setShowPrintModal(false);
        if (showCreateModal) setShowCreateModal(false);
        if (cancelInvoiceTarget) setCancelInvoiceTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPrintModal, showCreateModal, cancelInvoiceTarget]);

  // Initiate Creation Modal with selected dispatch items
  const handleOpenCreateModal = (dispatchItems: PendingDispatch[]) => {
    if (dispatchItems.length === 0) return;

    // Verify all belong to same customer
    const firstCustId = dispatchItems[0].customer_id;
    const sameCustomer = dispatchItems.every(d => d.customer_id === firstCustId);
    if (!sameCustomer) {
      setError('All dispatches included in a single invoice must belong to the SAME customer.');
      return;
    }

    setCreateCustomerId(firstCustId);
    setCreateBillingAddress(dispatchItems[0].customer_address || '');
    setCreateShippingAddress(dispatchItems[0].customer_address || '');
    setCreateGstin(dispatchItems[0].customer_gstin || '');
    setCreatePlaceOfSupply('Tamil Nadu');
    setIsInterstate(false);
    setCreateDiscount(0);
    setCreateRoundOff(0);

    const initialLines = dispatchItems.map(d => ({
      dispatch_id: d.dispatch_id,
      dispatch_number: d.dispatch_number,
      job_card_number: d.job_card_number,
      part_name: d.part_name,
      part_number: d.part_number,
      dispatched_qty: d.dispatched_qty,
      already_invoiced_qty: d.already_invoiced_qty,
      remaining_invoiceable_qty: d.remaining_invoiceable_qty,
      quantity: d.remaining_invoiceable_qty,
      unit_price: d.suggested_unit_price || 0,
      gst_rate: 18,
      description: `Plating Services - ${d.part_name} (${d.part_number}) - Dispatch ${d.dispatch_number}`
    }));

    setCreateLines(initialLines);
    setShowCreateModal(true);
  };

  // Toggle selection in Queue
  const toggleSelectQueueItem = (id: string) => {
    if (selectedDispatchIds.includes(id)) {
      setSelectedDispatchIds(selectedDispatchIds.filter(i => i !== id));
    } else {
      // If adding, ensure same customer as existing selection
      if (selectedDispatchIds.length > 0) {
        const existingCust = pendingQueue.find(q => selectedDispatchIds.includes(q.dispatch_id))?.customer_id;
        const newItemCust = pendingQueue.find(q => q.dispatch_id === id)?.customer_id;
        if (existingCust && newItemCust && existingCust !== newItemCust) {
          setError('Cannot select dispatches from different customers in one invoice.');
          return;
        }
      }
      setSelectedDispatchIds([...selectedDispatchIds, id]);
    }
  };

  // Calculate live creation preview totals
  const computeCreateTotals = () => {
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    createLines.forEach(l => {
      const q = Math.max(0, l.quantity || 0);
      const p = Math.max(0, l.unit_price || 0);
      const rate = Math.max(0, l.gst_rate || 0);
      const taxable = Math.round(q * p * 100) / 100;
      const gstAmt = Math.round(taxable * (rate / 100) * 100) / 100;

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (isInterstate) {
        igst = gstAmt;
      } else {
        cgst = Math.round((gstAmt / 2) * 100) / 100;
        sgst = Math.round((gstAmt - cgst) * 100) / 100;
      }

      subtotal += taxable;
      totalCgst += cgst;
      totalSgst += sgst;
      totalIgst += igst;
    });

    subtotal = Math.round(subtotal * 100) / 100;
    totalCgst = Math.round(totalCgst * 100) / 100;
    totalSgst = Math.round(totalSgst * 100) / 100;
    totalIgst = Math.round(totalIgst * 100) / 100;
    const taxTotal = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;

    const grandTotal = Math.round((subtotal + taxTotal - createDiscount + createRoundOff) * 100) / 100;

    return {
      subtotal,
      totalCgst,
      totalSgst,
      totalIgst,
      taxTotal,
      grandTotal
    };
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // Validate lines
      for (let i = 0; i < createLines.length; i++) {
        const l = createLines[i];
        if (l.quantity <= 0) {
          throw new Error(`Line ${i + 1} (${l.dispatch_number}): Billing quantity must be greater than 0.`);
        }
        if (l.quantity > l.remaining_invoiceable_qty) {
          throw new Error(`Line ${i + 1} (${l.dispatch_number}): Billing quantity (${l.quantity}) exceeds remaining invoiceable quantity (${l.remaining_invoiceable_qty}).`);
        }
        if (l.unit_price < 0) {
          throw new Error(`Line ${i + 1}: Unit price cannot be negative.`);
        }
      }

      const idempotencyKey = `INV-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const payload = {
        customer_id: createCustomerId,
        invoice_date: createInvoiceDate,
        place_of_supply: createPlaceOfSupply,
        billing_address: createBillingAddress,
        shipping_address: createShippingAddress,
        gstin: createGstin,
        discount_amount: createDiscount,
        round_off: createRoundOff,
        is_interstate: isInterstate,
        lines: createLines.map(l => ({
          dispatch_id: l.dispatch_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          gst_rate: l.gst_rate,
          description: l.description
        })),
        idempotency_key: idempotencyKey
      };

      const res = await apiFetch<InvoiceRecord>('/invoices', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload)
      });

      setSuccessMsg(`Invoice ${res.invoice_number} created successfully! Total: ₹${res.total_amount.toLocaleString('en-IN')}`);
      setShowCreateModal(false);
      setSelectedDispatchIds([]);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFetchDetailAndPrint = async (invId: string) => {
    try {
      const invDetail = await apiFetch<InvoiceRecord>(`/invoices/${invId}`);
      setViewInvoice(invDetail);
      setShowPrintModal(true);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch invoice details for printing.');
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelInvoiceTarget) return;
    if (!cancellationReason.trim()) {
      setError('Cancellation reason is mandatory.');
      return;
    }

    setCancelling(true);
    setError('');

    try {
      await apiFetch(`/invoices/${cancelInvoiceTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancellationReason.trim() })
      });

      setSuccessMsg(`Invoice ${cancelInvoiceTarget.invoice_number} cancelled successfully. Dispatched balance restored.`);
      setCancelInvoiceTarget(null);
      setCancellationReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invoice.');
    } finally {
      setCancelling(false);
    }
  };

  // Filtered invoices
  const filteredInvoices = invoices.filter(inv => {
    if (statusFilter && inv.status !== statusFilter) return false;
    if (customerFilter && inv.customer_id !== customerFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchInv = inv.invoice_number.toLowerCase().includes(q);
      const matchCust = inv.customer_name.toLowerCase().includes(q) || inv.customer_code.toLowerCase().includes(q);
      const matchGst = (inv.gstin || '').toLowerCase().includes(q);
      if (!matchInv && !matchCust && !matchGst) return false;
    }
    return true;
  });

  const totals = computeCreateTotals();

  // Unique list of customers from pending queue
  const uniqueCustomersInQueue = Array.from(
    new Map(pendingQueue.map(item => [item.customer_id, { id: item.customer_id, name: item.customer_name, code: item.customer_code }])).values()
  );

  return (
    <div className="space-y-6">
      {/* Background content (hidden while printing an invoice document) */}
      <div className={`space-y-6 ${showPrintModal ? 'print:hidden' : ''}`}>
        
        {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="w-6 h-6 text-teal-600" />
            <h2 className="text-xl font-bold text-slate-900">Invoice & Billing Management</h2>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Generate tax invoices from completed dispatches. Strict reconciliation, multi-dispatch grouping & GST compliance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-red-50 text-red-800 border border-red-200 rounded-2xl text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div>{error}</div>
          </div>
          <button onClick={() => setError('')} className="text-red-700 hover:text-red-900 font-bold">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>{successMsg}</div>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-700 hover:text-emerald-900 font-bold">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Pending Invoices</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-700">{stats.invoice_pending_count || pendingQueue.length}</span>
            <span className="text-xs text-slate-400 font-medium">Batches</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Invoiceable Qty</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-900">{(stats.invoiceable_quantity || 0).toLocaleString()}</span>
            <span className="text-xs text-slate-500">pcs</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Invoices Issued</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-emerald-700">{stats.invoice_issued_count || 0}</span>
            <span className="text-xs text-emerald-600 font-medium">Issued</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Cancelled Invoices</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-red-700">{stats.invoice_cancelled_count || 0}</span>
            <span className="text-xs text-red-500 font-medium">Cancelled</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Total Invoiced</div>
          <div className="mt-1">
            <span className="text-xl font-black text-teal-800">
              ₹{(stats.total_invoiced_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Current Month</div>
          <div className="mt-1">
            <span className="text-xl font-black text-indigo-800">
              ₹{(stats.current_month_invoice_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </div>

      {/* Pending Invoice Queue */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              Eligible Dispatches Awaiting Invoice ({pendingQueue.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Only dispatches with status DISPATCHED, QC status PASS, and COMPLETED production runs are eligible.
            </p>
          </div>
          {selectedDispatchIds.length > 0 && (
            <button
              onClick={() => {
                const selectedItems = pendingQueue.filter(q => selectedDispatchIds.includes(q.dispatch_id));
                handleOpenCreateModal(selectedItems);
              }}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" /> Create Invoice for {selectedDispatchIds.length} Dispatches
            </button>
          )}
        </div>

        {pendingQueue.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm bg-slate-50">
            No pending dispatches awaiting invoice generation.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="p-3.5 w-10 text-center">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="p-3.5">Dispatch #</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Job Card #</th>
                  <th className="p-3.5">Part / Service</th>
                  <th className="p-3.5 text-right">Dispatched Qty</th>
                  <th className="p-3.5 text-right">Already Invoiced</th>
                  <th className="p-3.5 text-right">Invoiceable Qty</th>
                  <th className="p-3.5 text-right">Rate / Unit</th>
                  <th className="p-3.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingQueue.map(item => {
                  const isSelected = selectedDispatchIds.includes(item.dispatch_id);
                  return (
                    <tr key={item.dispatch_id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-teal-50/60' : ''}`}>
                      <td className="p-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectQueueItem(item.dispatch_id)}
                          className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-3.5 font-bold font-mono text-slate-900">
                        {item.dispatch_number}
                        <div className="text-[10px] text-slate-400 font-normal">{item.dispatch_date}</div>
                      </td>
                      <td className="p-3.5 font-semibold text-slate-800">
                        {item.customer_name}
                        <div className="text-[10px] font-mono text-slate-500">{item.customer_code}</div>
                      </td>
                      <td className="p-3.5 font-mono text-slate-700">
                        {item.job_card_number}
                        <div className="text-[10px] text-slate-400 font-normal">{item.plating_process}</div>
                      </td>
                      <td className="p-3.5 text-slate-800">
                        <div className="font-semibold">{item.part_name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{item.part_number}</div>
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-700 font-semibold">
                        <QuantityBadge value={item.dispatched_qty} unit={item.base_unit} />
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-500">
                        <QuantityBadge value={item.already_invoiced_qty} unit={item.base_unit} />
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-teal-700 text-sm">
                        <QuantityBadge value={item.remaining_invoiceable_qty} unit={item.base_unit} />
                      </td>
                      <td className="p-3.5 text-right font-mono font-semibold text-slate-900">
                        ₹{item.suggested_unit_price.toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => handleOpenCreateModal([item])}
                          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg text-[11px] shadow-sm transition-colors whitespace-nowrap"
                        >
                          Generate Invoice
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invoice Register */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-slate-700" />
            Tax Invoices Register ({filteredInvoices.length})
          </h3>

          {/* Search & Filter Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Invoice #, Customer..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-teal-500 focus:bg-white w-48 sm:w-60"
              />
            </div>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-teal-500"
            >
              <option value="">All Statuses</option>
              <option value="ISSUED">ISSUED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm bg-slate-50">
            No invoice records found matching criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="p-3.5">Invoice #</th>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5 text-center">Items</th>
                  <th className="p-3.5 text-right">Subtotal</th>
                  <th className="p-3.5 text-right">Tax Amount</th>
                  <th className="p-3.5 text-right">Grand Total</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-bold font-mono text-slate-900">
                      {inv.invoice_number}
                    </td>
                    <td className="p-3.5 text-slate-600 font-medium">
                      {inv.invoice_date}
                    </td>
                    <td className="p-3.5 text-slate-800 font-semibold">
                      {inv.customer_name}
                      <div className="text-[10px] font-mono text-slate-400">{inv.customer_code}</div>
                    </td>
                    <td className="p-3.5 text-center font-semibold text-slate-700">
                      {inv.line_count || 1} line(s)
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-700 font-medium">
                      ₹{inv.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-600">
                      ₹{inv.tax_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-slate-900 text-sm">
                      ₹{inv.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-center">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="p-3.5 text-center flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleFetchDetailAndPrint(inv.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5" /> View / Print
                      </button>

                      {inv.status === 'ISSUED' && (isAdmin || isSuperAdmin) && (
                        <button
                          onClick={() => setCancelInvoiceTarget(inv)}
                          className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg text-[11px] transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </div>

      {/* CREATE INVOICE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-center items-start p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full my-6 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-teal-600" />
                  Generate New Tax Invoice
                </h3>
                <p className="text-xs text-slate-500">
                  Customer: {pendingQueue.find(p => p.customer_id === createCustomerId)?.customer_name}
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              
              {/* Header Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Invoice Date</label>
                  <input
                    type="date"
                    value={createInvoiceDate}
                    onChange={e => setCreateInvoiceDate(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Place of Supply (State)</label>
                  <input
                    type="text"
                    value={createPlaceOfSupply}
                    onChange={e => {
                      setCreatePlaceOfSupply(e.target.value);
                      setIsInterstate(!e.target.value.toLowerCase().includes('tamil nadu'));
                    }}
                    required
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">Customer GSTIN</label>
                  <input
                    type="text"
                    value={createGstin}
                    onChange={e => setCreateGstin(e.target.value)}
                    placeholder="e.g. 33ABCDE1234F1Z5"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white font-mono uppercase"
                  />
                </div>
              </div>

              {/* Tax Type Toggle */}
              <div className="flex items-center justify-between bg-teal-50 p-3 rounded-xl border border-teal-200 text-xs">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-teal-700" />
                  <span className="font-bold text-teal-900">Tax Type Calculation:</span>
                  <span className="text-teal-800 font-medium">
                    {isInterstate ? 'Inter-State Transaction (IGST Applies)' : 'Intra-State Transaction (CGST + SGST Applies)'}
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer font-bold text-teal-900 select-none">
                  <input
                    type="checkbox"
                    checked={isInterstate}
                    onChange={e => setIsInterstate(e.target.checked)}
                    className="w-4 h-4 text-teal-600 rounded border-teal-300 focus:ring-teal-500 cursor-pointer"
                  />
                  <span>Force Inter-State (IGST)</span>
                </label>
              </div>

              {/* Line Items Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  Dispatch Line Items ({createLines.length})
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <th className="p-2.5">Dispatch / Job</th>
                        <th className="p-2.5">Part Name</th>
                        <th className="p-2.5 text-right w-24">Billing Qty</th>
                        <th className="p-2.5 text-right w-24">Unit Price (₹)</th>
                        <th className="p-2.5 text-center w-20">GST %</th>
                        <th className="p-2.5 text-right w-28">Taxable Val</th>
                        <th className="p-2.5 text-right w-28">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {createLines.map((line, idx) => {
                        const q = line.quantity || 0;
                        const p = line.unit_price || 0;
                        const rate = line.gst_rate || 0;
                        const taxable = Math.round(q * p * 100) / 100;
                        const gst = Math.round(taxable * (rate / 100) * 100) / 100;
                        const lineTot = Math.round((taxable + gst) * 100) / 100;

                        const isOverLimit = q > line.remaining_invoiceable_qty;

                        return (
                          <tr key={line.dispatch_id} className={isOverLimit ? 'bg-red-50' : ''}>
                            <td className="p-2.5 font-mono">
                              <div className="font-bold text-slate-900">{line.dispatch_number}</div>
                              <div className="text-[10px] text-slate-500">{line.job_card_number}</div>
                            </td>
                            <td className="p-2.5">
                              <div className="font-semibold text-slate-800">{line.part_name}</div>
                              <div className="text-[10px] font-mono text-slate-400">{line.part_number}</div>
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                step="any"
                                min="0.01"
                                max={line.remaining_invoiceable_qty}
                                value={line.quantity}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const updated = [...createLines];
                                  updated[idx].quantity = val;
                                  setCreateLines(updated);
                                }}
                                className={`w-20 px-2 py-1 border rounded text-right font-mono font-bold ${
                                  isOverLimit ? 'border-red-500 bg-red-100 text-red-900' : 'border-slate-300'
                                }`}
                              />
                              <div className="text-[9px] text-slate-400 mt-0.5">Max: {line.remaining_invoiceable_qty}</div>
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={line.unit_price}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const updated = [...createLines];
                                  updated[idx].unit_price = val;
                                  setCreateLines(updated);
                                }}
                                className="w-20 px-2 py-1 border border-slate-300 rounded text-right font-mono font-semibold"
                              />
                            </td>
                            <td className="p-2.5 text-center">
                              <select
                                value={line.gst_rate}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const updated = [...createLines];
                                  updated[idx].gst_rate = val;
                                  setCreateLines(updated);
                                }}
                                className="px-1.5 py-1 border border-slate-300 rounded font-semibold text-xs"
                              >
                                <option value="0">0%</option>
                                <option value="5">5%</option>
                                <option value="12">12%</option>
                                <option value="18">18%</option>
                                <option value="28">28%</option>
                              </select>
                            </td>
                            <td className="p-2.5 text-right font-mono font-semibold text-slate-800">
                              ₹{taxable.toFixed(2)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-teal-800">
                              ₹{lineTot.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Discounts & Round Off Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Discount Amount (₹)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={createDiscount}
                    onChange={e => setCreateDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Round Off Adjustment (₹)</label>
                  <input
                    type="number"
                    step="any"
                    value={createRoundOff}
                    onChange={e => setCreateRoundOff(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              {/* Summary Card */}
              <div className="bg-slate-900 text-white p-4 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Subtotal (Taxable Value):</span>
                  <span className="font-mono font-bold">₹{totals.subtotal.toFixed(2)}</span>
                </div>
                {!isInterstate ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-400">CGST Amount:</span>
                      <span className="font-mono text-teal-300">₹{totals.totalCgst.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">SGST Amount:</span>
                      <span className="font-mono text-teal-300">₹{totals.totalSgst.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-slate-400">IGST Amount:</span>
                    <span className="font-mono text-purple-300">₹{totals.totalIgst.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-800 pt-2 font-bold text-sm">
                  <span>Grand Total Amount:</span>
                  <span className="text-teal-400 font-mono text-base">₹{totals.grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
                >
                  {submitting ? 'Generating...' : 'Confirm & Issue Invoice'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* PRINT / VIEW INVOICE DOCUMENT MODAL */}
      {showPrintModal && viewInvoice && (
        <div 
          className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex justify-center items-start overflow-y-auto p-4 sm:p-6 md:p-8 print:p-0 print:bg-white print:static print:block print:overflow-visible"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrintModal(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full p-6 sm:p-8 my-4 sm:my-8 space-y-6 print:m-0 print:p-0 print:max-w-none print:w-full print:shadow-none print:border-none">
            
            {/* Modal Top Actions (Sticky, hidden when printing) */}
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-200 pb-3 pt-1 -mt-2 -mx-2 px-2 z-20 flex items-center justify-between print:hidden">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-teal-50 text-teal-700 rounded-xl">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base leading-tight">Tax Invoice Preview &amp; Print</h3>
                  <p className="text-[11px] text-slate-500 font-medium font-mono">{viewInvoice.invoice_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all hover:shadow active:scale-95"
                >
                  <Printer className="w-4 h-4" /> Print Document
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-xl transition-colors"
                  title="Close preview (Esc)"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Printable Tax Invoice Sheet */}
            <div className="space-y-6 text-slate-900 font-sans text-xs">
              
              {/* Invoice Watermark if Cancelled */}
              {viewInvoice.status === 'CANCELLED' && (
                <div className="p-3 bg-red-100 border border-red-300 text-red-800 text-center font-black text-sm rounded-xl uppercase tracking-widest">
                  *** CANCELLED INVOICE — RESTORED TO DISPATCH ***
                  {viewInvoice.cancellation_reason && (
                    <div className="text-xs font-normal normal-case mt-0.5">Reason: {viewInvoice.cancellation_reason}</div>
                  )}
                </div>
              )}

              {/* Company Header */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">VETRIVEL PLATERS</h1>
                  <p className="text-slate-700 font-bold text-xs">Electroplating &amp; Surface Treatment Specialists</p>
                  <p className="text-slate-500 text-[11px] mt-1">Plot No. 42, Industrial Estate, SIDCO, Hosur, Tamil Nadu - 635126</p>
                  <p className="text-slate-500 text-[11px]">GSTIN: 33AAAAA0000A1Z5 | Phone: +91 98765 43210</p>
                </div>
                <div className="text-right">
                  <span className="inline-block px-3 py-1 bg-slate-900 text-white font-black text-xs sm:text-sm uppercase rounded tracking-wider">
                    TAX INVOICE
                  </span>
                  <div className="mt-2 font-mono font-black text-sm sm:text-base text-slate-900">{viewInvoice.invoice_number}</div>
                  <div className="text-slate-500 font-medium text-xs">Date: {viewInvoice.invoice_date}</div>
                </div>
              </div>

              {/* Billing Info Grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <h4 className="font-bold text-slate-700 uppercase text-[10px] tracking-wider mb-1">Billed To (Customer):</h4>
                  <div className="font-bold text-slate-900 text-sm">{viewInvoice.customer_name}</div>
                  <div className="text-slate-600">{viewInvoice.billing_address || viewInvoice.customer_master_address}</div>
                  {viewInvoice.gstin && (
                    <div className="font-mono font-semibold text-slate-800 mt-1">GSTIN: {viewInvoice.gstin}</div>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-slate-700 uppercase text-[10px] tracking-wider mb-1">Invoice Particulars:</h4>
                  <div className="space-y-1">
                    <div><span className="text-slate-500">Place of Supply:</span> <span className="font-semibold">{viewInvoice.place_of_supply || 'Tamil Nadu'}</span></div>
                    <div><span className="text-slate-500">Status:</span> <span className="font-bold uppercase">{viewInvoice.status}</span></div>
                    <div><span className="text-slate-500">Created By:</span> {viewInvoice.created_by_name}</div>
                  </div>
                </div>
              </div>

              {/* Invoice Lines Table */}
              <table className="w-full text-left border-collapse border border-slate-300 text-xs">
                <thead>
                  <tr className="bg-slate-200 text-slate-800 font-bold border-b border-slate-300">
                    <th className="p-2 border-r border-slate-300 w-8 text-center">#</th>
                    <th className="p-2 border-r border-slate-300">Description</th>
                    <th className="p-2 border-r border-slate-300 text-right w-16">Qty</th>
                    <th className="p-2 border-r border-slate-300 text-right w-20">Rate (₹)</th>
                    <th className="p-2 border-r border-slate-300 text-right w-20">Taxable</th>
                    <th className="p-2 border-r border-slate-300 text-center w-14">GST %</th>
                    <th className="p-2 text-right w-24">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(viewInvoice.lines || []).map((line, index) => (
                    <tr key={line.id || index}>
                      <td className="p-2 border-r border-slate-200 text-center font-mono">{index + 1}</td>
                      <td className="p-2 border-r border-slate-200">
                        <div className="font-semibold">{line.description}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {line.part_name} ({line.part_number}) — Dispatch: {line.dispatch_number}
                        </div>
                      </td>
                      <td className="p-2 border-r border-slate-200 text-right font-mono font-semibold">{line.quantity}</td>
                      <td className="p-2 border-r border-slate-200 text-right font-mono">₹{line.unit_price.toFixed(2)}</td>
                      <td className="p-2 border-r border-slate-200 text-right font-mono">₹{line.taxable_value.toFixed(2)}</td>
                      <td className="p-2 border-r border-slate-200 text-center font-mono">{line.gst_rate}%</td>
                      <td className="p-2 text-right font-mono font-bold">₹{line.line_total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Summary Table */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1.5 text-xs font-medium border border-slate-300 p-3 rounded-xl bg-slate-50">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-mono font-bold">₹{viewInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  {viewInvoice.cgst_amount > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>CGST:</span>
                      <span className="font-mono">₹{viewInvoice.cgst_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {viewInvoice.sgst_amount > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>SGST:</span>
                      <span className="font-mono">₹{viewInvoice.sgst_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {viewInvoice.igst_amount > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>IGST:</span>
                      <span className="font-mono">₹{viewInvoice.igst_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {viewInvoice.discount_amount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount:</span>
                      <span className="font-mono">-₹{viewInvoice.discount_amount.toFixed(2)}</span>
                    </div>
                  )}
                  {viewInvoice.round_off !== 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Round Off:</span>
                      <span className="font-mono">₹{viewInvoice.round_off.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t-2 border-slate-900 pt-1.5 font-black text-sm text-slate-900">
                    <span>Grand Total:</span>
                    <span className="font-mono text-teal-800">₹{viewInvoice.total_amount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="pt-8 border-t border-slate-200 flex justify-between items-end text-[11px] text-slate-500">
                <div>
                  <p>Declaration: Certified that the particulars given above are true and correct.</p>
                  <p className="mt-1">This is a computer-generated tax invoice.</p>
                </div>
                <div className="text-right">
                  <div className="font-bold text-slate-900">For VETRIVEL PLATERS</div>
                  <div className="h-10"></div>
                  <div className="border-t border-slate-400 pt-1 font-semibold">Authorized Signatory</div>
                </div>
              </div>

            </div>

            {/* Modal Bottom Actions (Hidden when printing) */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 print:hidden">
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-colors"
              >
                Close Preview
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow transition-colors"
              >
                <Printer className="w-4 h-4" /> Print Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL INVOICE MODAL */}
      {cancelInvoiceTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-slate-900 text-base">Cancel Invoice {cancelInvoiceTarget.invoice_number}</h3>
            </div>
            
            <p className="text-xs text-slate-600">
              Cancelling this invoice will mark it as CANCELLED and restore the invoiceable quantity for linked dispatches. A mandatory audit trail reason is required.
            </p>

            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Cancellation Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={cancellationReason}
                  onChange={e => setCancellationReason(e.target.value)}
                  placeholder="Explain why this invoice is being cancelled..."
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-red-500"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelInvoiceTarget(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={cancelling}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
                >
                  {cancelling ? 'Cancelling...' : 'Confirm Invoice Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Invoices;
