import React, { useState, useEffect } from 'react';
import { 
  CalendarClock, Search, Filter, RefreshCw, AlertTriangle, CheckCircle2, 
  Clock, ShieldAlert, ArrowRight, Layers, Factory, ExternalLink, Calendar, 
  X, Check, Flame, ChevronRight, Edit3, Trash2, Eye, User
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface PlanningQueueItem {
  job_card_id: string;
  job_card_number: string;
  job_card_status: string;
  allocated_qty: number;
  completed_production_qty: number;
  remaining_production_qty: number;
  plating_process: string;
  target_thickness_microns: number | null;
  tank_id: string | null;
  tank_code: string | null;
  tank_name: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  order_id: string;
  order_number: string;
  customer_po_number: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  days_until_delivery: number | null;
  delivery_urgency: 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'UPCOMING';
  part_id: string;
  part_number: string;
  part_name: string;
  base_unit: string;
  inward_id: string;
  inward_number: string;
  challan_number: string | null;
  inward_accepted_qty: number;
  inward_rejected_qty: number;
  priority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  is_planned: boolean;
  plan_id: string | null;
  planned_date: string | null;
  planned_start_time: string | null;
  planning_notes: string | null;
  planned_by_user_name: string | null;
  planned_at: string | null;
  planning_status: 'READY' | 'PLANNED' | 'IN_QUEUE' | 'IN_PRODUCTION' | 'COMPLETED' | 'BLOCKED';
  blocking_reason: string | null;
}

interface PlanningSummary {
  total_ready: number;
  total_planned: number;
  total_in_queue: number;
  total_in_production: number;
  total_completed: number;
  total_blocked: number;
  urgent_jobs: number;
  overdue_jobs: number;
  today_planned_jobs: number;
  total_pending_qty: number;
}

interface ProductionPlanningProps {
  onTrace?: (jobCardId: string) => void;
  onNavigateToProduction?: (jobCardId?: string) => void;
}

export const ProductionPlanning: React.FC<ProductionPlanningProps> = ({ 
  onTrace,
  onNavigateToProduction 
}) => {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const canPlan = isAdmin || isSuperAdmin;

  const [queue, setQueue] = useState<PlanningQueueItem[]>([]);
  const [summary, setSummary] = useState<PlanningSummary | null>(null);
  const [tanks, setTanks] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [tankFilter, setTankFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [plannedDateFilter, setPlannedDateFilter] = useState('');
  const [sortBy, setSortBy] = useState('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Plan/Edit Modal State
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<PlanningQueueItem | null>(null);
  const [formPriority, setFormPriority] = useState<'URGENT' | 'HIGH' | 'NORMAL' | 'LOW'>('NORMAL');
  const [formPlannedDate, setFormPlannedDate] = useState('');
  const [formPlannedStartTime, setFormPlannedStartTime] = useState('');
  const [formTankId, setFormTankId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submittingPlan, setSubmittingPlan] = useState(false);

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailedJobData, setDetailedJobData] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    loadData();
    loadMasters();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [queueData, summaryData] = await Promise.all([
        apiFetch<PlanningQueueItem[]>('/production-planning/queue'),
        apiFetch<PlanningSummary>('/production-planning/summary')
      ]);
      setQueue(queueData || []);
      setSummary(summaryData || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load production planning data');
    } finally {
      setLoading(false);
    }
  };

  const loadMasters = async () => {
    try {
      const [tankRes, custRes] = await Promise.all([
        apiFetch<any[]>('/tanks'),
        apiFetch<any[]>('/customers')
      ]);
      setTanks(tankRes || []);
      setCustomers(custRes || []);
    } catch (e) {
      // ignore
    }
  };

  const openPlanModal = (job: PlanningQueueItem) => {
    setSelectedJob(job);
    setFormPriority(job.priority || 'NORMAL');
    setFormPlannedDate(job.planned_date || new Date().toISOString().slice(0, 10));
    setFormPlannedStartTime(job.planned_start_time || '09:00');
    setFormTankId(job.tank_id || '');
    setFormNotes(job.planning_notes || '');
    setPlanModalOpen(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob) return;

    setSubmittingPlan(true);
    try {
      await apiFetch(`/production-planning/${selectedJob.job_card_id}/plan`, {
        method: 'POST',
        body: JSON.stringify({
          priority: formPriority,
          planned_date: formPlannedDate || null,
          planned_start_time: formPlannedStartTime || null,
          planning_notes: formNotes || null,
          tank_id: formTankId || undefined
        })
      });
      setPlanModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to save planning schedule');
    } finally {
      setSubmittingPlan(false);
    }
  };

  const handleUnplan = async (jobCardId: string) => {
    if (!window.confirm('Are you sure you want to remove this planning schedule?')) {
      return;
    }
    try {
      await apiFetch(`/production-planning/${jobCardId}/unplan`, {
        method: 'POST'
      });
      setPlanModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to remove plan');
    }
  };

  const openDetailModal = async (jobCardId: string) => {
    setLoadingDetails(true);
    setDetailModalOpen(true);
    try {
      const data = await apiFetch(`/production-planning/${jobCardId}`);
      setDetailedJobData(data);
    } catch (err: any) {
      alert(err.message || 'Failed to load job card details');
      setDetailModalOpen(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Filter queue in-memory for instant responsive feedback
  const filteredQueue = queue.filter(item => {
    if (statusFilter && item.planning_status !== statusFilter) return false;
    if (priorityFilter && item.priority !== priorityFilter) return false;
    if (urgencyFilter && item.delivery_urgency !== urgencyFilter) return false;
    if (tankFilter && item.tank_id !== tankFilter) return false;
    if (customerFilter && item.customer_id !== customerFilter) return false;
    if (plannedDateFilter && item.planned_date !== plannedDateFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const match =
        item.job_card_number.toLowerCase().includes(q) ||
        item.order_number.toLowerCase().includes(q) ||
        (item.customer_po_number && item.customer_po_number.toLowerCase().includes(q)) ||
        item.customer_name.toLowerCase().includes(q) ||
        item.part_number.toLowerCase().includes(q) ||
        item.plating_process.toLowerCase().includes(q) ||
        (item.challan_number && item.challan_number.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-rose-100 text-rose-800 border-rose-300 font-black';
      case 'HIGH':
        return 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
      case 'LOW':
        return 'bg-slate-100 text-slate-700 border-slate-300 font-semibold';
      case 'NORMAL':
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300 font-semibold';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'IN_PRODUCTION':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'IN_QUEUE':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'PLANNED':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'READY':
        return 'bg-teal-100 text-teal-800 border-teal-300';
      case 'COMPLETED':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'BLOCKED':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  const getUrgencyBadge = (urgency: string, days: number | null) => {
    switch (urgency) {
      case 'OVERDUE':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>Overdue ({Math.abs(days || 0)}d)</span>
          </span>
        );
      case 'DUE_TODAY':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            <span>Due Today</span>
          </span>
        );
      case 'DUE_SOON':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
            <Clock className="w-3 h-3 text-orange-600" />
            <span>Due in {days}d</span>
          </span>
        );
      case 'UPCOMING':
      default:
        return (
          <span className="text-[11px] font-medium text-slate-500">
            {days != null ? `In ${days}d` : 'No Target Date'}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2.5 bg-teal-50 text-teal-600 rounded-xl">
              <CalendarClock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">Production Planning & Factory Workboard</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Operational queue management: <b>Order → Inward → Job Card → Production Readiness → Tank Scheduling</b>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Workboard</span>
          </button>
        </div>
      </div>

      {/* Top KPI Cards (Factory Workboard Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ready to Plan</div>
          <div className="text-xl font-black text-teal-600 mt-1">{summary?.total_ready ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Awaiting schedule</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Planned Today</div>
          <div className="text-xl font-black text-blue-600 mt-1">{summary?.today_planned_jobs ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Target: today</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">In Queue</div>
          <div className="text-xl font-black text-purple-600 mt-1">{summary?.total_in_queue ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Batches queued</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">In Production</div>
          <div className="text-xl font-black text-amber-600 mt-1">{summary?.total_in_production ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Currently plating</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Urgent Jobs</div>
          <div className="text-xl font-black text-rose-600 mt-1">{summary?.urgent_jobs ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Top priority</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overdue Delivery</div>
          <div className="text-xl font-black text-rose-700 mt-1">{summary?.overdue_jobs ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Past deadline</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pending Plating</div>
          <div className="text-xl font-black text-slate-900 mt-1">{summary?.total_pending_qty.toLocaleString() ?? 0}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Total pcs</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search Input */}
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search Job Card #, Order #, PO #, Customer, Part..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
            >
              <option value="">All Statuses</option>
              <option value="READY">Ready</option>
              <option value="PLANNED">Planned</option>
              <option value="IN_QUEUE">In Queue</option>
              <option value="IN_PRODUCTION">In Production</option>
              <option value="BLOCKED">Blocked</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
            >
              <option value="">All Priorities</option>
              <option value="URGENT">Urgent</option>
              <option value="HIGH">High</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          {/* Delivery Urgency Filter */}
          <div>
            <select
              value={urgencyFilter}
              onChange={e => setUrgencyFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
            >
              <option value="">All Deliveries</option>
              <option value="OVERDUE">Overdue</option>
              <option value="DUE_TODAY">Due Today</option>
              <option value="DUE_SOON">Due Soon (1-3d)</option>
              <option value="UPCOMING">Upcoming (&gt;3d)</option>
            </select>
          </div>

          {/* Tank Filter */}
          <div>
            <select
              value={tankFilter}
              onChange={e => setTankFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
            >
              <option value="">All Tanks</option>
              {tanks.map(t => (
                <option key={t.id} value={t.id}>{t.code} - {t.display_name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Date Presets / Clear Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600 text-[11px]">Quick Date:</span>
            <button
              onClick={() => setPlannedDateFilter(new Date().toISOString().slice(0, 10))}
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                plannedDateFilter === new Date().toISOString().slice(0, 10)
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Planned Today
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                setPlannedDateFilter(d.toISOString().slice(0, 10));
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                plannedDateFilter && plannedDateFilter !== new Date().toISOString().slice(0, 10)
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Tomorrow
            </button>
            {plannedDateFilter && (
              <button
                onClick={() => setPlannedDateFilter('')}
                className="text-[11px] text-teal-600 hover:underline font-bold ml-1"
              >
                Clear Date
              </button>
            )}
          </div>

          <div>
            Showing <strong className="text-slate-800">{filteredQueue.length}</strong> of {queue.length} jobs in queue
          </div>
        </div>
      </div>

      {/* Main Factory Workboard Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold text-[10px] uppercase tracking-wider">
                <th className="py-3 px-3 text-center">Priority</th>
                <th className="py-3 px-3">Job Card #</th>
                <th className="py-3 px-3">Customer &amp; Order</th>
                <th className="py-3 px-3">Part Description</th>
                <th className="py-3 px-3">Coating Process</th>
                <th className="py-3 px-3 text-right">Job Qty</th>
                <th className="py-3 px-3 text-right">Remaining</th>
                <th className="py-3 px-3">Assigned Tank</th>
                <th className="py-3 px-3">Planned Schedule</th>
                <th className="py-3 px-3">Delivery Target</th>
                <th className="py-3 px-3 text-center">Workboard Status</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
                    <span>Loading factory workboard queue...</span>
                  </td>
                </tr>
              ) : filteredQueue.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    No Job Cards found matching current queue filters.
                  </td>
                </tr>
              ) : (
                filteredQueue.map((job) => (
                  <tr key={job.job_card_id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Priority */}
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] border ${getPriorityBadge(job.priority)}`}>
                        {job.priority}
                      </span>
                    </td>

                    {/* Job Card # */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 flex items-center gap-1">
                        <span>{job.job_card_number}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        Inward: {job.inward_number}
                      </div>
                    </td>

                    {/* Customer & Order */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{job.customer_name}</div>
                      <div className="text-[11px] text-slate-500">
                        Ord: {job.order_number} {job.customer_po_number && `(PO: ${job.customer_po_number})`}
                      </div>
                    </td>

                    {/* Part */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{job.part_number}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[140px]">{job.part_name}</div>
                    </td>

                    {/* Process */}
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[10px]">
                        {job.plating_process}
                      </span>
                      {job.target_thickness_microns && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {job.target_thickness_microns} µm
                        </div>
                      )}
                    </td>

                    {/* Qty */}
                    <td className="py-3 px-3 text-right font-medium text-slate-600">
                      {job.allocated_qty.toLocaleString()} {job.base_unit}
                    </td>

                    {/* Remaining */}
                    <td className="py-3 px-3 text-right font-black text-slate-900">
                      <span className={job.remaining_production_qty > 0 ? 'text-teal-700' : 'text-slate-400'}>
                        {job.remaining_production_qty.toLocaleString()} {job.base_unit}
                      </span>
                    </td>

                    {/* Tank */}
                    <td className="py-3 px-3">
                      {job.tank_code ? (
                        <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold text-[10px] border border-purple-200">
                          {job.tank_code}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">Unassigned</span>
                      )}
                    </td>

                    {/* Planned Schedule */}
                    <td className="py-3 px-3">
                      {job.planned_date ? (
                        <div>
                          <div className="font-bold text-slate-800 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-teal-600" />
                            <span>{new Date(job.planned_date).toLocaleDateString()}</span>
                          </div>
                          {job.planned_start_time && (
                            <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{job.planned_start_time}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">Not scheduled</span>
                      )}
                    </td>

                    {/* Delivery Urgency */}
                    <td className="py-3 px-3">
                      <div>
                        {getUrgencyBadge(job.delivery_urgency, job.days_until_delivery)}
                      </div>
                      {job.expected_delivery_date && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(job.expected_delivery_date).toLocaleDateString()}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(job.planning_status)}`}>
                        {job.planning_status.replace(/_/g, ' ')}
                      </span>
                      {job.blocking_reason && (
                        <div className="text-[9px] text-rose-600 mt-0.5 font-medium leading-tight max-w-[110px] mx-auto" title={job.blocking_reason}>
                          {job.blocking_reason}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {canPlan && job.planning_status !== 'COMPLETED' && job.job_card_status !== 'CANCELLED' && (
                          <button
                            onClick={() => openPlanModal(job)}
                            className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs"
                            title="Schedule / Edit Plan"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => openDetailModal(job.job_card_id)}
                          className="p-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs"
                          title="View Job Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {onTrace && (
                          <button
                            onClick={() => onTrace(job.job_card_id)}
                            className="p-1 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-lg text-xs"
                            title="Open Traceability Chain"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
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

      {/* ================= MODAL: PLAN / SCHEDULE JOB CARD ================= */}
      {planModalOpen && selectedJob && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Plan Production Schedule
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Job Card: <strong>{selectedJob.job_card_number}</strong> ({selectedJob.part_number})
                </p>
              </div>
              <button onClick={() => setPlanModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4 mt-4 text-xs">
              {/* Priority */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Planning Priority
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['NORMAL', 'HIGH', 'URGENT', 'LOW'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFormPriority(p)}
                      className={`py-1.5 text-xs font-bold rounded-lg border text-center transition-all ${
                        formPriority === p
                          ? 'border-teal-600 bg-teal-50 text-teal-800 ring-2 ring-teal-500/20'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Planned Date & Start Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                    Planned Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formPlannedDate}
                    onChange={e => setFormPlannedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                    Planned Start Time
                  </label>
                  <input
                    type="time"
                    value={formPlannedStartTime}
                    onChange={e => setFormPlannedStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium text-xs"
                  />
                </div>
              </div>

              {/* Plating Tank Reference */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Designated Plating Tank / Bath
                </label>
                <select
                  value={formTankId}
                  onChange={e => setFormTankId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium text-xs"
                >
                  <option value="">Keep current / Unassigned</option>
                  {tanks.map(t => (
                    <option key={t.id} value={t.id}>{t.code} - {t.display_name}</option>
                  ))}
                </select>
              </div>

              {/* Planning Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Planning Notes
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="e.g. Schedule after cyanide bath replenish, priority TVS line..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium text-xs"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                {selectedJob.is_planned && (
                  <button
                    type="button"
                    onClick={() => handleUnplan(selectedJob.job_card_id)}
                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Plan</span>
                  </button>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setPlanModalOpen(false)}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingPlan}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-sm"
                  >
                    {submittingPlan ? 'Saving...' : 'Save Plan'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: JOB CARD PLANNING DETAILS ================= */}
      {detailModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
            {loadingDetails || !detailedJobData ? (
              <div className="py-12 text-center text-slate-400">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
                <span>Loading job card details...</span>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-black text-slate-900">
                      Job Card Details: {detailedJobData.job_card.job_card_number}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Status: <strong>{detailedJobData.job_card.status}</strong> • Planning: <strong>{detailedJobData.planning.planning_status}</strong>
                    </p>
                  </div>
                  <button onClick={() => setDetailModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* 4-Box Grid (Order, Inward, Job Card, Planning) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  {/* Order Box */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Customer Order
                    </div>
                    <div className="space-y-1">
                      <div>Customer: <strong>{detailedJobData.customer.name}</strong> ({detailedJobData.customer.code})</div>
                      <div>Order #: <strong>{detailedJobData.order.order_number}</strong></div>
                      <div>PO Ref: <strong>{detailedJobData.order.customer_po_number || 'N/A'}</strong></div>
                      <div>Target Delivery: <strong>{detailedJobData.order.expected_delivery_date || 'N/A'}</strong></div>
                    </div>
                  </div>

                  {/* Inward Box */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Parts Inward Source
                    </div>
                    <div className="space-y-1">
                      <div>Inward #: <strong>{detailedJobData.inward.inward_number}</strong></div>
                      <div>Challan #: <strong>{detailedJobData.inward.challan_number || 'N/A'}</strong></div>
                      <div>Accepted Qty: <strong className="text-emerald-600">{detailedJobData.inward.accepted_qty} pcs</strong></div>
                      <div>Rejected Qty: <strong className="text-rose-600">{detailedJobData.inward.rejected_qty} pcs</strong></div>
                    </div>
                  </div>

                  {/* Job Card Box */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Job Card Specs
                    </div>
                    <div className="space-y-1">
                      <div>Part: <strong>{detailedJobData.part.part_number}</strong> ({detailedJobData.part.part_name})</div>
                      <div>Process: <strong>{detailedJobData.job_card.plating_process}</strong></div>
                      <div>Allocated Qty: <strong>{detailedJobData.job_card.allocated_qty} {detailedJobData.part.base_unit}</strong></div>
                      <div>Remaining to Plate: <strong className="text-teal-700">{detailedJobData.production_metrics.remaining_production_qty} pcs</strong></div>
                    </div>
                  </div>

                  {/* Planning Box */}
                  <div className="p-3.5 rounded-xl bg-teal-50/50 border border-teal-200">
                    <div className="text-[10px] font-bold text-teal-700 uppercase tracking-wider mb-2">
                      Workboard Schedule
                    </div>
                    <div className="space-y-1">
                      <div>Priority: <strong className="text-teal-900">{detailedJobData.planning.priority}</strong></div>
                      <div>Planned Date: <strong>{detailedJobData.planning.planned_date || 'Not scheduled'}</strong></div>
                      <div>Assigned Tank: <strong>{detailedJobData.job_card.tank_name}</strong></div>
                      <div>Notes: <em>{detailedJobData.planning.planning_notes || 'None'}</em></div>
                    </div>
                  </div>
                </div>

                {/* Existing Production Executions */}
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                    Actual Production Executions ({detailedJobData.production_executions.length})
                  </h4>
                  {detailedJobData.production_executions.length === 0 ? (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-400 text-center">
                      No production runs executed yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {detailedJobData.production_executions.map((p: any) => (
                        <div key={p.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex justify-between items-center">
                          <div>
                            <span className="font-bold text-slate-900">{p.production_number}</span>
                            <span className="text-slate-500 ml-2">Date: {new Date(p.production_date).toLocaleDateString()}</span>
                            <span className="text-slate-500 ml-2">Operator: {p.operator_name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-amber-700">{p.processed_qty} pcs</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                              {p.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  {onTrace && (
                    <button
                      onClick={() => {
                        setDetailModalOpen(false);
                        onTrace(detailedJobData.job_card.id);
                      }}
                      className="px-3.5 py-2 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Task 29 Traceability</span>
                    </button>
                  )}

                  <button
                    onClick={() => setDetailModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold ml-auto"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionPlanning;
