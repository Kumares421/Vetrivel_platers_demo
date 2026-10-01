import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, Plus, AlertTriangle, CheckCircle2, XCircle, 
  Search, RefreshCw, Printer, ShieldCheck, Flame, Layers, Network 
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface JobCardsProps {
  onTrace?: (jobCardId: string) => void;
}

export const JobCards: React.FC<JobCardsProps> = ({ onTrace }) => {
  const { isAdmin, isStaff } = useAuth();
  const [jobCards, setJobCards] = useState<any[]>([]);
  const [availableInwards, setAvailableInwards] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Create Modal
  const [createModal, setCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedInwardId, setSelectedInwardId] = useState('');
  const [allocatedQty, setAllocatedQty] = useState<number>(0);
  const [selectedTankId, setSelectedTankId] = useState('');
  const [processType, setProcessType] = useState('');
  const [targetThickness, setTargetThickness] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState('');

  // Print/View Modal
  const [printModal, setPrintModal] = useState(false);
  const [selectedJobCard, setSelectedJobCard] = useState<any | null>(null);

  // Cancel Modal
  const [cancelModal, setCancelModal] = useState(false);
  const [jobToCancel, setJobToCancel] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const fetchJobCardData = async () => {
    setLoading(true);
    setError('');
    try {
      let url = '/job-cards';
      if (statusFilter) url += `?status=${statusFilter}`;
      const [cards, inwards, tankList] = await Promise.all([
        apiFetch<any[]>(url),
        apiFetch<any[]>('/job-cards/available-inwards'),
        apiFetch<any[]>('/tanks')
      ]);
      setJobCards(cards);
      setAvailableInwards(inwards);
      setTanks(tankList.filter(t => t.is_active));
    } catch (err: any) {
      setError(err.message || 'Failed to load job cards');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobCardData();
  }, [statusFilter]);

  const selectedInward = availableInwards.find(i => i.customer_parts_inward_id === selectedInwardId);

  const handleInwardSelect = (inwardId: string) => {
    setSelectedInwardId(inwardId);
    const inw = availableInwards.find(i => i.customer_parts_inward_id === inwardId);
    if (inw) {
      setAllocatedQty(inw.available_to_allocate);
      setProcessType(inw.process_type || 'Zinc Plating');
    }
  };

  const handleCreateJobCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInwardId) {
      alert('Please select a customer parts inward record');
      return;
    }
    if (allocatedQty <= 0) {
      alert('Allocated quantity must be greater than zero');
      return;
    }
    if (selectedInward && allocatedQty > selectedInward.available_to_allocate) {
      alert(`Allocated quantity (${allocatedQty}) cannot exceed available inward quantity (${selectedInward.available_to_allocate})`);
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `jc-submit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await apiFetch('/job-cards', {
        method: 'POST',
        headers: { 'x-idempotency-key': idempotencyKey },
        body: JSON.stringify({
          customer_parts_inward_id: selectedInwardId,
          allocated_qty: allocatedQty,
          tank_id: selectedTankId || null,
          plating_process: processType,
          target_thickness_microns: targetThickness ? parseFloat(targetThickness) : null,
          priority,
          notes
        })
      });

      setCreateModal(false);
      setSelectedInwardId('');
      setAllocatedQty(0);
      setSelectedTankId('');
      setTargetThickness('');
      setNotes('');
      fetchJobCardData();
    } catch (err: any) {
      alert('Failed to release Job Card: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelJobCard = async () => {
    if (!jobToCancel || !cancelReason.trim()) {
      alert('Cancellation reason is required');
      return;
    }
    try {
      await apiFetch(`/job-cards/${jobToCancel.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancelReason })
      });
      setCancelModal(false);
      setJobToCancel(null);
      setCancelReason('');
      fetchJobCardData();
    } catch (err: any) {
      alert('Failed to cancel Job Card: ' + err.message);
    }
  };

  const openPrintJobCard = (job: any) => {
    setSelectedJobCard(job);
    setPrintModal(true);
  };

  const filteredJobs = jobCards.filter(j => {
    return (
      j.job_card_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.inward_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.part_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.tank_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-7 h-7 text-teal-700" />
            Job Card Allocation & Production Release
          </h2>
          <p className="text-slate-500 text-sm">
            Allocate confirmed inward customer parts to production job cards with process parameters and tank assignments.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobCardData}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
            title="Refresh Job Cards"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isStaff && (
            <button
              onClick={() => setCreateModal(true)}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow"
            >
              <Plus className="w-4 h-4" /> Release New Job Card
            </button>
          )}
        </div>
      </div>

      {/* Available Inwards Banner */}
      {availableInwards.length > 0 && (
        <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-bold text-teal-900 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              {availableInwards.length} Inward Lots Ready for Job Card Production Allocation
            </div>
            <p className="text-xs text-teal-700 mt-0.5">
              Available accepted parts can be split across multiple job cards with strict automatic balance reconciliation.
            </p>
          </div>
          <button
            onClick={() => setCreateModal(true)}
            className="px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-xl text-xs shrink-0"
          >
            Allocate Job Card
          </button>
        </div>
      )}

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search Job Card, Order, Inward, Customer, Tank..."
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
            <option value="RELEASED">Released</option>
            <option value="IN_PROGRESS">In Progress</option>
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
            onClick={fetchJobCardData}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Job Cards Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
              <tr>
                <th className="p-4">Job Card No.</th>
                <th className="p-4">Inward Ref</th>
                <th className="p-4">Order Ref</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Part</th>
                <th className="p-4 text-right">Allocated Qty</th>
                <th className="p-4">Process</th>
                <th className="p-4">Assigned Tank</th>
                <th className="p-4 text-center">Priority</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">Loading Job Cards...</td>
                </tr>
              ) : filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">No Job Cards found matching current filters.</td>
                </tr>
              ) : (
                filteredJobs.map(job => (
                  <tr key={job.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-teal-800">{job.job_card_number}</td>
                    <td className="p-4 font-mono text-xs">{job.inward_number}</td>
                    <td className="p-4 font-mono text-xs">{job.order_number}</td>
                    <td className="p-4 font-semibold text-slate-900">{job.customer_name}</td>
                    <td className="p-4">
                      <div className="font-bold text-xs">{job.part_number}</div>
                      <div className="text-slate-500 text-[11px]">{job.part_name}</div>
                    </td>
                    <td className="p-4 text-right font-mono font-black text-slate-900">
                      {job.allocated_qty.toLocaleString()}
                    </td>
                    <td className="p-4 text-xs font-semibold text-teal-800">{job.plating_process}</td>
                    <td className="p-4 text-xs">
                      {job.tank_name ? (
                        <span className="font-semibold text-purple-800 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200">
                          {job.tank_code} - {job.tank_name}
                        </span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        job.priority === 'URGENT' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {job.priority}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        job.status === 'RELEASED' ? 'bg-blue-100 text-blue-800' :
                        job.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-800' :
                        job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                        job.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {onTrace && (
                          <button
                            onClick={() => onTrace(job.id)}
                            className="p-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold"
                            title="Trace Upstream & Downstream Lineage"
                          >
                            <Network className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openPrintJobCard(job)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                          title="Print / View Job Card"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {isAdmin && job.status !== 'CANCELLED' && (
                          <button
                            onClick={() => {
                              setJobToCancel(job);
                              setCancelModal(true);
                            }}
                            className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs"
                            title="Cancel Job Card"
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

      {/* Create Job Card Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-6 h-6 text-teal-700" />
                Allocate & Release Production Job Card
              </h3>
              <button onClick={() => setCreateModal(false)} className="text-slate-400 hover:text-slate-700 font-bold text-lg">✕</button>
            </div>

            <form onSubmit={handleCreateJobCard} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Available Inward Receipt *</label>
                <select
                  value={selectedInwardId}
                  onChange={e => handleInwardSelect(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select Inward Receipt...</option>
                  {availableInwards.map(inw => (
                    <option key={inw.customer_parts_inward_id} value={inw.customer_parts_inward_id}>
                      {inw.inward_number} ({inw.customer_name}) — {inw.part_number} [Available to Allocate: {inw.available_to_allocate} / {inw.accepted_qty} Accepted]
                    </option>
                  ))}
                </select>
              </div>

              {selectedInward && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2 font-medium">
                  <div>Accepted Inward: <b className="font-mono">{selectedInward.accepted_qty}</b></div>
                  <div>Already Allocated: <b className="font-mono text-purple-700">{selectedInward.total_allocated_qty}</b></div>
                  <div>Available: <b className="font-mono text-teal-700 text-sm font-bold">{selectedInward.available_to_allocate}</b></div>
                  <div>Order: <b className="font-mono">{selectedInward.order_number}</b></div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Allocated Quantity to this Job Card *</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={allocatedQty}
                    onChange={e => setAllocatedQty(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono font-black text-slate-900 focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    Must not exceed available inward balance ({selectedInward?.available_to_allocate || 0})
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Production Tank</label>
                  <select
                    value={selectedTankId}
                    onChange={e => setSelectedTankId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select Plating Tank...</option>
                    {tanks.map(t => (
                      <option key={t.id} value={t.id}>{t.code} - {t.display_name} ({t.capacity_liters || 0}L)</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Plating Process *</label>
                  <input
                    type="text"
                    value={processType}
                    onChange={e => setProcessType(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Thickness (µm)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 8.0"
                    value={targetThickness}
                    onChange={e => setTargetThickness(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="URGENT">Urgent / Rush</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Special Processing Instructions</label>
                <input
                  type="text"
                  placeholder="e.g. Pre-cleaning degrease pass, bake after plating"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Excess Allocation Warning */}
              {selectedInward && allocatedQty > selectedInward.available_to_allocate && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-bold">
                  ❌ Cannot allocate {allocatedQty} units. Only {selectedInward.available_to_allocate} units available from this inward receipt!
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
                  disabled={submitting || (Boolean(selectedInward) && allocatedQty > (selectedInward?.available_to_allocate || 0))}
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-sm shadow transition-colors"
                >
                  {submitting ? 'Releasing Job Card...' : 'Confirm & Release Job Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Job Card Modal */}
      {printModal && selectedJobCard && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">VETRIVEL PLATERS</h1>
                <p className="text-xs font-bold text-slate-600">PRODUCTION ROUTE SHEET & JOB CARD</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-mono font-black text-teal-800">{selectedJobCard.job_card_number}</div>
                <div className="text-xs text-slate-500">Released: {new Date(selectedJobCard.released_at).toLocaleDateString()}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs border border-slate-200 rounded-xl p-4 bg-slate-50">
              <div><span className="text-slate-500">Customer:</span> <b className="text-slate-900 font-bold">{selectedJobCard.customer_name}</b></div>
              <div><span className="text-slate-500">Customer PO:</span> <b className="font-mono">{selectedJobCard.customer_po_number || 'N/A'}</b></div>
              <div><span className="text-slate-500">Order Number:</span> <b className="font-mono">{selectedJobCard.order_number}</b></div>
              <div><span className="text-slate-500">Inward Receipt:</span> <b className="font-mono">{selectedJobCard.inward_number}</b></div>
              <div><span className="text-slate-500">Part Number:</span> <b className="font-mono">{selectedJobCard.part_number}</b></div>
              <div><span className="text-slate-500">Part Description:</span> <b>{selectedJobCard.part_name}</b></div>
              <div><span className="text-slate-500">Allocated Batch Qty:</span> <b className="font-mono text-base font-black text-teal-900">{selectedJobCard.allocated_qty.toLocaleString()} {selectedJobCard.base_unit || 'nos'}</b></div>
              <div><span className="text-slate-500">Assigned Tank:</span> <b>{selectedJobCard.tank_name || 'Floor Assignment'}</b></div>
              <div><span className="text-slate-500">Plating Process:</span> <b className="text-teal-800">{selectedJobCard.plating_process}</b></div>
              <div><span className="text-slate-500">Target Thickness:</span> <b>{selectedJobCard.target_thickness_microns ? `${selectedJobCard.target_thickness_microns} µm` : 'As per spec'}</b></div>
            </div>

            {selectedJobCard.notes && (
              <div className="text-xs bg-amber-50 p-3 rounded-xl border border-amber-200">
                <span className="font-bold text-amber-900">Operator Remarks:</span> {selectedJobCard.notes}
              </div>
            )}

            <div className="pt-8 border-t border-slate-200 grid grid-cols-3 gap-4 text-center text-xs text-slate-500">
              <div className="border-t border-slate-400 pt-1">Stores Inward Verification</div>
              <div className="border-t border-slate-400 pt-1">Production Supervisor</div>
              <div className="border-t border-slate-400 pt-1">Quality Inspection (QA)</div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 print:hidden">
              <button
                onClick={() => setPrintModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm font-semibold"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 shadow"
              >
                <Printer className="w-4 h-4" /> Print Job Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Job Card Modal */}
      {cancelModal && jobToCancel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Cancel Job Card
            </h3>
            <p className="text-sm text-slate-600">
              Are you sure you want to cancel Job Card <b>{jobToCancel.job_card_number}</b>? This restores <b>{jobToCancel.allocated_qty}</b> units back to the available inward stock.
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
                Keep Job Card
              </button>
              <button
                type="button"
                onClick={handleCancelJobCard}
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
