import React, { useState, useEffect } from 'react';
import { Boxes, Filter, History, AlertTriangle, Shield, CheckCircle2, ChevronRight, Ban, Eye, Calendar } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { QuantityBadge } from '../components/QuantityBadge';
import { StatusBadge } from '../components/StatusBadge';
import { CorrectReceiptDateModal } from '../components/CorrectReceiptDateModal';

export const Stock: React.FC = () => {
  const { user, canPost } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedChemicalId, setSelectedChemicalId] = useState('');
  const [includeExhausted, setIncludeExhausted] = useState(false);
  const [search, setSearch] = useState('');

  // Modals
  const [timelineLot, setTimelineLot] = useState<any | null>(null);
  const [timelineMovements, setTimelineMovements] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const [correctingReceipt, setCorrectingReceipt] = useState<any | null>(null);

  const [adjustingLot, setAdjustingLot] = useState<any | null>(null);
  const [newStatus, setNewStatus] = useState('QUARANTINED');
  const [adjReason, setAdjReason] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);
  const [adjError, setAdjError] = useState('');

  const fetchStockData = async () => {
    setLoading(true);
    try {
      const chemRes = await apiFetch<any[]>('/chemicals');
      setChemicals(chemRes);

      let url = `/stock/lots?include_exhausted=${includeExhausted}`;
      if (selectedChemicalId) {
        url += `&chemical_id=${selectedChemicalId}`;
      }
      const lotRes = await apiFetch<any[]>(url);
      setLots(lotRes);
    } catch (err) {
      console.error('Failed to load stock data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStockData();
  }, [selectedChemicalId, includeExhausted]);

  const handleOpenTimeline = async (lot: any) => {
    setTimelineLot(lot);
    setTimelineLoading(true);
    try {
      const history = await apiFetch<any[]>(`/stock/lots/${lot.id}/movements`);
      setTimelineMovements(history);
    } catch (err) {
      console.error('Failed to fetch lot history:', err);
    } finally {
      setTimelineLoading(false);
    }
  };

  const handleOpenAdjustment = (lot: any) => {
    setAdjustingLot(lot);
    setNewStatus(lot.status === 'QUARANTINED' ? 'AVAILABLE' : 'QUARANTINED');
    setAdjReason('');
    setAdjError('');
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjReason) {
      setAdjError('Adjustment reason is mandatory for audit logging');
      return;
    }
    setAdjSubmitting(true);
    try {
      await apiFetch(`/stock/lots/${adjustingLot.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: newStatus,
          reason: adjReason,
        }),
      });
      setAdjustingLot(null);
      fetchStockData();
    } catch (err: any) {
      setAdjError(err.message || 'Failed to update lot status');
    } finally {
      setAdjSubmitting(false);
    }
  };

  const filteredLots = lots.filter(
    l => l.lot_number.toLowerCase().includes(search.toLowerCase()) ||
         (l.supplier_batch_number && l.supplier_batch_number.toLowerCase().includes(search.toLowerCase())) ||
         (l.chemical_name && l.chemical_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Boxes className="w-7 h-7 text-teal-600" />
            Stock & Traceable Lot Ledger
          </h2>
          <p className="text-slate-500 text-sm">Real-time batch lot balances, quarantine holds, and movement timeline history.</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <div className="w-full sm:w-64">
            <select
              value={selectedChemicalId}
              onChange={e => setSelectedChemicalId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            >
              <option value="">All Chemicals</option>
              {chemicals.map(c => (
                <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
              ))}
            </select>
          </div>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search lot or batch ID..."
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includeExhausted}
              onChange={e => setIncludeExhausted(e.target.checked)}
              className="w-4 h-4 text-teal-600 rounded"
            />
            <span>Show Exhausted (Zero Stock) Lots</span>
          </label>
        </div>

      </div>

      {/* Lots Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-900 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-4">Lot Number</th>
                <th className="p-4">Chemical Name</th>
                <th className="p-4">Supplier Batch</th>
                <th className="p-4">Location</th>
                <th className="p-4">Remaining Balance</th>
                <th className="p-4">Initial Qty</th>
                <th className="p-4">Receipt Date</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Timeline & Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400 font-sans">Loading stock lots...</td>
                </tr>
              ) : filteredLots.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400 font-sans">No matching stock lots found.</td>
                </tr>
              ) : (
                filteredLots.map(lot => (
                  <tr key={lot.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-bold text-slate-900">{lot.lot_number}</td>
                    <td className="p-4 font-sans font-semibold text-slate-900">
                      <div>{lot.chemical_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{lot.chemical_code}</div>
                    </td>
                    <td className="p-4 text-slate-700">{lot.supplier_batch_number}</td>
                    <td className="p-4 font-sans text-slate-600">{lot.location || 'MAIN-STORE'}</td>
                    <td className="p-4 font-sans">
                      <QuantityBadge
                        value={lot.remaining_qty}
                        unit={lot.base_unit}
                        bold
                        className={parseFloat(lot.remaining_qty) > 0 ? 'text-teal-800' : 'text-slate-400'}
                      />
                    </td>
                    <td className="p-4 font-sans">
                      <QuantityBadge value={lot.initial_qty} unit={lot.base_unit} />
                    </td>
                    <td className="p-4 font-sans text-slate-600">
                      <div>{lot.actual_received_at ? new Date(lot.actual_received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'}</div>
                      {lot.created_at && (
                        <div className="text-[10px] text-slate-400">Recorded: {new Date(lot.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</div>
                      )}
                    </td>
                    <td className="p-4 font-sans">
                      <StatusBadge status={lot.status} />
                    </td>
                    <td className="p-4 text-right font-sans space-x-1">
                      <button
                        onClick={() => handleOpenTimeline(lot)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" /> History
                      </button>
                      {isAdmin && lot.purchase_receipt_id && (
                        <button
                          onClick={() => setCorrectingReceipt({
                            id: lot.purchase_receipt_id,
                            receipt_number: lot.bill_number ? `REC (${lot.bill_number})` : lot.lot_number,
                            actual_received_at: lot.actual_received_at,
                            created_at: lot.created_at
                          })}
                          className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1"
                        >
                          <Calendar className="w-3.5 h-3.5" /> Correct Date
                        </button>
                      )}
                      {canPost && (
                        <button
                          onClick={() => handleOpenAdjustment(lot)}
                          className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-xs font-semibold transition-colors"
                        >
                          Status Adjust
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

      {/* Movement Timeline Drawer / Modal */}
      {timelineLot && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-xl font-bold text-slate-900 font-mono">
                  Movement History: {timelineLot.lot_number}
                </h3>
                <p className="text-xs text-slate-500 font-sans mt-0.5">
                  {timelineLot.chemical_name} (Supplier Batch: {timelineLot.supplier_batch_number})
                </p>
              </div>
              <button onClick={() => setTimelineLot(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 my-4 pr-1 space-y-4">
              {timelineLoading ? (
                <div className="p-6 text-center text-slate-400 text-sm">Loading movement timeline...</div>
              ) : timelineMovements.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">No recorded movements for this lot.</div>
              ) : (
                <div className="relative border-l-2 border-slate-200 ml-4 space-y-6">
                  {timelineMovements.map(m => (
                    <div key={m.id} className="relative pl-6">
                      <div className={`absolute -left-[9px] top-0.5 w-4 h-4 rounded-full border-2 bg-white ${
                        m.movement_type === 'RECEIPT' || m.movement_type === 'OPENING' ? 'border-teal-600' :
                        m.movement_type === 'ISSUE' ? 'border-slate-900' : 'border-purple-600'
                      }`} />
                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold uppercase tracking-wider ${
                            m.movement_type === 'RECEIPT' || m.movement_type === 'OPENING' ? 'text-teal-700' :
                            m.movement_type === 'ISSUE' ? 'text-slate-900' : 'text-purple-700'
                          }`}>
                            {m.movement_type}
                          </span>
                          <div className="text-[10px] text-slate-500 font-mono text-right">
                            <div>Movement: {new Date(m.movement_date || m.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div>
                            <div className="text-slate-400">Record Created: {new Date(m.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          Qty Change: {parseFloat(m.quantity_change) > 0 ? '+' : ''}{m.quantity_change} {timelineLot.base_unit}
                        </div>
                        <div className="text-xs text-slate-600 flex items-center justify-between pt-1 border-t border-slate-200/60">
                          <span>Balance After: <b>{m.balance_after} {timelineLot.base_unit}</b></span>
                          <span className="text-slate-400">Ref: {m.reference_id || 'N/A'}</span>
                        </div>
                        {m.reason && <div className="text-xs text-slate-500 italic mt-1">{m.reason}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 text-right">
              <button
                onClick={() => setTimelineLot(null)}
                className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl"
              >
                Close Timeline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lot Status Adjustment Modal */}
      {adjustingLot && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-lg">Lot Status Adjustment</h3>
              <button onClick={() => setAdjustingLot(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            {adjError && (
              <div className="mt-3 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">
                {adjError}
              </div>
            )}

            <form onSubmit={handleSaveAdjustment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Stock Lot</label>
                <div className="p-3 bg-slate-100 rounded-xl font-mono text-xs text-slate-900 font-bold">
                  {adjustingLot.lot_number} ({adjustingLot.chemical_name})
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">Select New Status</label>
                <select
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500"
                >
                  <option value="AVAILABLE">AVAILABLE (Eligible for FIFO Issue)</option>
                  <option value="QUARANTINED">QUARANTINED (Hold for Quality Testing)</option>
                  <option value="BLOCKED">BLOCKED (Damaged / Rejected)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Adjustment Audit Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  value={adjReason}
                  onChange={e => setAdjReason(e.target.value)}
                  placeholder="e.g. Lab quality re-testing hold, container leak..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustingLot(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjSubmitting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow"
                >
                  {adjSubmitting ? 'Updating...' : 'Confirm Status Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Correct Receipt Date Modal */}
      {correctingReceipt && (
        <CorrectReceiptDateModal
          receiptId={correctingReceipt.id}
          receiptNumber={correctingReceipt.receipt_number}
          currentActualReceivedAt={correctingReceipt.actual_received_at}
          createdAt={correctingReceipt.created_at}
          onClose={() => setCorrectingReceipt(null)}
          onSuccess={() => fetchStockData()}
        />
      )}

    </div>
  );
};
