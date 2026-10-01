import React, { useState, useEffect } from 'react';
import { 
  ArrowDownToLine, Plus, AlertTriangle, CheckCircle2, XCircle, 
  Search, RefreshCw, FileText, PackageCheck 
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export const PartsInward: React.FC = () => {
  const { isAdmin, isStaff } = useAuth();
  const [inwardList, setInwardList] = useState<any[]>([]);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [createModal, setCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedOrderItemId, setSelectedOrderItemId] = useState('');
  const [challanNumber, setChallanNumber] = useState('');
  const [challanDate, setChallanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [acceptedQty, setAcceptedQty] = useState<number>(0);
  const [rejectedQty, setRejectedQty] = useState<number>(0);
  const [rejectionReason, setRejectionReason] = useState('');
  const [notes, setNotes] = useState('');

  // Cancel Modal
  const [cancelModal, setCancelModal] = useState(false);
  const [inwardToCancel, setInwardToCancel] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const fetchInwardData = async () => {
    setLoading(true);
    setError('');
    try {
      const [inwards, pendings] = await Promise.all([
        apiFetch<any[]>('/customer-parts-inward'),
        apiFetch<any[]>('/customer-parts-inward/pending-items')
      ]);
      setInwardList(inwards);
      setPendingItems(pendings);
    } catch (err: any) {
      setError(err.message || 'Failed to load parts inward records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInwardData();
  }, []);

  const selectedPending = pendingItems.find(p => p.customer_order_item_id === selectedOrderItemId);

  // Auto-fill accepted qty with pending qty when selected
  const handleItemSelect = (orderItemId: string) => {
    setSelectedOrderItemId(orderItemId);
    const item = pendingItems.find(p => p.customer_order_item_id === orderItemId);
    if (item) {
      setAcceptedQty(item.pending_qty);
      setRejectedQty(0);
    }
  };

  const handleRecordInward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderItemId) {
      alert('Please select a customer order item');
      return;
    }
    if (!challanNumber.trim()) {
      alert('Delivery Challan Number is required');
      return;
    }
    if (acceptedQty <= 0 && rejectedQty <= 0) {
      alert('Either accepted quantity or rejected quantity must be greater than zero');
      return;
    }
    if (selectedPending && (acceptedQty + rejectedQty) > selectedPending.pending_qty) {
      alert(`Total inward (${acceptedQty + rejectedQty}) cannot exceed pending quantity (${selectedPending.pending_qty})`);
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `inw-submit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await apiFetch('/customer-parts-inward', {
        method: 'POST',
        headers: { 'x-idempotency-key': idempotencyKey },
        body: JSON.stringify({
          customer_order_item_id: selectedOrderItemId,
          challan_number: challanNumber.trim(),
          challan_date: challanDate,
          received_date: receivedDate,
          accepted_qty: acceptedQty,
          rejected_qty: rejectedQty,
          rejection_reason: rejectionReason,
          notes: notes
        })
      });

      setCreateModal(false);
      setSelectedOrderItemId('');
      setChallanNumber('');
      setAcceptedQty(0);
      setRejectedQty(0);
      setRejectionReason('');
      setNotes('');
      fetchInwardData();
    } catch (err: any) {
      alert('Failed to record inward: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInward = async () => {
    if (!inwardToCancel || !cancelReason.trim()) {
      alert('Cancellation reason is required');
      return;
    }
    try {
      await apiFetch(`/customer-parts-inward/${inwardToCancel.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancelReason })
      });
      setCancelModal(false);
      setInwardToCancel(null);
      setCancelReason('');
      fetchInwardData();
    } catch (err: any) {
      alert('Failed to cancel inward: ' + err.message);
    }
  };

  const filteredInwards = inwardList.filter(i => {
    return (
      i.inward_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.challan_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.part_number?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-7 h-7 text-teal-700" />
            Customer Parts Inward Register
          </h2>
          <p className="text-slate-500 text-sm">
            Receive customer physical parts against confirmed orders with DC verification and QA inspection.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchInwardData}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            title="Refresh Inward Records"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isStaff && (
            <button
              onClick={() => setCreateModal(true)}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow"
            >
              <Plus className="w-4 h-4" /> Inward Customer Parts
            </button>
          )}
        </div>
      </div>

      {/* Pending Items Summary Bar */}
      {pendingItems.length > 0 && (
        <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-bold text-teal-900 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              {pendingItems.length} Confirmed Order Items Awaiting Customer Parts Inward
            </div>
            <p className="text-xs text-teal-700 mt-0.5">
              Select any pending item to quickly record partial or complete inward receipts with DC challan.
            </p>
          </div>
          <button
            onClick={() => setCreateModal(true)}
            className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl text-xs shrink-0"
          >
            Inward Now
          </button>
        </div>
      )}

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search Inward No, Order, Challan, Customer, Part..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-2xl text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div>{error}</div>
          </div>
          <button
            onClick={fetchInwardData}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Inward Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
              <tr>
                <th className="p-4">Inward Number</th>
                <th className="p-4">Order Ref</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Challan / DC</th>
                <th className="p-4">Part Details</th>
                <th className="p-4 text-right">Accepted Qty</th>
                <th className="p-4 text-right">Rejected Qty</th>
                <th className="p-4 text-right text-teal-700">Available For Jobs</th>
                <th className="p-4">Received Date</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">Loading parts inward records...</td>
                </tr>
              ) : filteredInwards.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">No parts inward records found.</td>
                </tr>
              ) : (
                filteredInwards.map(inw => (
                  <tr key={inw.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-teal-800">{inw.inward_number}</td>
                    <td className="p-4 font-mono text-xs text-slate-900 font-semibold">{inw.order_number}</td>
                    <td className="p-4 font-semibold text-slate-900">{inw.customer_name}</td>
                    <td className="p-4 font-mono text-xs">
                      <div>{inw.challan_number}</div>
                      <div className="text-[10px] text-slate-400">{inw.challan_date}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-xs">{inw.part_number}</div>
                      <div className="text-slate-500 text-[11px]">{inw.part_name}</div>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-teal-700">
                      {inw.accepted_qty.toLocaleString()}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-red-700">
                      {inw.rejected_qty > 0 ? inw.rejected_qty.toLocaleString() : '0'}
                    </td>
                    <td className="p-4 text-right font-mono font-black text-slate-900">
                      {inw.available_for_job_allocation.toLocaleString()}
                    </td>
                    <td className="p-4 text-xs">{inw.received_date}</td>
                    <td className="p-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        inw.status === 'RECEIVED' ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {inw.status}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {isAdmin && inw.status === 'RECEIVED' && (
                        <button
                          onClick={() => {
                            setInwardToCancel(inw);
                            setCancelModal(true);
                          }}
                          className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold"
                          title="Cancel Inward Receipt"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Inward Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <PackageCheck className="w-6 h-6 text-teal-700" />
                Record Customer Parts Inward
              </h3>
              <button onClick={() => setCreateModal(false)} className="text-slate-400 hover:text-slate-700 font-bold text-lg">✕</button>
            </div>

            <form onSubmit={handleRecordInward} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Confirmed Order Item *</label>
                <select
                  value={selectedOrderItemId}
                  onChange={e => handleItemSelect(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select Order Item...</option>
                  {pendingItems.map(p => (
                    <option key={p.customer_order_item_id} value={p.customer_order_item_id}>
                      {p.order_number} ({p.customer_name}) — {p.part_number} ({p.part_name}) [Pending: {p.pending_qty}]
                    </option>
                  ))}
                </select>
              </div>

              {selectedPending && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2 font-medium">
                  <div>Ordered: <b className="font-mono">{selectedPending.ordered_qty}</b></div>
                  <div>Prev Accepted: <b className="font-mono text-teal-700">{selectedPending.total_accepted_qty}</b></div>
                  <div>Prev Rejected: <b className="font-mono text-red-700">{selectedPending.total_rejected_qty}</b></div>
                  <div>Pending: <b className="font-mono text-amber-700 text-sm font-bold">{selectedPending.pending_qty}</b></div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Challan / DC Number *</label>
                  <input
                    type="text"
                    placeholder="e.g. DC-2026-904"
                    value={challanNumber}
                    onChange={e => setChallanNumber(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Challan Date *</label>
                  <input
                    type="date"
                    value={challanDate}
                    onChange={e => setChallanDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Received Date *</label>
                  <input
                    type="date"
                    value={receivedDate}
                    onChange={e => setReceivedDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-teal-900 mb-1">Accepted Quantity *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={acceptedQty}
                    onChange={e => setAcceptedQty(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-2 border border-teal-300 bg-teal-50/50 rounded-xl text-sm font-mono font-bold text-teal-900 focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-teal-700 mt-0.5 block">Eligible for plating and job card allocation</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-red-900 mb-1">Rejected / Damaged Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={rejectedQty}
                    onChange={e => setRejectedQty(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-red-300 bg-red-50/50 rounded-xl text-sm font-mono font-bold text-red-900 focus:ring-2 focus:ring-red-500"
                  />
                  <span className="text-[11px] text-red-700 mt-0.5 block">Defective parts rejected at inward inspection</span>
                </div>
              </div>

              {rejectedQty > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-red-800 mb-1">Rejection Reason *</label>
                  <input
                    type="text"
                    placeholder="e.g. Surface rust, deformation, incorrect dimensions"
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-red-300 rounded-xl text-sm focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Remarks</label>
                <input
                  type="text"
                  placeholder="Optional remarks"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Math Reconciliation Warning / Indicator */}
              {selectedPending && (
                <div className={`p-3 rounded-xl border text-xs font-bold ${
                  (acceptedQty + rejectedQty) > selectedPending.pending_qty
                    ? 'bg-red-50 border-red-300 text-red-800'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}>
                  Inward Sum: {(acceptedQty + rejectedQty).toLocaleString()} / {selectedPending.pending_qty.toLocaleString()} Pending
                  {(acceptedQty + rejectedQty) > selectedPending.pending_qty && (
                    <span className="block text-red-600 font-semibold mt-0.5">
                      ❌ Total inward exceeds pending quantity by {((acceptedQty + rejectedQty) - selectedPending.pending_qty).toLocaleString()}!
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || (Boolean(selectedPending) && (acceptedQty + rejectedQty) > (selectedPending?.pending_qty || 0))}
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm shadow transition-colors"
                >
                  {submitting ? 'Recording Inward...' : 'Confirm Inward Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModal && inwardToCancel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Cancel Inward Receipt
            </h3>
            <p className="text-sm text-slate-600">
              Are you sure you want to cancel inward receipt <b>{inwardToCancel.inward_number}</b>? This restores the pending quantity on order <b>{inwardToCancel.order_number}</b>.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Cancellation *</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason is required for audit log"
                required
                className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-red-500"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancelModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold"
              >
                Keep Receipt
              </button>
              <button
                type="button"
                onClick={handleCancelInward}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
