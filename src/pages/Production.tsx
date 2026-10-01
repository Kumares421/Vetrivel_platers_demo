import React, { useState, useEffect } from 'react';
import { 
  Factory, Play, CheckCircle2, XCircle, AlertTriangle, 
  FlaskConical, RefreshCw, Plus, Search, Filter, Calendar, 
  Container, Layers, User, ArrowRight, ShieldAlert, History
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export const Production: React.FC = () => {
  const { user, isAdmin, isSuperAdmin } = useAuth();

  // State
  const [executions, setExecutions] = useState<any[]>([]);
  const [eligibleJobs, setEligibleJobs] = useState<any[]>([]);
  const [activeTanks, setActiveTanks] = useState<any[]>([]);
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tankFilter, setTankFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // New Production Execution Modal
  const [createModal, setCreateModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedTankId, setSelectedTankId] = useState('');
  const [plannedQty, setPlannedQty] = useState<number | string>('');
  const [startImmediately, setStartImmediately] = useState(true);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Record Progress / Complete Modal
  const [actionModal, setActionModal] = useState<'RECORD' | 'COMPLETE' | null>(null);
  const [activeExec, setActiveExec] = useState<any | null>(null);
  const [processedQty, setProcessedQty] = useState<number | string>('');
  const [rejectedQty, setRejectedQty] = useState<number | string>('0');
  const [actionNotes, setActionNotes] = useState('');

  // Cancel Modal
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Chemical FIFO Issue Modal (Connected to existing FIFO engine)
  const [chemModal, setChemModal] = useState(false);
  const [chemExec, setChemExec] = useState<any | null>(null);
  const [chemId, setChemId] = useState('');
  const [chemQty, setChemQty] = useState<number | string>('');
  const [chemShift, setChemShift] = useState('Shift 1');
  const [chemRemarks, setChemRemarks] = useState('');
  const [fifoPreview, setFifoPreview] = useState<any | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [issuingChem, setIssuingChem] = useState(false);

  // Detail Drawer / Modal
  const [detailModal, setDetailModal] = useState<any | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [execRes, jobsRes, tanksRes, chemRes] = await Promise.all([
        apiFetch<any[]>('/production'),
        apiFetch<any[]>('/production/eligible-jobs'),
        apiFetch<any[]>('/production/tanks'),
        apiFetch<any[]>('/chemicals')
      ]);
      setExecutions(execRes);
      setEligibleJobs(jobsRes);
      setActiveTanks(tanksRes);
      setChemicals(chemRes.filter((c: any) => c.is_active));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load production data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Selected Job Card helper
  const selectedJob = eligibleJobs.find(j => j.job_card_id === selectedJobId);

  // Handle open create modal
  const handleOpenCreateModal = (jobId?: string) => {
    setErrorMsg('');
    setStatusMsg('');
    if (jobId) {
      const job = eligibleJobs.find(j => j.job_card_id === jobId);
      setSelectedJobId(jobId);
      setSelectedTankId(job?.default_tank_id || (activeTanks[0]?.id || ''));
      setPlannedQty(job?.remaining_to_produce || '');
    } else {
      setSelectedJobId(eligibleJobs[0]?.job_card_id || '');
      const firstJob = eligibleJobs[0];
      setSelectedTankId(firstJob?.default_tank_id || (activeTanks[0]?.id || ''));
      setPlannedQty(firstJob?.remaining_to_produce || '');
    }
    setStartImmediately(true);
    setNotes('');
    setCreateModal(true);
  };

  // Submit Create Execution
  const handleCreateExecution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob) {
      alert('Please select an eligible Job Card.');
      return;
    }
    const plan = parseFloat(String(plannedQty));
    if (isNaN(plan) || plan <= 0) {
      alert('Planned quantity must be greater than zero.');
      return;
    }
    if (plan > selectedJob.remaining_to_produce) {
      alert(`Planned quantity (${plan}) cannot exceed remaining Job Card quantity (${selectedJob.remaining_to_produce}).`);
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `PRD-IDEM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const res = await apiFetch<any>('/production', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          job_card_id: selectedJobId,
          tank_id: selectedTankId,
          planned_qty: plan,
          start_immediately: startImmediately,
          notes: notes.trim(),
          idempotency_key: idempotencyKey
        })
      });
      setStatusMsg(`Production execution ${res.production_number} created successfully (${res.status}).`);
      setCreateModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to create production execution');
    } finally {
      setSubmitting(false);
    }
  };

  // Start Planned Execution
  const handleStartExecution = async (exec: any) => {
    if (!confirm(`Start production execution ${exec.production_number} on ${exec.tank_code}?`)) return;
    try {
      await apiFetch(`/production/${exec.id}/start`, { method: 'POST' });
      setStatusMsg(`Production execution ${exec.production_number} started.`);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle Record / Complete Submit
  const handleRecordOrComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeExec) return;
    const proc = parseFloat(String(processedQty));
    const rej = parseFloat(String(rejectedQty));
    if (isNaN(proc) || proc < 0) {
      alert('Processed quantity must be 0 or greater.');
      return;
    }
    if (isNaN(rej) || rej < 0) {
      alert('Rejected quantity must be 0 or greater.');
      return;
    }
    if (proc + rej > activeExec.planned_qty) {
      alert(`Total produced + rejected (${proc + rej}) exceeds planned execution quantity (${activeExec.planned_qty}).`);
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = actionModal === 'COMPLETE' 
        ? `/production/${activeExec.id}/complete` 
        : `/production/${activeExec.id}/record`;
      
      const res = await apiFetch<any>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          processed_qty: proc,
          rejected_qty: rej,
          notes: actionNotes.trim()
        })
      });

      if (actionModal === 'COMPLETE') {
        setStatusMsg(`Production execution ${activeExec.production_number} COMPLETED successfully. (Job Card Completed: ${res.job_card_completed ? 'YES' : 'NO'})`);
      } else {
        setStatusMsg(`Progress recorded for ${activeExec.production_number}: ${proc} processed, ${rej} rejected.`);
      }

      setActionModal(null);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Cancel Execution
  const handleCancelExecution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeExec) return;
    if (!cancelReason.trim()) {
      alert('Cancellation reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/production/${activeExec.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: cancelReason.trim() })
      });
      setStatusMsg(`Production execution ${activeExec.production_number} cancelled.`);
      setCancelModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Preview Chemical Issue FIFO allocations
  const handlePreviewFIFO = async () => {
    if (!chemId || !chemQty || parseFloat(String(chemQty)) <= 0) return;
    setLoadingPreview(true);
    setFifoPreview(null);
    try {
      const res = await apiFetch<any>('/issues/fifo-preview', {
        method: 'POST',
        body: JSON.stringify({
          chemical_id: chemId,
          required_qty: parseFloat(String(chemQty))
        })
      });
      setFifoPreview(res);
    } catch (err: any) {
      alert(`FIFO preview error: ${err.message}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  // Submit Chemical Issue via Existing FIFO engine
  const handleIssueChemical = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chemExec || !chemId || !chemQty) return;
    const qty = parseFloat(String(chemQty));
    if (isNaN(qty) || qty <= 0) {
      alert('Required chemical quantity must be greater than zero.');
      return;
    }

    setIssuingChem(true);
    try {
      const idempotencyKey = `ISS-PRD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const res = await apiFetch<any>(`/production/${chemExec.id}/issue-chemical`, {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          chemical_id: chemId,
          required_qty: qty,
          shift: chemShift,
          remarks: chemRemarks.trim(),
          idempotency_key: idempotencyKey
        })
      });

      setStatusMsg(`Chemical issue ${res.issue_number} posted via FIFO for Production ${chemExec.production_number} (${res.total_allocated_qty} issued).`);
      setChemModal(false);
      setFifoPreview(null);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to post FIFO chemical issue');
    } finally {
      setIssuingChem(false);
    }
  };

  // View Details Drawer
  const handleViewDetails = async (exec: any) => {
    try {
      const details = await apiFetch<any>(`/production/${exec.id}`);
      setDetailModal(details);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Filtered Executions
  const filteredExecutions = executions.filter(pe => {
    const matchesStatus = statusFilter === 'ALL' || pe.status === statusFilter;
    const matchesTank = tankFilter === 'ALL' || pe.tank_id === tankFilter;
    const term = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || 
      pe.production_number.toLowerCase().includes(term) ||
      pe.job_card_number.toLowerCase().includes(term) ||
      pe.customer_name.toLowerCase().includes(term) ||
      pe.part_number.toLowerCase().includes(term) ||
      pe.tank_code.toLowerCase().includes(term);
    return matchesStatus && matchesTank && matchesSearch;
  });

  // Metric stats
  const activeCount = executions.filter(e => e.status === 'IN_PROGRESS' || e.status === 'PLANNED').length;
  const inProgressCount = executions.filter(e => e.status === 'IN_PROGRESS').length;
  const completedCount = executions.filter(e => e.status === 'COMPLETED').length;
  const qtyInProd = executions
    .filter(e => e.status === 'IN_PROGRESS')
    .reduce((acc, e) => acc + e.remaining_qty, 0);

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Factory className="w-7 h-7 text-teal-600" />
            Production Execution Module
          </h2>
          <p className="text-slate-500 text-sm">
            Execute released Job Cards, assign production tanks, issue bath chemicals via strict FIFO, and record output.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2 border border-slate-200 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          
          <button
            onClick={() => handleOpenCreateModal()}
            disabled={eligibleJobs.length === 0}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Start Production
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-teal-50 border border-teal-200 text-teal-900 rounded-xl text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Production Live Metrics Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Executions</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{activeCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Planned or currently running</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-blue-200 shadow-sm bg-gradient-to-br from-blue-50/40 to-white">
          <div className="text-xs font-bold text-blue-700 uppercase tracking-wider">In Progress</div>
          <div className="text-2xl font-black text-blue-900 mt-1">{inProgressCount}</div>
          <div className="text-[11px] text-blue-700 mt-0.5">Active baths & lines</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm bg-gradient-to-br from-amber-50/40 to-white">
          <div className="text-xs font-bold text-amber-700 uppercase tracking-wider">Qty in Production</div>
          <div className="text-2xl font-black text-amber-900 mt-1">{qtyInProd.toLocaleString()} pcs</div>
          <div className="text-[11px] text-amber-700 mt-0.5">Undergoing plating</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-teal-200 shadow-sm bg-gradient-to-br from-teal-50/40 to-white">
          <div className="text-xs font-bold text-teal-700 uppercase tracking-wider">Completed Batches</div>
          <div className="text-2xl font-black text-teal-900 mt-1">{completedCount}</div>
          <div className="text-[11px] text-teal-700 mt-0.5">Finished executions</div>
        </div>
      </div>

      {/* Section 1: Eligible Job Cards Waiting for Production */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Layers className="w-5 h-5 text-teal-600" />
              Job Cards Ready for Production
              <span className="px-2 py-0.5 bg-teal-100 text-teal-900 text-xs font-bold rounded-full">
                {eligibleJobs.length}
              </span>
            </h3>
            <p className="text-xs text-slate-500">Released job cards with uncommitted allocated parts ready for bath processing.</p>
          </div>
        </div>

        {eligibleJobs.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400">
            No Job Cards awaiting production. Release a Job Card from the Job Cards module first.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
                <tr>
                  <th className="p-3">Job Card No.</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Part Details</th>
                  <th className="p-3">Process Variety</th>
                  <th className="p-3">Allocated Qty</th>
                  <th className="p-3">Already Planned</th>
                  <th className="p-3">Remaining to Produce</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {eligibleJobs.map(job => (
                  <tr key={job.job_card_id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-teal-700">{job.job_card_number}</td>
                    <td className="p-3 font-semibold text-slate-900">{job.customer_name}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-800">{job.part_number}</div>
                      <div className="text-[10px] text-slate-500">{job.part_name}</div>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded font-semibold text-[10px]">
                        {job.plating_process}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-700">{job.allocated_qty} {job.base_unit}</td>
                    <td className="p-3 font-mono text-slate-500">{job.total_planned_qty} {job.base_unit}</td>
                    <td className="p-3 font-mono font-extrabold text-teal-800">{job.remaining_to_produce} {job.base_unit}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleOpenCreateModal(job.job_card_id)}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold text-[11px] shadow-sm flex items-center gap-1 ml-auto"
                      >
                        <Play className="w-3.5 h-3.5" /> Start Production
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 2: Production Executions Register */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Factory className="w-5 h-5 text-slate-700" />
              Production Executions Register
            </h3>
            <p className="text-xs text-slate-500">Track in-progress plating runs, chemical additions, and final processed output.</p>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search production, job, part..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="py-1.5 px-2.5 border border-slate-300 rounded-xl text-xs font-semibold"
            >
              <option value="ALL">All Statuses</option>
              <option value="PLANNED">PLANNED</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>

            <select
              value={tankFilter}
              onChange={e => setTankFilter(e.target.value)}
              className="py-1.5 px-2.5 border border-slate-300 rounded-xl text-xs font-semibold"
            >
              <option value="ALL">All Tanks</option>
              {activeTanks.map(t => (
                <option key={t.id} value={t.id}>{t.code} - {t.display_name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-800">
              <tr>
                <th className="p-3">Production No.</th>
                <th className="p-3">Job Card</th>
                <th className="p-3">Customer / Part</th>
                <th className="p-3">Production Tank</th>
                <th className="p-3">Planned Qty</th>
                <th className="p-3">Produced / Rejected</th>
                <th className="p-3">Status</th>
                <th className="p-3">Chemical FIFO</th>
                <th className="p-3">Operator</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExecutions.map(pe => (
                <tr key={pe.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-teal-800">
                    <button 
                      onClick={() => handleViewDetails(pe)} 
                      className="hover:underline text-left"
                      title="View execution details"
                    >
                      {pe.production_number}
                    </button>
                    <div className="text-[10px] text-slate-400 font-sans">{pe.production_date}</div>
                  </td>
                  <td className="p-3 font-mono font-bold text-slate-700">{pe.job_card_number}</td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{pe.customer_name}</div>
                    <div className="text-slate-600">{pe.part_number} ({pe.part_name})</div>
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900 flex items-center gap-1">
                      <Container className="w-3.5 h-3.5 text-teal-600" />
                      <span>{pe.tank_code}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">{pe.tank_name}</div>
                  </td>
                  <td className="p-3 font-mono font-bold text-slate-900">{pe.planned_qty} {pe.base_unit}</td>
                  <td className="p-3 font-mono">
                    <span className="font-bold text-emerald-700">{pe.processed_qty}</span> / 
                    <span className="text-red-600 ml-1">{pe.rejected_qty}</span> {pe.base_unit}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      pe.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                      pe.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800 border border-blue-200 animate-pulse' :
                      pe.status === 'CANCELLED' ? 'bg-red-100 text-red-800 border border-red-200' :
                      'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}>
                      {pe.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {pe.linked_chemical_issues_count > 0 ? (
                      <span className="px-2 py-0.5 bg-teal-50 text-teal-800 border border-teal-200 rounded text-[10px] font-bold inline-flex items-center gap-1">
                        <FlaskConical className="w-3 h-3 text-teal-600" />
                        {pe.linked_chemical_issues_count} Issue(s)
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[10px]">No Issues</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-600">{pe.operator_name}</td>
                  <td className="p-3 text-right space-x-1.5">
                    {pe.status === 'PLANNED' && (
                      <button
                        onClick={() => handleStartExecution(pe)}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-bold inline-flex items-center gap-1"
                        title="Start running on bath"
                      >
                        <Play className="w-3 h-3" /> Start
                      </button>
                    )}

                    {pe.status === 'IN_PROGRESS' && (
                      <>
                        <button
                          onClick={() => {
                            setChemExec(pe);
                            setChemId(chemicals[0]?.id || '');
                            setChemQty('');
                            setChemRemarks('');
                            setFifoPreview(null);
                            setChemModal(true);
                          }}
                          className="px-2 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 rounded text-[11px] font-bold inline-flex items-center gap-1"
                          title="Issue chemical using existing FIFO engine"
                        >
                          <FlaskConical className="w-3 h-3 text-teal-600" /> Issue Chem
                        </button>

                        <button
                          onClick={() => {
                            setActiveExec(pe);
                            setProcessedQty(pe.processed_qty || '');
                            setRejectedQty(pe.rejected_qty || '0');
                            setActionNotes(pe.notes || '');
                            setActionModal('RECORD');
                          }}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-[11px] font-bold"
                          title="Update intermediate quantity"
                        >
                          Record Qty
                        </button>

                        <button
                          onClick={() => {
                            setActiveExec(pe);
                            setProcessedQty(pe.processed_qty || (pe.planned_qty - (pe.rejected_qty || 0)));
                            setRejectedQty(pe.rejected_qty || '0');
                            setActionNotes(pe.notes || '');
                            setActionModal('COMPLETE');
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold inline-flex items-center gap-1 shadow-sm"
                          title="Finalize & complete production"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Complete
                        </button>
                      </>
                    )}

                    {(isAdmin || isSuperAdmin) && pe.status !== 'CANCELLED' && pe.status !== 'COMPLETED' && (
                      <button
                        onClick={() => {
                          setActiveExec(pe);
                          setCancelReason('');
                          setCancelModal(true);
                        }}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-[11px] font-bold"
                        title="Cancel execution and restore Job Card balance"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredExecutions.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400">
                    No production executions match your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: Create Production Execution */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                <Factory className="w-5 h-5 text-teal-600" />
                Start Production Execution
              </h3>
              <button onClick={() => setCreateModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateExecution} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Job Card *</label>
                <select
                  required
                  value={selectedJobId}
                  onChange={e => {
                    const id = e.target.value;
                    setSelectedJobId(id);
                    const j = eligibleJobs.find(job => job.job_card_id === id);
                    if (j) {
                      setPlannedQty(j.remaining_to_produce);
                      if (j.default_tank_id) setSelectedTankId(j.default_tank_id);
                    }
                  }}
                  className="w-full p-2.5 border rounded-xl text-xs font-semibold"
                >
                  {eligibleJobs.map(j => (
                    <option key={j.job_card_id} value={j.job_card_id}>
                      {j.job_card_number} — {j.customer_name} — {j.part_number} (Rem: {j.remaining_to_produce} {j.base_unit})
                    </option>
                  ))}
                </select>
              </div>

              {selectedJob && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Customer / Part:</span>
                    <span className="font-bold text-slate-900">{selectedJob.customer_name} ({selectedJob.part_number})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Plating Process:</span>
                    <span className="font-bold text-blue-700">{selectedJob.plating_process}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Allocated / Remaining:</span>
                    <span className="font-bold text-teal-800">{selectedJob.allocated_qty} / {selectedJob.remaining_to_produce} {selectedJob.base_unit}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Assign Production Tank *</label>
                <select
                  required
                  value={selectedTankId}
                  onChange={e => setSelectedTankId(e.target.value)}
                  className="w-full p-2.5 border rounded-xl text-xs font-semibold"
                >
                  {activeTanks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.display_name} ({t.capacity_liters} L bath capacity)
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  * Tank capacity represents bath volume, not chemical inventory.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Planned Quantity to Plate *</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  max={selectedJob?.remaining_to_produce || undefined}
                  value={plannedQty}
                  onChange={e => setPlannedQty(e.target.value)}
                  placeholder={`Max: ${selectedJob?.remaining_to_produce || 0}`}
                  className="w-full p-2.5 border rounded-xl text-sm font-mono font-bold"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="start_imm"
                  checked={startImmediately}
                  onChange={e => setStartImmediately(e.target.checked)}
                  className="rounded text-teal-600"
                />
                <label htmlFor="start_imm" className="text-xs font-semibold text-slate-800">
                  Start production immediately (Set status to IN_PROGRESS)
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes / Bath Instructions</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Pre-dip 2 mins, plating current 120A"
                  className="w-full p-2.5 border rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="px-4 py-2 border rounded-xl text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow transition-colors"
                >
                  {submitting ? 'Creating...' : startImmediately ? 'Start Production' : 'Save as Planned'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Record Progress or Complete Production */}
      {actionModal && activeExec && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                {actionModal === 'COMPLETE' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <Factory className="w-5 h-5 text-blue-600" />
                )}
                {actionModal === 'COMPLETE' ? 'Complete Production' : 'Record Production Progress'}
              </h3>
              <button onClick={() => setActionModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordOrComplete} className="space-y-3.5">
              <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
                <div>Execution: <strong className="font-mono">{activeExec.production_number}</strong></div>
                <div>Job Card: <strong className="font-mono">{activeExec.job_card_number}</strong></div>
                <div>Planned Quantity: <strong className="font-mono text-teal-800">{activeExec.planned_qty} {activeExec.base_unit}</strong></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Processed (Finished) Qty *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={processedQty}
                    onChange={e => setProcessedQty(e.target.value)}
                    className="w-full p-2.5 border rounded-xl text-sm font-mono font-bold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Rejected Qty (if any)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={rejectedQty}
                    onChange={e => setRejectedQty(e.target.value)}
                    className="w-full p-2.5 border rounded-xl text-sm font-mono font-bold text-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Remarks / Shift Notes</label>
                <textarea
                  rows={2}
                  value={actionNotes}
                  onChange={e => setActionNotes(e.target.value)}
                  placeholder="Thickness verified on test piece..."
                  className="w-full p-2.5 border rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 border rounded-xl text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-5 py-2 text-white rounded-xl text-xs font-bold shadow transition-colors ${
                    actionModal === 'COMPLETE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {submitting ? 'Saving...' : actionModal === 'COMPLETE' ? 'Confirm Completion' : 'Save Progress'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Issue Chemical via Existing Strict FIFO Engine */}
      {chemModal && chemExec && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-teal-600" />
                  Issue Chemical to Tank (FIFO Engine)
                </h3>
                <p className="text-xs text-slate-500">
                  Strict FIFO algorithm: Oldest eligible lot is consumed first.
                </p>
              </div>
              <button onClick={() => setChemModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleIssueChemical} className="space-y-3.5">
              <div className="p-3 bg-slate-50 border rounded-xl text-xs space-y-1">
                <div>Target Tank: <strong className="font-bold text-teal-800">{chemExec.tank_code} — {chemExec.tank_name}</strong></div>
                <div>Production Ref: <strong className="font-mono">{chemExec.production_number}</strong> (Job Card: {chemExec.job_card_number})</div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Chemical *</label>
                <select
                  required
                  value={chemId}
                  onChange={e => {
                    setChemId(e.target.value);
                    setFifoPreview(null);
                  }}
                  className="w-full p-2.5 border rounded-xl text-xs font-semibold"
                >
                  {chemicals.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code}) — [{c.base_unit}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Required Quantity *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={chemQty}
                    onChange={e => {
                      setChemQty(e.target.value);
                      setFifoPreview(null);
                    }}
                    placeholder="e.g. 25"
                    className="w-full p-2.5 border rounded-xl text-sm font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Shift</label>
                  <select
                    value={chemShift}
                    onChange={e => setChemShift(e.target.value)}
                    className="w-full p-2.5 border rounded-xl text-xs font-semibold"
                  >
                    <option value="Shift 1">Shift 1 (Day)</option>
                    <option value="Shift 2">Shift 2 (Evening)</option>
                    <option value="Shift 3">Shift 3 (Night)</option>
                  </select>
                </div>
              </div>

              {/* FIFO Allocation Preview Trigger */}
              <div className="flex justify-between items-center pt-1">
                <button
                  type="button"
                  onClick={handlePreviewFIFO}
                  disabled={loadingPreview || !chemQty || parseFloat(String(chemQty)) <= 0}
                  className="text-xs text-teal-700 hover:text-teal-900 font-bold underline disabled:opacity-50"
                >
                  {loadingPreview ? 'Calculating FIFO Lots...' : 'Preview FIFO Lots Breakdown'}
                </button>
              </div>

              {/* FIFO Preview Breakdown Container */}
              {fifoPreview && (
                <div className="p-3 bg-teal-50/60 border border-teal-200 rounded-xl space-y-2 text-xs">
                  <div className="font-bold text-teal-950 flex justify-between items-center">
                    <span>FIFO Allocation Preview:</span>
                    <span className={fifoPreview.is_sufficient ? 'text-emerald-700' : 'text-red-700'}>
                      {fifoPreview.is_sufficient ? 'Full Stock Available' : `Shortage: ${fifoPreview.shortage_qty}`}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {fifoPreview.proposed_allocations.map((a: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-[11px] font-mono bg-white p-1.5 rounded border border-teal-100">
                        <span>Lot: <strong>{a.lot_number}</strong> (Recv: {a.received_at?.slice(0, 10)})</span>
                        <span className="font-bold text-teal-800">{a.allocated_qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={chemRemarks}
                  onChange={e => setChemRemarks(e.target.value)}
                  placeholder="Routine bath top-up for run..."
                  className="w-full p-2.5 border rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setChemModal(false)}
                  className="px-4 py-2 border rounded-xl text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={issuingChem}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow transition-colors flex items-center gap-1.5"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  {issuingChem ? 'Posting via FIFO...' : 'Issue via FIFO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Cancel Production Execution */}
      {cancelModal && activeExec && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-red-900 text-lg flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                Cancel Production Execution
              </h3>
              <button onClick={() => setCancelModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCancelExecution} className="space-y-3.5">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs space-y-1 text-red-950">
                <div>Execution: <strong className="font-mono">{activeExec.production_number}</strong></div>
                <div>Job Card: <strong className="font-mono">{activeExec.job_card_number}</strong></div>
                <div className="pt-1">
                  <strong>Effect:</strong> Cancelling will restore <strong>{activeExec.planned_qty} {activeExec.base_unit}</strong> back to the available Job Card balance.
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cancellation Reason *</label>
                <textarea
                  rows={3}
                  required
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="Explain why this run is cancelled..."
                  className="w-full p-2.5 border rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t">
                <button
                  type="button"
                  onClick={() => setCancelModal(false)}
                  className="px-4 py-2 border rounded-xl text-xs font-bold text-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow"
                >
                  {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Details View & Linked Chemical History */}
      {detailModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                  <Factory className="w-5 h-5 text-teal-600" />
                  Production Details: {detailModal.production_number}
                </h3>
                <p className="text-xs text-slate-500">Job Card: {detailModal.job_card_number} — Plating Tank: {detailModal.tank_code}</p>
              </div>
              <button onClick={() => setDetailModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-400 text-[10px]">Planned Qty</div>
                <div className="font-bold text-slate-900 text-sm mt-0.5">{detailModal.planned_qty} {detailModal.base_unit}</div>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="text-emerald-700 text-[10px]">Processed Qty</div>
                <div className="font-bold text-emerald-950 text-sm mt-0.5">{detailModal.processed_qty} {detailModal.base_unit}</div>
              </div>
              <div className="p-2.5 bg-red-50 rounded-xl border border-red-200">
                <div className="text-red-700 text-[10px]">Rejected Qty</div>
                <div className="font-bold text-red-950 text-sm mt-0.5">{detailModal.rejected_qty} {detailModal.base_unit}</div>
              </div>
              <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-200">
                <div className="text-blue-700 text-[10px]">Status</div>
                <div className="font-bold text-blue-950 text-sm mt-0.5">{detailModal.status}</div>
              </div>
            </div>

            {/* Linked Chemical Issues Section */}
            <div className="space-y-2 pt-2 border-t">
              <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                <FlaskConical className="w-4 h-4 text-teal-600" />
                Linked Chemical Issues (Existing FIFO Engine)
              </h4>

              {(!detailModal.linked_chemical_issues || detailModal.linked_chemical_issues.length === 0) ? (
                <div className="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-400">
                  No chemical issues recorded for this production execution yet.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-48">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 font-bold border-b border-slate-200 text-slate-700">
                      <tr>
                        <th className="p-2.5">Issue Number</th>
                        <th className="p-2.5">Chemical</th>
                        <th className="p-2.5">Issued Qty</th>
                        <th className="p-2.5">Issue Date</th>
                        <th className="p-2.5">Issued By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailModal.linked_chemical_issues.map((ci: any) => (
                        <tr key={ci.id}>
                          <td className="p-2.5 font-mono font-bold text-teal-800">{ci.issue_number}</td>
                          <td className="p-2.5 font-semibold text-slate-800">{ci.chemical_name}</td>
                          <td className="p-2.5 font-mono font-bold text-slate-900">{ci.required_qty} {ci.chemical_unit}</td>
                          <td className="p-2.5 text-slate-500">{new Date(ci.issue_date).toLocaleString('en-IN')}</td>
                          <td className="p-2.5 text-slate-600">{ci.issued_by_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setDetailModal(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
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
export default Production;
