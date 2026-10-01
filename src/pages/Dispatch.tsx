import React, { useState, useEffect } from 'react';
import { 
  Truck, AlertCircle, CheckCircle2, XCircle, Search, 
  Clock, ArrowRight, Eye, RefreshCw, X, Layers,
  Calendar, FileText, Ban, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

interface PendingDispatch {
  qc_inspection_id: string;
  qc_number: string;
  qc_date: string;
  qc_inspected_qty: number;
  qc_accepted_qty: number;
  qc_rejected_qty: number;
  qc_status: string;
  production_execution_id: string;
  production_number: string;
  production_date: string;
  production_processed_qty: number;
  production_status: string;
  job_card_id: string;
  job_card_number: string;
  plating_process: string;
  tank_code: string;
  tank_name: string;
  part_id: string;
  part_number: string;
  part_name: string;
  base_unit: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  already_dispatched_qty: number;
  remaining_dispatchable_qty: number;
}

interface DispatchRecord {
  id: string;
  dispatch_number: string;
  job_card_id: string;
  production_execution_id: string;
  qc_inspection_id: string;
  customer_id: string;
  dispatch_date: string;
  dispatched_qty: number;
  vehicle_number?: string;
  transporter_name?: string;
  delivery_address?: string;
  challan_number?: string;
  remarks?: string;
  status: 'DISPATCHED' | 'CANCELLED';
  dispatched_by_user_id: string;
  cancelled_at?: string;
  cancelled_by_user_id?: string;
  cancellation_reason?: string;
  created_at: string;
  customer_name: string;
  customer_code: string;
  job_card_number: string;
  plating_process: string;
  production_number: string;
  production_date: string;
  qc_number: string;
  qc_accepted_qty: number;
  part_number: string;
  part_name: string;
  base_unit: string;
  tank_code: string;
  tank_name: string;
  dispatched_by_name: string;
  dispatched_by_email: string;
  cancelled_by_name?: string;
}

export const Dispatch: React.FC = () => {
  const { user, isAdmin, isSuperAdmin } = useAuth();

  // State
  const [pendingQueue, setPendingQueue] = useState<PendingDispatch[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedPending, setSelectedPending] = useState<PendingDispatch | null>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedDispatch, setSelectedDispatch] = useState<DispatchRecord | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [dispatchToCancel, setDispatchToCancel] = useState<DispatchRecord | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');

  // Create Dispatch Form State
  const [dispatchDate, setDispatchDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dispatchQty, setDispatchQty] = useState<number>(0);
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [transporterName, setTransporterName] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [challanNumber, setChallanNumber] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Load Data
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch pending dispatch queue
      const pendingData = await apiFetch<PendingDispatch[]>('/dispatch/pending');
      setPendingQueue(pendingData);

      // Fetch dispatch register
      const dispatchData = await apiFetch<DispatchRecord[]>('/dispatch');
      setDispatches(dispatchData);
    } catch (err: any) {
      setError(err.message || 'Error connecting to Dispatch services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Open Create Dispatch Modal
  const handleOpenCreateModal = (item: PendingDispatch) => {
    setSelectedPending(item);
    setDispatchDate(new Date().toISOString().slice(0, 10));
    setDispatchQty(item.remaining_dispatchable_qty);
    setVehicleNumber('');
    setTransporterName('');
    setDeliveryAddress('');
    setChallanNumber(`DC-${Date.now().toString().slice(-6)}`);
    setRemarks('');
    setError(null);
    setCreateModalOpen(true);
  };

  // Submit Create Dispatch
  const handleSubmitDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPending) return;

    if (dispatchQty <= 0) {
      setError('Dispatched quantity must be greater than 0.');
      return;
    }

    if (dispatchQty > selectedPending.remaining_dispatchable_qty) {
      setError(`Dispatched quantity (${dispatchQty}) cannot exceed available quantity (${selectedPending.remaining_dispatchable_qty} pcs).`);
      return;
    }

    try {
      setFormSubmitting(true);
      setError(null);

      const idempotencyKey = `DSP-SUBMIT-${selectedPending.qc_inspection_id}-${Date.now()}`;

      const payload = {
        job_card_id: selectedPending.job_card_id,
        production_execution_id: selectedPending.production_execution_id,
        qc_inspection_id: selectedPending.qc_inspection_id,
        dispatched_qty: dispatchQty,
        dispatch_date: dispatchDate,
        vehicle_number: vehicleNumber || undefined,
        transporter_name: transporterName || undefined,
        delivery_address: deliveryAddress || undefined,
        challan_number: challanNumber || undefined,
        remarks: remarks || undefined,
        idempotency_key: idempotencyKey
      };

      const res = await apiFetch<DispatchRecord>('/dispatch', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      setSuccessMsg(`Dispatch record ${res.dispatch_number} created successfully! ${res.dispatched_qty} pcs dispatched.`);
      setCreateModalOpen(false);
      setSelectedPending(null);
      await fetchData();

      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Cancel Dispatch
  const handleConfirmCancel = async () => {
    if (!dispatchToCancel) return;

    if (!cancelReason.trim()) {
      setError('Cancellation reason is required.');
      return;
    }

    try {
      setFormSubmitting(true);
      setError(null);

      await apiFetch(`/dispatch/${dispatchToCancel.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancelReason.trim() })
      });

      setSuccessMsg(`Dispatch ${dispatchToCancel.dispatch_number} cancelled. ${dispatchToCancel.dispatched_qty} pcs restored to available dispatchable stock.`);
      setCancelModalOpen(false);
      setDispatchToCancel(null);
      setCancelReason('');
      await fetchData();

      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFormSubmitting(false);
    }
  };

  // Live Metrics Calculations
  const todayStr = new Date().toISOString().slice(0, 10);
  const readyBatchesCount = pendingQueue.length;
  const totalQuantityReady = pendingQueue.reduce((sum, p) => sum + p.remaining_dispatchable_qty, 0);
  const dispatchedToday = dispatches
    .filter(d => d.status === 'DISPATCHED' && d.dispatch_date === todayStr)
    .reduce((sum, d) => sum + d.dispatched_qty, 0);
  const totalDispatched = dispatches
    .filter(d => d.status === 'DISPATCHED')
    .reduce((sum, d) => sum + d.dispatched_qty, 0);

  // Search & Filter
  const filteredDispatches = dispatches.filter(d => {
    const matchesStatus = filterStatus === 'ALL' || d.status === filterStatus;
    const matchesSearch = searchTerm === '' ||
      d.dispatch_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.job_card_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.production_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.qc_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.part_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.part_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.challan_number && d.challan_number.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-teal-50 text-teal-600 border border-teal-100">
              <Truck className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customer Dispatch</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Dispatch QC-approved parts to customers with delivery challan generation and live balance tracking.
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
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ready for Dispatch</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{readyBatchesCount}</div>
            <div className="text-xs text-teal-600 font-medium">QC PASS Batches</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quantity Ready</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{totalQuantityReady} <span className="text-sm font-normal text-slate-500">pcs</span></div>
            <div className="text-xs text-indigo-600 font-medium">Approved Stock</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Dispatched Today</div>
            <div className="text-2xl font-bold text-emerald-600 mt-0.5">{dispatchedToday} <span className="text-sm font-normal text-slate-500">pcs</span></div>
            <div className="text-xs text-emerald-600 font-medium">{todayStr}</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Dispatched</div>
            <div className="text-2xl font-bold text-slate-900 mt-0.5">{totalDispatched} <span className="text-sm font-normal text-slate-500">pcs</span></div>
            <div className="text-xs text-slate-500 font-medium">Cumulative Shipments</div>
          </div>
        </div>
      </div>

      {/* Pending Dispatch Queue */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              QC-Approved Batches Awaiting Dispatch
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Strictly filtered: COMPLETED Production & PASS QC with positive remaining dispatchable quantity.
            </p>
          </div>
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-800">
            {pendingQueue.length} Batches Eligible
          </span>
        </div>

        {pendingQueue.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            <Truck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            No QC-approved parts currently waiting to be dispatched.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Job Card #</th>
                  <th className="px-4 py-3">Customer & Part</th>
                  <th className="px-4 py-3">Production & QC</th>
                  <th className="px-4 py-3 text-right">QC Accepted</th>
                  <th className="px-4 py-3 text-right">Already Dispatched</th>
                  <th className="px-4 py-3 text-right">Available Qty</th>
                  <th className="px-4 py-3 text-center">QC Date</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingQueue.map((item) => (
                  <tr key={item.qc_inspection_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-medium text-slate-800">
                        {item.job_card_number}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{item.customer_name}</div>
                      <div className="text-xs text-slate-500">{item.part_name} ({item.part_number})</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{item.production_number}</div>
                      <div className="text-xs text-teal-600 font-semibold">{item.qc_number} (PASS)</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                      {item.qc_accepted_qty} {item.base_unit}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {item.already_dispatched_qty} {item.base_unit}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-teal-600">
                      {item.remaining_dispatchable_qty} {item.base_unit}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500 whitespace-nowrap">
                      {item.qc_date}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => handleOpenCreateModal(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors shadow-sm"
                      >
                        Create Dispatch
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

      {/* Dispatch Register */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900">Dispatch Register</h2>
            <p className="text-xs text-slate-500 mt-0.5">Historical delivery records and shipment challans</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Dispatch #, Job, Part, Challan..."
                className="pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 w-48 sm:w-64"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 text-xs font-medium">
              {['ALL', 'DISPATCHED', 'CANCELLED'].map(st => (
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

        {filteredDispatches.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No dispatch records match the selected criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Dispatch #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer & Part</th>
                  <th className="px-4 py-3">Job & Production</th>
                  <th className="px-4 py-3">QC #</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3">Vehicle / Transporter</th>
                  <th className="px-4 py-3">Challan #</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDispatches.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                      {row.dispatch_number}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {row.dispatch_date}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{row.customer_name}</div>
                      <div className="text-xs text-slate-500">{row.part_name}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{row.job_card_number}</div>
                      <div className="text-xs text-slate-500">{row.production_number}</div>
                    </td>
                    <td className="px-4 py-3 text-teal-600 font-medium whitespace-nowrap">
                      {row.qc_number}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {row.dispatched_qty} {row.base_unit}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs font-medium text-slate-800">{row.vehicle_number || 'N/A'}</div>
                      <div className="text-[11px] text-slate-500">{row.transporter_name || 'Direct Delivery'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                      <span className="font-mono text-xs">{row.challan_number || '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        row.status === 'DISPATCHED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {row.status === 'DISPATCHED' ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <XCircle className="w-3 h-3 text-rose-600" />}
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => { setSelectedDispatch(row); setViewModalOpen(true); }}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="View Delivery Challan"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {row.status === 'DISPATCHED' && (isAdmin || isSuperAdmin) && (
                          <button
                            onClick={() => { setDispatchToCancel(row); setCancelReason(''); setCancelModalOpen(true); }}
                            className="p-1.5 text-rose-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                            title="Cancel Dispatch (Reversal)"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE DISPATCH MODAL */}
      {createModalOpen && selectedPending && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Truck className="w-5 h-5 text-teal-600" />
                  Create Customer Dispatch
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Job Card: <span className="font-semibold text-slate-800">{selectedPending.job_card_number}</span> | QC: <span className="font-semibold text-teal-600">{selectedPending.qc_number}</span>
                </p>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDispatch} className="p-6 space-y-5">
              {/* Product and Customer Summary */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="font-semibold text-slate-900">{selectedPending.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Part</span>
                  <span className="font-semibold text-slate-900">{selectedPending.part_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Plating Process</span>
                  <span className="font-semibold text-slate-900">{selectedPending.plating_process}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Production Run</span>
                  <span className="font-semibold text-slate-900">{selectedPending.production_number}</span>
                </div>
              </div>

              {/* Quantity Reconciliation Box */}
              <div className="p-4 bg-teal-50/60 rounded-xl border border-teal-200 space-y-2">
                <div className="text-xs font-bold text-teal-900 uppercase tracking-wider">
                  Quantity Reconciliation
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-white p-2 rounded-lg border border-teal-100">
                    <span className="text-slate-500 block">QC Accepted</span>
                    <span className="font-bold text-slate-900 text-sm">{selectedPending.qc_accepted_qty}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-teal-100">
                    <span className="text-slate-500 block">Already Dispatched</span>
                    <span className="font-bold text-slate-900 text-sm">{selectedPending.already_dispatched_qty}</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-teal-100">
                    <span className="text-slate-500 block">Available to Dispatch</span>
                    <span className="font-bold text-teal-700 text-sm">{selectedPending.remaining_dispatchable_qty}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs pt-1 px-1 font-medium">
                  <span className="text-teal-900">Balance after this dispatch:</span>
                  <span className={`font-bold ${
                    selectedPending.remaining_dispatchable_qty - dispatchQty >= 0 
                      ? 'text-teal-700' 
                      : 'text-red-600'
                  }`}>
                    {selectedPending.remaining_dispatchable_qty - dispatchQty} {selectedPending.base_unit}
                  </span>
                </div>
              </div>

              {/* Input Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Dispatch Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={dispatchDate}
                    onChange={(e) => setDispatchDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Quantity to Dispatch *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={selectedPending.remaining_dispatchable_qty}
                    required
                    value={dispatchQty}
                    onChange={(e) => setDispatchQty(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-semibold focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Delivery Challan #
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. DC-100234"
                    value={challanNumber}
                    onChange={(e) => setChallanNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Vehicle Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TN-38-AX-1234"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Transporter Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. VRL Logistics / Self"
                    value={transporterName}
                    onChange={(e) => setTransporterName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Delivery Address
                  </label>
                  <input
                    type="text"
                    placeholder="Delivery site or plant..."
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Dispatch Remarks
                </label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Gate pass number, driver contact, packaging details..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between -mx-6 -mb-6">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    formSubmitting ||
                    dispatchQty <= 0 ||
                    dispatchQty > selectedPending.remaining_dispatchable_qty
                  }
                  className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 rounded-lg shadow transition-colors"
                >
                  <Truck className="w-4 h-4" />
                  Confirm & Dispatch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW CHALLAN PREVIEW MODAL */}
      {viewModalOpen && selectedDispatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-teal-600" />
                  Delivery Challan #{selectedDispatch.challan_number || selectedDispatch.dispatch_number}
                </h3>
                <span className={`inline-block mt-1 text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  selectedDispatch.status === 'DISPATCHED' 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : 'bg-rose-100 text-rose-800'
                }`}>
                  Status: {selectedDispatch.status}
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
                  <span className="text-slate-500 block">Dispatch Number</span>
                  <span className="font-semibold text-slate-900">{selectedDispatch.dispatch_number}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Dispatch Date</span>
                  <span className="font-semibold text-slate-900">{selectedDispatch.dispatch_date}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Customer</span>
                  <span className="font-semibold text-slate-900">{selectedDispatch.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Part Name</span>
                  <span className="font-semibold text-slate-900">{selectedDispatch.part_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Job Card</span>
                  <span className="font-semibold text-slate-900">{selectedDispatch.job_card_number}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">QC Approval #</span>
                  <span className="font-semibold text-teal-600">{selectedDispatch.qc_number}</span>
                </div>
              </div>

              <div className="p-4 bg-slate-100/60 rounded-xl text-center">
                <span className="text-xs text-slate-500 block">Dispatched Quantity</span>
                <span className="text-3xl font-extrabold text-teal-700">
                  {selectedDispatch.dispatched_qty} <span className="text-base font-normal text-slate-600">{selectedDispatch.base_unit}</span>
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Vehicle Number</span>
                  <span className="font-semibold text-slate-800">{selectedDispatch.vehicle_number || 'N/A'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Transporter</span>
                  <span className="font-semibold text-slate-800">{selectedDispatch.transporter_name || 'Direct Delivery'}</span>
                </div>
                {selectedDispatch.delivery_address && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Delivery Address</span>
                    <span className="font-semibold text-slate-800">{selectedDispatch.delivery_address}</span>
                  </div>
                )}
                {selectedDispatch.remarks && (
                  <div className="py-1">
                    <span className="text-slate-500 block">Remarks</span>
                    <span className="font-medium text-slate-800">{selectedDispatch.remarks}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Dispatched By</span>
                  <span className="font-semibold text-slate-800">{selectedDispatch.dispatched_by_name}</span>
                </div>
                {selectedDispatch.status === 'CANCELLED' && (
                  <div className="p-3 bg-rose-50 rounded-lg text-rose-800 border border-rose-200 mt-2">
                    <span className="font-bold block">Cancelled By {selectedDispatch.cancelled_by_name} at {new Date(selectedDispatch.cancelled_at!).toLocaleString()}</span>
                    <span className="text-xs">Reason: {selectedDispatch.cancellation_reason}</span>
                  </div>
                )}
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

      {/* CANCELLATION MODAL (ADMIN ONLY) */}
      {cancelModalOpen && dispatchToCancel && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-rose-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-rose-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                  Cancel Dispatch Record
                </h3>
                <p className="text-xs text-rose-700 mt-0.5">
                  Dispatch #{dispatchToCancel.dispatch_number} ({dispatchToCancel.dispatched_qty} pcs)
                </p>
              </div>
              <button
                onClick={() => setCancelModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Cancelling this dispatch will keep the historical record for audit compliance, mark status as <strong className="text-rose-700">CANCELLED</strong>, and immediately restore the <strong className="text-teal-700">{dispatchToCancel.dispatched_qty} pcs</strong> back to the available QC dispatch balance.
              </p>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Cancellation Reason *
                </label>
                <textarea
                  rows={3}
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Transport vehicle breakdown, incorrect quantity logged..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Close
              </button>

              <button
                type="button"
                disabled={formSubmitting || !cancelReason.trim()}
                onClick={handleConfirmCancel}
                className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 rounded-lg shadow transition-colors"
              >
                <Ban className="w-4 h-4" />
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dispatch;
