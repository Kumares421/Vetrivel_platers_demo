import React, { useState, useEffect } from 'react';
import { 
  CreditCard, AlertTriangle, Plus, Search, Filter, XCircle, 
  CheckCircle2, DollarSign, Building2, User, Calendar, ShieldAlert, Check, RefreshCw, FileText
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

interface PendingInvoice {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_total: number;
  subtotal: number;
  tax_amount: number;
  invoice_status: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  customer_gstin?: string;
  paid_amount: number;
  outstanding_amount: number;
  settlement_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
}

interface PaymentAllocation {
  allocation_id?: string;
  invoice_id: string;
  invoice_number?: string;
  invoice_date?: string;
  invoice_total?: number;
  invoice_total_paid?: number;
  invoice_current_outstanding?: number;
  allocated_amount: number;
}

interface PaymentRecord {
  id: string;
  payment_number: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  customer_address?: string;
  payment_date: string;
  amount: number;
  payment_mode: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'OTHER';
  reference_number?: string;
  bank_name?: string;
  transaction_date?: string;
  remarks?: string;
  status: 'RECEIVED' | 'CANCELLED';
  cancellation_reason?: string;
  cancelled_at?: string;
  received_by_name?: string;
  cancelled_by_name?: string;
  total_allocated_amount: number;
  unallocated_amount: number;
  allocation_count?: number;
  allocations?: PaymentAllocation[];
}

const PAYMENT_MODES: Array<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'OTHER'> = [
  'CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'
];

export const Payments: React.FC = () => {
  const { user, isAdmin, isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Dashboard Stats & Registers
  const [stats, setStats] = useState<any>({});
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  // Filters for Payment Register
  const [statusFilter, setStatusFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');

  // Record Payment Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [payCustomerId, setPayCustomerId] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMode, setPayMode] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'OTHER'>('BANK_TRANSFER');
  const [payRefNo, setPayRefNo] = useState('');
  const [payBankName, setPayBankName] = useState('');
  const [payTxnDate, setPayTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [payRemarks, setPayRemarks] = useState('');
  const [payAllocations, setPayAllocations] = useState<{
    invoice_id: string;
    invoice_number: string;
    invoice_date: string;
    invoice_total: number;
    paid_amount: number;
    outstanding_amount: number;
    allocated_amount: number;
  }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Detail Modal State
  const [viewPayment, setViewPayment] = useState<PaymentRecord | null>(null);

  // Cancel Modal State
  const [cancelPaymentTarget, setCancelPaymentTarget] = useState<PaymentRecord | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [pendingRes, paymentsRes, statsRes] = await Promise.all([
        apiFetch<PendingInvoice[]>('/payments/pending'),
        apiFetch<PaymentRecord[]>('/payments'),
        apiFetch<any>('/reports/dashboard-stats')
      ]);

      setPendingInvoices(pendingRes || []);
      setPayments(paymentsRes || []);
      setStats(statsRes || {});
    } catch (err: any) {
      console.error('Failed to load payment data:', err);
      setError(err.message || 'Failed to load payment records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Initialize Create Payment Modal
  const handleOpenCreateModal = (preselectedInvoice?: PendingInvoice) => {
    const custId = preselectedInvoice ? preselectedInvoice.customer_id : '';
    setPayCustomerId(custId);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayAmount(preselectedInvoice ? preselectedInvoice.outstanding_amount : 0);
    setPayMode('BANK_TRANSFER');
    setPayRefNo('');
    setPayBankName('');
    setPayTxnDate(new Date().toISOString().slice(0, 10));
    setPayRemarks('');

    if (custId) {
      updateAllocationsForCustomer(custId, preselectedInvoice);
    } else {
      setPayAllocations([]);
    }

    setShowCreateModal(true);
  };

  // Helper to populate invoice allocation lines when customer changes
  const updateAllocationsForCustomer = (custId: string, autoFillInvoice?: PendingInvoice) => {
    const custInvoices = pendingInvoices.filter(inv => inv.customer_id === custId);
    const allocLines = custInvoices.map(inv => ({
      invoice_id: inv.invoice_id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      invoice_total: inv.invoice_total,
      paid_amount: inv.paid_amount,
      outstanding_amount: inv.outstanding_amount,
      allocated_amount: autoFillInvoice && autoFillInvoice.invoice_id === inv.invoice_id ? inv.outstanding_amount : 0
    }));
    setPayAllocations(allocLines);
  };

  // Live allocation totals calculation
  const totalAllocated = payAllocations.reduce((sum, a) => sum + (parseFloat(a.allocated_amount as any) || 0), 0);
  const unallocatedAmount = Math.max(0, Math.round((payAmount - totalAllocated) * 100) / 100);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!payCustomerId) {
      setError('Please select a customer.');
      return;
    }
    if (payAmount <= 0) {
      setError('Payment amount must be greater than 0.');
      return;
    }
    if (totalAllocated > payAmount) {
      setError(`Total allocated amount (₹${totalAllocated.toLocaleString('en-IN')}) exceeds payment amount (₹${payAmount.toLocaleString('en-IN')}).`);
      return;
    }

    setSubmitting(true);

    try {
      const activeAllocations = payAllocations
        .filter(a => (parseFloat(a.allocated_amount as any) || 0) > 0)
        .map(a => ({
          invoice_id: a.invoice_id,
          allocated_amount: parseFloat(a.allocated_amount as any)
        }));

      const idempotencyKey = `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const payload = {
        customer_id: payCustomerId,
        payment_date: payDate,
        amount: payAmount,
        payment_mode: payMode,
        reference_number: payRefNo || null,
        bank_name: payBankName || null,
        transaction_date: payTxnDate || payDate,
        remarks: payRemarks || null,
        allocations: activeAllocations,
        idempotency_key: idempotencyKey
      };

      const res = await apiFetch<PaymentRecord>('/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload)
      });

      setSuccessMsg(`Payment ${res.payment_number} of ₹${res.amount.toLocaleString('en-IN')} recorded successfully!`);
      setShowCreateModal(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFetchPaymentDetail = async (payId: string) => {
    try {
      const payDetail = await apiFetch<PaymentRecord>(`/payments/${payId}`);
      setViewPayment(payDetail);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch payment details.');
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelPaymentTarget) return;
    if (!cancellationReason.trim()) {
      setError('Cancellation reason is mandatory.');
      return;
    }

    setCancelling(true);
    setError('');

    try {
      await apiFetch(`/payments/${cancelPaymentTarget.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancellationReason.trim() })
      });

      setSuccessMsg(`Payment ${cancelPaymentTarget.payment_number} cancelled. Invoice outstanding balances restored.`);
      setCancelPaymentTarget(null);
      setCancellationReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel payment.');
    } finally {
      setCancelling(false);
    }
  };

  // Filtered Payments
  const filteredPayments = payments.filter(p => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (modeFilter && p.payment_mode !== modeFilter) return false;
    if (customerFilter && p.customer_id !== customerFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchNum = p.payment_number.toLowerCase().includes(q);
      const matchCust = p.customer_name.toLowerCase().includes(q) || p.customer_code.toLowerCase().includes(q);
      const matchRef = (p.reference_number || '').toLowerCase().includes(q);
      if (!matchNum && !matchCust && !matchRef) return false;
    }
    return true;
  });

  // Unique list of customers from pending invoices for selector
  const uniqueCustomersInQueue = Array.from(
    new Map(pendingInvoices.map(item => [item.customer_id, { id: item.customer_id, name: item.customer_name, code: item.customer_code }])).values()
  );

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-600" />
            <h2 className="text-xl font-bold text-slate-900">Payment & Collections Management</h2>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Record customer collections, allocate payments against invoices, and track live outstanding balances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenCreateModal()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> Record New Payment
          </button>
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

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Total Outstanding</div>
          <div className="mt-1">
            <span className="text-xl font-black text-red-700">
              ₹{(stats.total_outstanding_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Payments Today</div>
          <div className="mt-1">
            <span className="text-xl font-black text-emerald-700">
              ₹{(stats.payments_received_today || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Payments This Month</div>
          <div className="mt-1">
            <span className="text-xl font-black text-teal-800">
              ₹{(stats.payments_received_current_month || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Total Collected</div>
          <div className="mt-1">
            <span className="text-xl font-black text-slate-900">
              ₹{(stats.total_payments_received || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Unpaid Invoices</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-amber-700">{stats.payment_pending_invoice_count || pendingInvoices.length}</span>
            <span className="text-xs text-slate-400 font-medium">Invoices</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-[11px] font-semibold uppercase">Cancelled Payments</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-red-700">{stats.cancelled_payment_count || 0}</span>
            <span className="text-xs text-red-500 font-medium">Reversed</span>
          </div>
        </div>
      </div>

      {/* Outstanding Invoices Queue */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              Invoices with Outstanding Balance ({pendingInvoices.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select an invoice to allocate customer payment against. Live settlement statuses are derived automatically.
            </p>
          </div>
        </div>

        {pendingInvoices.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm bg-slate-50">
            No active invoices with pending outstanding amounts.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="p-3.5">Invoice #</th>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5 text-right">Invoice Total</th>
                  <th className="p-3.5 text-right">Paid Amount</th>
                  <th className="p-3.5 text-right">Outstanding Amount</th>
                  <th className="p-3.5 text-center">Settlement Status</th>
                  <th className="p-3.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingInvoices.map(inv => (
                  <tr key={inv.invoice_id} className="hover:bg-slate-50 transition-colors">
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
                    <td className="p-3.5 text-right font-mono font-semibold text-slate-800">
                      ₹{inv.invoice_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-right font-mono text-emerald-700 font-semibold">
                      ₹{inv.paid_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-red-700 text-sm">
                      ₹{inv.outstanding_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                        inv.settlement_status === 'UNPAID' ? 'bg-red-100 text-red-800 border border-red-200' :
                        inv.settlement_status === 'PARTIALLY_PAID' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                        'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {inv.settlement_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => handleOpenCreateModal(inv)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[11px] shadow-sm transition-colors whitespace-nowrap"
                      >
                        Receive Payment
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Register */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-slate-700" />
            Payment Collections Register ({filteredPayments.length})
          </h3>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Payment #, Ref #, Customer..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white w-48 sm:w-60"
              />
            </div>

            <select
              value={modeFilter}
              onChange={e => setModeFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Modes</option>
              {PAYMENT_MODES.map(m => (
                <option key={m} value={m}>{m.replace('_', ' ')}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Statuses</option>
              <option value="RECEIVED">RECEIVED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
        </div>

        {filteredPayments.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm bg-slate-50">
            No payment records found matching criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <th className="p-3.5">Payment #</th>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Mode</th>
                  <th className="p-3.5">Reference / Bank</th>
                  <th className="p-3.5 text-right">Amount (₹)</th>
                  <th className="p-3.5 text-right">Allocated (₹)</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPayments.map(pay => (
                  <tr key={pay.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-bold font-mono text-slate-900">
                      {pay.payment_number}
                    </td>
                    <td className="p-3.5 text-slate-600 font-medium">
                      {pay.payment_date}
                    </td>
                    <td className="p-3.5 text-slate-800 font-semibold">
                      {pay.customer_name}
                      <div className="text-[10px] font-mono text-slate-400">{pay.customer_code}</div>
                    </td>
                    <td className="p-3.5 font-semibold text-slate-700">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded text-[10px] font-bold">
                        {pay.payment_mode.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3.5 text-slate-700">
                      <div className="font-mono text-slate-900 font-semibold">{pay.reference_number || 'N/A'}</div>
                      <div className="text-[10px] text-slate-400">{pay.bank_name || ''}</div>
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-slate-900 text-sm">
                      ₹{pay.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-right font-mono font-semibold text-teal-700">
                      ₹{pay.total_allocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-center">
                      <StatusBadge status={pay.status} />
                    </td>
                    <td className="p-3.5 text-center flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleFetchPaymentDetail(pay.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" /> View Details
                      </button>

                      {pay.status === 'RECEIVED' && (isAdmin || isSuperAdmin) && (
                        <button
                          onClick={() => setCancelPaymentTarget(pay)}
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

      {/* RECORD PAYMENT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-emerald-600" />
                  Record Customer Collection
                </h3>
                <p className="text-xs text-slate-500">
                  Enter payment details and allocate amount against open invoices.
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
              
              {/* Payment Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Select Customer <span className="text-red-500">*</span></label>
                  <select
                    value={payCustomerId}
                    onChange={e => {
                      const id = e.target.value;
                      setPayCustomerId(id);
                      updateAllocationsForCustomer(id);
                    }}
                    required
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white font-semibold"
                  >
                    <option value="">-- Choose Customer --</option>
                    {uniqueCustomersInQueue.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Payment Date <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Total Payment Amount (₹) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={payAmount}
                    onChange={e => setPayAmount(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono font-bold text-sm bg-white text-emerald-800"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Payment Mode <span className="text-red-500">*</span></label>
                  <select
                    value={payMode}
                    onChange={e => setPayMode(e.target.value as any)}
                    required
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white font-semibold"
                  >
                    {PAYMENT_MODES.map(m => (
                      <option key={m} value={m}>{m.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Reference / Cheque / UTR #</label>
                  <input
                    type="text"
                    value={payRefNo}
                    onChange={e => setPayRefNo(e.target.value)}
                    placeholder="e.g. UTR987654321"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={payBankName}
                    onChange={e => setPayBankName(e.target.value)}
                    placeholder="e.g. HDFC Bank"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>

              </div>

              {/* Allocation Summary Card */}
              <div className="flex items-center justify-between bg-slate-900 text-white p-3.5 rounded-xl text-xs font-semibold">
                <div>
                  <span>Payment Amount: <strong className="font-mono text-emerald-400">₹{payAmount.toLocaleString('en-IN')}</strong></span>
                </div>
                <div>
                  <span>Allocated: <strong className="font-mono text-teal-300">₹{totalAllocated.toLocaleString('en-IN')}</strong></span>
                </div>
                <div>
                  <span>Unallocated: <strong className={`font-mono ${unallocatedAmount > 0 ? 'text-amber-300' : 'text-slate-400'}`}>₹{unallocatedAmount.toLocaleString('en-IN')}</strong></span>
                </div>
              </div>

              {/* Invoice Allocation Table */}
              {payCustomerId && (
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    Allocate to Outstanding Invoices ({payAllocations.length})
                  </h4>

                  {payAllocations.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 text-xs bg-slate-50 rounded-xl">
                      No open outstanding invoices for this customer.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                            <th className="p-2.5">Invoice #</th>
                            <th className="p-2.5">Invoice Date</th>
                            <th className="p-2.5 text-right">Invoice Total</th>
                            <th className="p-2.5 text-right">Paid So Far</th>
                            <th className="p-2.5 text-right">Outstanding</th>
                            <th className="p-2.5 text-right w-36">Allocate Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {payAllocations.map((alloc, idx) => {
                            const isOver = alloc.allocated_amount > alloc.outstanding_amount;
                            return (
                              <tr key={alloc.invoice_id} className={isOver ? 'bg-red-50' : ''}>
                                <td className="p-2.5 font-mono font-bold text-slate-900">
                                  {alloc.invoice_number}
                                </td>
                                <td className="p-2.5 text-slate-600">
                                  {alloc.invoice_date}
                                </td>
                                <td className="p-2.5 text-right font-mono text-slate-800">
                                  ₹{alloc.invoice_total.toFixed(2)}
                                </td>
                                <td className="p-2.5 text-right font-mono text-emerald-700">
                                  ₹{alloc.paid_amount.toFixed(2)}
                                </td>
                                <td className="p-2.5 text-right font-mono font-bold text-red-700">
                                  ₹{alloc.outstanding_amount.toFixed(2)}
                                </td>
                                <td className="p-2.5 text-right">
                                  <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    max={alloc.outstanding_amount}
                                    value={alloc.allocated_amount}
                                    onChange={e => {
                                      const val = parseFloat(e.target.value) || 0;
                                      const updated = [...payAllocations];
                                      updated[idx].allocated_amount = val;
                                      setPayAllocations(updated);
                                    }}
                                    className={`w-32 px-2 py-1 border rounded text-right font-mono font-bold ${
                                      isOver ? 'border-red-500 bg-red-100 text-red-900' : 'border-slate-300'
                                    }`}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
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
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
                >
                  {submitting ? 'Recording...' : 'Record & Save Payment'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* VIEW PAYMENT DETAIL MODAL */}
      {viewPayment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                  Payment Collection {viewPayment.payment_number}
                </h3>
                <span className="text-xs text-slate-500">Received on {viewPayment.payment_date}</span>
              </div>
              <button
                onClick={() => setViewPayment(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {viewPayment.status === 'CANCELLED' && (
              <div className="p-3 bg-red-100 border border-red-300 text-red-800 text-center font-bold text-xs rounded-xl uppercase">
                *** PAYMENT CANCELLED / REVERSED ***
                {viewPayment.cancellation_reason && (
                  <div className="text-xs font-normal normal-case mt-0.5">Reason: {viewPayment.cancellation_reason}</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div>
                <div className="text-slate-500 font-medium">Customer:</div>
                <div className="font-bold text-slate-900 text-sm">{viewPayment.customer_name} ({viewPayment.customer_code})</div>
                <div className="text-slate-600">{viewPayment.customer_address}</div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Payment Mode & Ref:</div>
                <div className="font-bold text-slate-900">{viewPayment.payment_mode.replace('_', ' ')}</div>
                <div className="font-mono text-slate-700">Ref: {viewPayment.reference_number || 'N/A'}</div>
                <div className="text-slate-500">{viewPayment.bank_name || ''}</div>
              </div>
            </div>

            {/* Allocations Table */}
            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-slate-900 uppercase tracking-wider">Invoice Allocation Breakdown</h4>
              <table className="w-full text-left border-collapse border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-2">Invoice #</th>
                    <th className="p-2">Invoice Date</th>
                    <th className="p-2 text-right">Invoice Total</th>
                    <th className="p-2 text-right">Allocated Amount</th>
                    <th className="p-2 text-right">Current Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(viewPayment.allocations || []).map(alloc => (
                    <tr key={alloc.allocation_id || alloc.invoice_id}>
                      <td className="p-2 font-mono font-bold text-slate-900">{alloc.invoice_number}</td>
                      <td className="p-2 text-slate-600">{alloc.invoice_date}</td>
                      <td className="p-2 text-right font-mono">₹{alloc.invoice_total?.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">₹{alloc.allocated_amount.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono text-red-700 font-semibold">₹{alloc.invoice_current_outstanding?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total Summary */}
            <div className="bg-slate-900 text-white p-4 rounded-xl flex justify-between items-center text-xs">
              <div>
                <div>Total Payment Amount: <strong className="font-mono text-emerald-400 text-sm">₹{viewPayment.amount.toFixed(2)}</strong></div>
              </div>
              <div>
                <div>Total Allocated: <strong className="font-mono text-teal-300">₹{viewPayment.total_allocated_amount.toFixed(2)}</strong></div>
                <div>Unallocated: <strong className="font-mono text-amber-300">₹{viewPayment.unallocated_amount.toFixed(2)}</strong></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL PAYMENT MODAL */}
      {cancelPaymentTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-slate-900 text-base">Cancel Payment {cancelPaymentTarget.payment_number}</h3>
            </div>
            
            <p className="text-xs text-slate-600">
              Cancelling this payment will mark it as CANCELLED and restore the outstanding balance for all linked invoices. A mandatory audit trail reason is required.
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
                  placeholder="Explain why this payment collection is being cancelled..."
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-red-500"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelPaymentTarget(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={cancelling}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
                >
                  {cancelling ? 'Cancelling...' : 'Confirm Payment Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Payments;
