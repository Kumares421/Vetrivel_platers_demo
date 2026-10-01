import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, AlertCircle, CheckCircle2, XCircle, Search, Filter,
  Clock, ArrowRight, Eye, RefreshCw, Check, X, FileCheck, Layers,
  Calendar, User, AlertTriangle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface PendingProduction {
  production_execution_id: string;
  production_number: string;
  production_date: string;
  started_at: string;
  completed_at: string;
  planned_qty: number;
  processed_qty: number;
  production_rejected_qty: number;
  production_status: string;
  production_notes: string;
  job_card_id: string;
  job_card_number: string;
  plating_process: string;
  target_thickness_microns: number;
  priority: string;
  part_id: string;
  part_number: string;
  part_name: string;
  base_unit: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  tank_id: string;
  tank_code: string;
  tank_name: string;
  total_inspected_qty: number;
  uninspected_qty: number;
}

interface QCInspection {
  id: string;
  qc_number: string;
  production_execution_id: string;
  job_card_id: string;
  inspector_user_id: string;
  inspection_date: string;
  inspected_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  coating_thickness?: number;
  min_thickness?: number;
  max_thickness?: number;
  thickness_unit: string;
  visual_defect?: string;
  defect_details?: string;
  remarks?: string;
  status: 'PENDING' | 'INSPECTED' | 'PASS' | 'FAIL';
  created_at: string;
  completed_at?: string;
  production_number: string;
  production_date: string;
  production_processed_qty: number;
  production_rejected_qty: number;
  job_card_number: string;
  plating_process: string;
  target_thickness_microns?: number;
  tank_code: string;
  tank_name: string;
  part_number: string;
  part_name: string;
  base_unit: string;
  customer_name: string;
  customer_code: string;
  inspector_name: string;
  inspector_email: string;
}

import { apiFetch } from '../lib/api';

