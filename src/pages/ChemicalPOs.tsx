import React, { useState, useEffect } from 'react';
import { 
  FileText, Plus, CheckCircle2, XCircle, AlertTriangle, 
  Search, RefreshCw, ArrowDownToLine, Trash2 
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QuantityBadge } from '../components/QuantityBadge';

export const ChemicalPOs: React.FC<{ onNavigateToReceive?: (poId?: string) => void }> = ({ onNavigateToReceive }) => {
  const { isAdmin, isStaff } = useAuth();
  const [pos, setPos] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Create Modal
  const [createModal, setCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [poDate, setPoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [autoApprove, setAutoApprove] = useState(true);
  const [poItems, setPoItems] = useState<Array<{ chemical_id: string; ordered_qty: number; rate_per_unit: number }>>([
    { chemical_id: '', ordered_qty: 100, rate_per_unit: 0 }
  ]);

  // View Details Modal
  const [selectedPO, setSelectedPO] = useState<any | null>(null);
  const [detailsModal, setDetailsModal] = useState(false);

  // Cancel Modal
  const [cancelModal, setCancelModal] = useState(false);
  const [poToCancel, setPoToCancel] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const fetchPOs = async () => {
    setLoading(true);
    setError('');
    try {
      let url = '/chemical-pos';
      if (statusFilter) url += `?status=${statusFilter}`;
      const [poList, suppList, chemList] = await Promise.all([
        apiFetch<any[]>(url),
        apiFetch<any[]>('/suppliers'),
        apiFetch<any[]>('/chemicals')
      ]);
      setPos(poList);
      setSuppliers(suppList);
      setChemicals(chemList.filter(c => c.is_active));
    } catch (err: any) {
      setError(err.message || 'Failed to load Chemical Purchase Orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPOs();
  }, [statusFilter]);

  const handleAddItem = () => {
    setPoItems([...poItems, { chemical_id: '', ordered_qty: 50, rate_per_unit: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    if (poItems.length === 1) return;
    setPoItems(poItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, val: any) => {
    const updated = [...poItems];
    (updated[index] as any)[field] = val;
    setPoItems(updated);
  };

  const totalAmount = poItems.reduce((acc, it) => {
    const qty = parseFloat(it.ordered_qty as any) || 0;
    const rate = parseFloat(it.rate_per_unit as any) || 0;
    return acc + (qty * rate);
  }, 0);

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      alert('Please select a supplier');
      return;
    }
    for (let i = 0; i < poItems.length; i++) {
      if (!poItems[i].chemical_id) {
        alert(`Please select a chemical for Item #${i + 1}`);
        return;
      }
      if (poItems[i].ordered_qty <= 0) {
        alert(`Item #${i + 1}: Ordered quantity must be greater than zero`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `cpo-submit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await apiFetch('/chemical-pos', {
        method: 'POST',
        headers: { 'x-idempotency-key': idempotencyKey },
        body: JSON.stringify({
          supplier_id: supplierId,
          po_date: poDate,
          expected_delivery_date: expectedDate || null,
          notes,
          auto_approve: autoApprove,
          items: poItems
        })
      });

      setCreateModal(false);
      setSupplierId('');
      setNotes('');
      setPoItems([{ chemical_id: '', ordered_qty: 100, rate_per_unit: 0 }]);
      fetchPOs();
    } catch (err: any) {
      alert('Failed to create Chemical PO: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovePO = async (poId: string) => {
    if (!confirm('Approve this Chemical Purchase Order?')) return;
    try {
      await apiFetch(`/chemical-pos/${poId}/approve`, { method: 'POST' });
      fetchPOs();
    } catch (err: any) {
      alert('Failed to approve PO: ' + err.message);
    }
  };

  const handleCancelPO = async () => {
    if (!poToCancel || !cancelReason.trim()) {
      alert('Cancellation reason is required');
      return;
    }
    try {
      await apiFetch(`/chemical-pos/${poToCancel.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancelReason })
      });
      setCancelModal(false);
      setPoToCancel(null);
      setCancelReason('');
      fetchPOs();
    } catch (err: any) {
      alert('Failed to cancel PO: ' + err.message);
    }
  };

  const openPODetails = async (poId: string) => {
    try {
      const details = await apiFetch<any>(`/chemical-pos/${poId}`);
      setSelectedPO(details);
      setDetailsModal(true);
    } catch (e: any) {
      alert('Failed to load PO details: ' + e.message);
    }
  };

  const filteredPOs = pos.filter(p => {
    return (
      p.po_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-teal-700" />
            Chemical Purchase Orders
          </h2>
          <p className="text-slate-500 text-sm">
            Issue chemical purchase orders to approved suppliers. Note: Creating a PO does NOT increase stock until goods receipt.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchPOs}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            title="Refresh POs"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={() => setCreateModal(true)}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow"
            >
              <Plus className="w-4 h-4" /> New Chemical PO
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search PO Number, Supplier..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <label className="text-xs font-semibold text-slate-600">Status:</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Approved</option>
            <option value="PARTIALLY_RECEIVED">Partially Received</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
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
            onClick={fetchPOs}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* PO Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
              <tr>
                <th className="p-4">PO Number</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">PO Date</th>
                <th className="p-4">Expected Date</th>
                <th className="p-4 text-right">Ordered Qty</th>
                <th className="p-4 text-right">Received Qty</th>
                <th className="p-4 text-right text-amber-700">Pending Qty</th>
                <th className="p-4 text-right">Total Amount</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">Loading Chemical Purchase Orders...</td>
                </tr>
              ) : filteredPOs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">No Chemical Purchase Orders found.</td>
                </tr>
              ) : (
                filteredPOs.map(po => (
                  <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-teal-800">{po.po_number}</td>
                    <td className="p-4 font-semibold text-slate-900">{po.supplier_name}</td>
                    <td className="p-4 text-xs">{po.po_date}</td>
                    <td className="p-4 text-xs">{po.expected_delivery_date || '—'}</td>
                    <td className="p-4 text-right font-mono font-bold">{po.total_ordered_qty.toLocaleString()}</td>
                    <td className="p-4 text-right font-mono font-bold text-teal-700">{po.total_received_qty.toLocaleString()}</td>
                    <td className="p-4 text-right font-mono font-bold text-amber-700">{po.total_pending_qty.toLocaleString()}</td>
                    <td className="p-4 text-right font-mono font-bold text-slate-900">
                      ₹{po.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        po.status === 'APPROVED' ? 'bg-teal-100 text-teal-800' :
                        po.status === 'PARTIALLY_RECEIVED' ? 'bg-blue-100 text-blue-800' :
                        po.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                        po.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {po.status}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openPODetails(po.id)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                          title="View PO Details"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        {isAdmin && po.status === 'DRAFT' && (
                          <button
                            onClick={() => handleApprovePO(po.id)}
                            className="p-1.5 bg-teal-100 hover:bg-teal-200 text-teal-800 rounded-lg text-xs font-bold"
                            title="Approve PO"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin && po.status !== 'CANCELLED' && po.status !== 'COMPLETED' && (
                          <button
                            onClick={() => {
                              setPoToCancel(po);
                              setCancelModal(true);
                            }}
                            className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs"
                            title="Cancel PO"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Chemical PO Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-6 h-6 text-teal-700" />
                Issue Chemical Purchase Order
              </h3>
              <button onClick={() => setCreateModal(false)} className="text-slate-400 hover:text-slate-700 font-bold text-lg">✕</button>
            </div>

            <form onSubmit={handleCreatePO} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Chemical Supplier *</label>
                  <select
                    value={supplierId}
                    onChange={e => setSupplierId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select Supplier...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">PO Date *</label>
                  <input
                    type="date"
                    value={poDate}
                    onChange={e => setPoDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Expected Delivery Date</label>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={e => setExpectedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Terms</label>
                <input
                  type="text"
                  placeholder="Payment terms, delivery instructions, COA requirements"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Items Table */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-sm font-bold text-slate-900">Chemical Items</h4>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Chemical Item
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Chemical Selection *</th>
                        <th className="p-3 w-32">Ordered Qty *</th>
                        <th className="p-3 w-32">Rate / Unit (₹) *</th>
                        <th className="p-3 w-32 text-right">Line Total</th>
                        <th className="p-3 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {poItems.map((item, idx) => {
                        const lineAmt = (parseFloat(item.ordered_qty as any) || 0) * (parseFloat(item.rate_per_unit as any) || 0);
                        return (
                          <tr key={idx}>
                            <td className="p-2">
                              <select
                                value={item.chemical_id}
                                onChange={e => handleItemChange(idx, 'chemical_id', e.target.value)}
                                required
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-teal-500"
                              >
                                <option value="">Select Chemical...</option>
                                {chemicals.map(c => (
                                  <option key={c.id} value={c.id}>{c.code} - {c.name} ({c.base_unit})</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={item.ordered_qty}
                                onChange={e => handleItemChange(idx, 'ordered_qty', parseFloat(e.target.value))}
                                required
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.rate_per_unit}
                                onChange={e => handleItemChange(idx, 'rate_per_unit', parseFloat(e.target.value))}
                                required
                                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                              />
                            </td>
                            <td className="p-2 text-right font-mono font-bold text-slate-900">
                              ₹{lineAmt.toFixed(2)}
                            </td>
                            <td className="p-2 text-center">
                              {poItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(idx)}
                                  className="text-slate-400 hover:text-red-600 p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 text-right font-bold text-sm">
                  Total PO Amount: <span className="font-mono text-base">₹{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="autoApprove"
                  checked={autoApprove}
                  onChange={e => setAutoApprove(e.target.checked)}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                <label htmlFor="autoApprove" className="text-xs font-semibold text-slate-700">
                  Immediately approve Purchase Order for warehouse inward receipt
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm shadow transition-colors"
                >
                  {submitting ? 'Creating PO...' : 'Confirm & Issue Purchase Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO Details Modal */}
      {detailsModal && selectedPO && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-xl font-bold text-slate-900 font-mono">{selectedPO.po_number}</h3>
                <p className="text-xs text-slate-500">Supplier: <b className="text-slate-800">{selectedPO.supplier_name}</b></p>
              </div>
              <button onClick={() => setDetailsModal(false)} className="text-slate-400 hover:text-slate-700 font-bold text-lg">✕</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl text-xs">
              <div><span className="text-slate-500">PO Date:</span> <b>{selectedPO.po_date}</b></div>
              <div><span className="text-slate-500">Status:</span> <b>{selectedPO.status}</b></div>
              <div><span className="text-slate-500">Created By:</span> <b>{selectedPO.created_by_name}</b></div>
              <div><span className="text-slate-500">Approved By:</span> <b>{selectedPO.approved_by_name || 'Pending'}</b></div>
            </div>

            <h4 className="text-sm font-bold text-slate-900">Chemical Line Items</h4>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Chemical</th>
                    <th className="p-3 text-right">Ordered</th>
                    <th className="p-3 text-right text-teal-700">Received</th>
                    <th className="p-3 text-right text-amber-700">Pending</th>
                    <th className="p-3 text-right">Rate</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {selectedPO.items?.map((it: any) => (
                    <tr key={it.id}>
                      <td className="p-3 font-sans font-bold">{it.chemical_code} - {it.chemical_name}</td>
                      <td className="p-3 text-right font-bold">{it.ordered_qty} {it.base_unit}</td>
                      <td className="p-3 text-right text-teal-700 font-bold">{it.received_qty} {it.base_unit}</td>
                      <td className="p-3 text-right text-amber-700 font-black">{it.pending_qty} {it.base_unit}</td>
                      <td className="p-3 text-right">₹{it.rate_per_unit.toFixed(2)}</td>
                      <td className="p-3 text-right font-bold text-slate-900">₹{it.line_amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => setDetailsModal(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel PO Modal */}
      {cancelModal && poToCancel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Cancel Chemical Purchase Order
            </h3>
            <p className="text-sm text-slate-600">
              Are you sure you want to cancel PO <b>{poToCancel.po_number}</b>? This action preserves full audit history.
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
                Keep PO
              </button>
              <button
                type="button"
                onClick={handleCancelPO}
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