export const QC: React.FC = () => {
  const { user } = useAuth();

  // State
  const [pendingQueue, setPendingQueue] = useState<PendingProduction[]>([]);
  const [inspections, setInspections] = useState<QCInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modals
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [selectedPending, setSelectedPending] = useState<PendingProduction | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<QCInspection | null>(null);

  // Inspection Form State
  const [inspectedQty, setInspectedQty] = useState<number>(0);
  const [acceptedQty, setAcceptedQty] = useState<number>(0);
  const [rejectedQty, setRejectedQty] = useState<number>(0);
  const [coatingThickness, setCoatingThickness] = useState<string>('');
  const [minThickness, setMinThickness] = useState<string>('');
  const [maxThickness, setMaxThickness] = useState<string>('');
  const [visualDefect, setVisualDefect] = useState<string>('NO_DEFECT');
  const [defectDetails, setDefectDetails] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Load Data
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch pending queue
      const pendingData = await apiFetch<PendingProduction[]>('/qc/pending');
      setPendingQueue(pendingData);

      // Fetch QC register
      const qcData = await apiFetch<QCInspection[]>('/qc');
      setInspections(qcData);

    } catch (err: any) {
      setError(err.message || 'Error connecting to QC services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Open Inspection Modal
  const handleOpenInspect = (pending: PendingProduction) => {
    setSelectedPending(pending);
    setInspectedQty(pending.uninspected_qty);
    setAcceptedQty(pending.uninspected_qty);
    setRejectedQty(0);
    setCoatingThickness(pending.target_thickness_microns ? String(pending.target_thickness_microns) : '');
    setMinThickness('');
    setMaxThickness('');
    setVisualDefect('NO_DEFECT');
    setDefectDetails('');
    setRemarks('');
    setError(null);
    setInspectModalOpen(true);
  };

  // Submit Inspection
  const handleSubmitInspection = async (desiredStatus: 'PASS' | 'FAIL') => {
    if (!selectedPending) return;

    // Client-side validations
    if (inspectedQty <= 0) {
      setError('Inspected quantity must be greater than 0');
      return;
    }

    if (Math.abs((acceptedQty + rejectedQty) - inspectedQty) > 0.0001) {
      setError(`Quantity mismatch: Accepted (${acceptedQty}) + Rejected (${rejectedQty}) must equal Inspected (${inspectedQty})`);
      return;
    }

    if (desiredStatus === 'PASS' && rejectedQty > 0) {
      setError(`Cannot PASS an inspection with ${rejectedQty} rejected pieces. Please mark as FAIL or adjust quantities.`);
      return;
    }

    if (desiredStatus === 'FAIL' && !defectDetails && visualDefect === 'NO_DEFECT') {
      setError('Please specify visual defect type or defect details for failed inspection.');
      return;
    }

    try {
      setFormSubmitting(true);
      setError(null);

      const idempotencyKey = `QC-SUBMIT-${selectedPending.production_execution_id}-${Date.now()}`;

      const payload = {
        production_execution_id: selectedPending.production_execution_id,
        inspected_qty: inspectedQty,
        accepted_qty: acceptedQty,
        rejected_qty: rejectedQty,
        status: desiredStatus,
        coating_thickness: coatingThickness ? parseFloat(coatingThickness) : undefined,
        min_thickness: minThickness ? parseFloat(minThickness) : undefined,
        max_thickness: maxThickness ? parseFloat(maxThickness) : undefined,
        thickness_unit: 'microns',
        visual_defect: visualDefect,
        defect_details: defectDetails || undefined,
        remarks: remarks || undefined,
        idempotency_key: idempotencyKey
      };

      const data = await apiFetch<QCInspection>('/qc', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      setSuccessMsg(`QC Inspection ${data.qc_number} successfully recorded with status ${data.status}!`);
      setInspectModalOpen(false);
      setSelectedPending(null);
      await fetchData();

      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFormSubmitting(false);
    }
  };

  // Metrics Calculations from Live Records
  const pendingCount = pendingQueue.length;
  const passedCount = inspections.filter(i => i.status === 'PASS').length;
  const failedCount = inspections.filter(i => i.status === 'FAIL').length;
  const totalAwaitingQty = pendingQueue.reduce((sum, p) => sum + p.uninspected_qty, 0);

  // Filtered Inspections
  const filteredInspections = inspections.filter(i => {
    const matchesStatus = filterStatus === 'ALL' || i.status === filterStatus;
    const matchesSearch = searchTerm === '' || 
      i.qc_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.production_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.job_card_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.part_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.part_number.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-teal-50 text-teal-600 border border-teal-100">
              <ShieldCheck className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Quality Control (QC)</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Downstream inspection for completed production executions with coating thickness & defect verification.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-medium">{error}</div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-start gap-3 shadow-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1 text-sm font-medium">{successMsg}</div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Live Dashboard Metric Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending QC Runs</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{pendingCount}</div>
            <div className="text-xs text-amber-600 font-medium">Awaiting Inspection</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty Awaiting QC</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{totalAwaitingQty} <span className="text-sm font-normal text-slate-500">pcs</span></div>
            <div className="text-xs text-teal-600 font-medium">Ready for Sampling</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Passed QC</div>
            <div className="text-2xl font-bold text-emerald-600 mt-0.5">{passedCount}</div>
            <div className="text-xs text-emerald-600 font-medium">Ready for Future Dispatch</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
            <XCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Failed QC</div>
            <div className="text-2xl font-bold text-rose-600 mt-0.5">{failedCount}</div>
            <div className="text-xs text-rose-600 font-medium">Quarantined / Rework</div>
          </div>
        </div>
      </div>

      {/* Pending QC Queue Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Quality Inspection Queue
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Completed production executions that have parts pending inspection.
            </p>
          </div>
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
            {pendingQueue.length} Batches Eligible
          </span>
        </div>

        {pendingQueue.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            <FileCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            No completed production executions currently awaiting QC inspection.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Production #</th>
                  <th className="px-4 py-3">Job Card #</th>
                  <th className="px-4 py-3">Customer & Part</th>
                  <th className="px-4 py-3">Process & Tank</th>
                  <th className="px-4 py-3 text-right">Produced Qty</th>
                  <th className="px-4 py-3 text-right">Uninspected Qty</th>
                  <th className="px-4 py-3 text-center">Completed At</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingQueue.map((item) => (
                  <tr key={item.production_execution_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      {item.production_number}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-medium text-slate-800">
                        {item.job_card_number}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.customer_name}</div>
                      <div className="text-xs text-slate-500">{item.part_name} ({item.part_number})</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{item.plating_process}</div>
                      <div className="text-xs text-slate-500">{item.tank_code} - {item.tank_name}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">
                      {item.processed_qty} {item.base_unit}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-amber-600">
                      {item.uninspected_qty} {item.base_unit}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500 whitespace-nowrap">
                      {item.completed_at ? new Date(item.completed_at).toLocaleString() : 'Recently'}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => handleOpenInspect(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors shadow-sm"
                      >
                        Inspect
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QC Inspection Register Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900">QC Inspection Register</h2>
            <p className="text-xs text-slate-500 mt-0.5">Historical quality audit records with pass/fail certification</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search QC #, Job, Part..."
                className="pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 w-44 sm:w-56"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 text-xs font-medium">
              {['ALL', 'PASS', 'FAIL', 'PENDING'].map(st => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filterStatus === st 
                      ? 'bg-slate-900 text-white font-semibold' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredInspections.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No inspection records match the selected criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">QC Number</th>
                  <th className="px-4 py-3">Production & Job Card</th>
                  <th className="px-4 py-3">Customer & Part</th>
                  <th className="px-4 py-3 text-right">Inspected</th>
                  <th className="px-4 py-3 text-right">Accepted</th>
                  <th className="px-4 py-3 text-right">Rejected</th>
                  <th className="px-4 py-3">Thickness (μm)</th>
                  <th className="px-4 py-3">Visual Result</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Date & Inspector</th>
                  <th className="px-4 py-3 text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInspections.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                      {row.qc_number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{row.production_number}</div>
                      <div className="text-xs text-slate-500">{row.job_card_number}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.customer_name}</div>
                      <div className="text-xs text-slate-500">{row.part_name}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">
                      {row.inspected_qty}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                      {row.accepted_qty}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-rose-600">
                      {row.rejected_qty}
                    </td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                      {row.coating_thickness ? (
                        <span>{row.coating_thickness} μm</span>
                      ) : (
                        <span className="text-slate-400 italic">N/A</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        row.visual_defect === 'NO_DEFECT' 
                          ? 'bg-emerald-50 text-emerald-700' 
                          : 'bg-rose-50 text-rose-700'
                      }`}>
                        {row.visual_defect || 'NO_DEFECT'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        row.status === 'PASS'
                          ? 'bg-emerald-100 text-emerald-800'
                          : row.status === 'FAIL'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-800'
                      }`}>
                        {row.status === 'PASS' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                        {row.status === 'FAIL' && <XCircle className="w-3 h-3 text-rose-600" />}
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="text-xs font-medium text-slate-800">{row.inspection_date}</div>
                      <div className="text-[11px] text-slate-400">{row.inspector_name}</div>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => { setSelectedInspection(row); setViewModalOpen(true); }}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                        title="View inspection details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* INSPECTION FORM MODAL */}
      {inspectModalOpen && selectedPending && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-teal-600" />
                  Record Quality Inspection
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Production: <span className="font-semibold text-slate-800">{selectedPending.production_number}</span> | Job Card: <span className="font-semibold text-slate-800">{selectedPending.job_card_number}</span>
                </p>
              </div>
              <button
                onClick={() => setInspectModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Product Info Summary Box */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="font-semibold text-slate-900">{selectedPending.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Part Name</span>
                  <span className="font-semibold text-slate-900">{selectedPending.part_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Plating Process</span>
                  <span className="font-semibold text-slate-900">{selectedPending.plating_process}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Target Thickness</span>
                  <span className="font-semibold text-slate-900">{selectedPending.target_thickness_microns ? `${selectedPending.target_thickness_microns} μm` : 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Total Produced</span>
                  <span className="font-semibold text-slate-900">{selectedPending.processed_qty} {selectedPending.base_unit}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Already Inspected</span>
                  <span className="font-semibold text-slate-900">{selectedPending.total_inspected_qty} {selectedPending.base_unit}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Uninspected Balance</span>
                  <span className="font-bold text-amber-600">{selectedPending.uninspected_qty} {selectedPending.base_unit} available for QC</span>
                </div>
              </div>

              {/* Quantity Reconciliation Section */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Quantity Reconciliation (pcs)
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Inspected Qty *</span>
                    <input
                      type="number"
                      min="1"
                      max={selectedPending.uninspected_qty}
                      value={inspectedQty}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setInspectedQty(val);
                        setAcceptedQty(val);
                        setRejectedQty(0);
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-semibold focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block text-emerald-700 font-medium">Accepted Qty *</span>
                    <input
                      type="number"
                      min="0"
                      max={inspectedQty}
                      value={acceptedQty}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setAcceptedQty(val);
                        setRejectedQty(Math.max(0, inspectedQty - val));
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-emerald-300 font-semibold text-emerald-700 bg-emerald-50/30 focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block text-rose-700 font-medium">Rejected Qty *</span>
                    <input
                      type="number"
                      min="0"
                      max={inspectedQty}
                      value={rejectedQty}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setRejectedQty(val);
                        setAcceptedQty(Math.max(0, inspectedQty - val));
                      }}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-rose-300 font-semibold text-rose-700 bg-rose-50/30 focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                </div>

                {/* Validation Indicator */}
                <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                  Math.abs((acceptedQty + rejectedQty) - inspectedQty) < 0.0001
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {Math.abs((acceptedQty + rejectedQty) - inspectedQty) < 0.0001 ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Valid: Accepted ({acceptedQty}) + Rejected ({rejectedQty}) = Inspected ({inspectedQty})</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span>Formula Error: Accepted + Rejected must equal Inspected ({inspectedQty})</span>
                    </>
                  )}
                </div>
              </div>

              {/* Coating Thickness Measurement */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Coating Thickness Measurement (microns / μm)
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Measured Thickness</span>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 12.5"
                      value={coatingThickness}
                      onChange={(e) => setCoatingThickness(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Min Thickness</span>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Min"
                      value={minThickness}
                      onChange={(e) => setMinThickness(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Max Thickness</span>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Max"
                      value={maxThickness}
                      onChange={(e) => setMaxThickness(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>

              {/* Visual Inspection & Defects */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Visual Inspection
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Visual Defect Type</span>
                    <select
                      value={visualDefect}
                      onChange={(e) => setVisualDefect(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="NO_DEFECT">NO_DEFECT (Clean / Compliant)</option>
                      <option value="SCRATCH">SCRATCH</option>
                      <option value="PIT">PIT</option>
                      <option value="DISCOLORATION">DISCOLORATION</option>
                      <option value="ROUGH_SURFACE">ROUGH_SURFACE</option>
                      <option value="PEELING">PEELING</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 mb-1 block">Defect Details / Reason</span>
                    <input
                      type="text"
                      placeholder="Detail if any defect observed..."
                      value={defectDetails}
                      onChange={(e) => setDefectDetails(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Inspector Remarks
                </label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Notes on adhesion test, finish luster, bath conditions..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setInspectModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>

              <div className="flex items-center gap-3">
                {rejectedQty > 0 ? (
                  <button
                    type="button"
                    disabled={formSubmitting || Math.abs((acceptedQty + rejectedQty) - inspectedQty) > 0.0001}
                    onClick={() => handleSubmitInspection('FAIL')}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 rounded-lg shadow transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Record & FAIL
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={formSubmitting || Math.abs((acceptedQty + rejectedQty) - inspectedQty) > 0.0001}
                    onClick={() => handleSubmitInspection('PASS')}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded-lg shadow transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Record & PASS
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {viewModalOpen && selectedInspection && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <FileCheck className="w-5 h-5 text-teal-600" />
                  Quality Certificate #{selectedInspection.qc_number}
                </h3>
                <span className={`inline-block mt-1 text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  selectedInspection.status === 'PASS' 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : selectedInspection.status === 'FAIL'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-100 text-slate-800'
                }`}>
                  Status: {selectedInspection.status}
                </span>
              </div>
              <button
                onClick={() => setViewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Production Run</span>
                  <span className="font-semibold text-slate-900">{selectedInspection.production_number}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Job Card</span>
                  <span className="font-semibold text-slate-900">{selectedInspection.job_card_number}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="font-semibold text-slate-900">{selectedInspection.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Part Name</span>
                  <span className="font-semibold text-slate-900">{selectedInspection.part_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Plating Process</span>
                  <span className="font-semibold text-slate-900">{selectedInspection.plating_process}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Bath / Tank</span>
                  <span className="font-semibold text-slate-900">{selectedInspection.tank_code} - {selectedInspection.tank_name}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-100/50 rounded-lg text-center">
                <div>
                  <span className="text-xs text-slate-500 block">Inspected</span>
                  <span className="text-base font-bold text-slate-900">{selectedInspection.inspected_qty}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Accepted</span>
                  <span className="text-base font-bold text-emerald-600">{selectedInspection.accepted_qty}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Rejected</span>
                  <span className="text-base font-bold text-rose-600">{selectedInspection.rejected_qty}</span>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Coating Thickness</span>
                  <span className="font-semibold text-slate-800">{selectedInspection.coating_thickness ? `${selectedInspection.coating_thickness} μm` : 'N/A'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Visual Defect</span>
                  <span className="font-semibold text-slate-800">{selectedInspection.visual_defect || 'NO_DEFECT'}</span>
                </div>
                {selectedInspection.defect_details && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Defect Details</span>
                    <span className="font-semibold text-rose-700">{selectedInspection.defect_details}</span>
                  </div>
                )}
                {selectedInspection.remarks && (
                  <div className="py-1">
                    <span className="text-slate-500 block">Remarks</span>
                    <span className="font-medium text-slate-800">{selectedInspection.remarks}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Inspector</span>
                  <span className="font-semibold text-slate-800">{selectedInspection.inspector_name} ({selectedInspection.inspector_email})</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Inspection Timestamp</span>
                  <span className="font-semibold text-slate-800">{new Date(selectedInspection.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setViewModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QC;
