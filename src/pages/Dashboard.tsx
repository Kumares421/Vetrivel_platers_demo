import React, { useState, useEffect } from 'react';
import { 
  FlaskConical, AlertTriangle, Clock, ArrowDownToLine, 
  ArrowUpFromLine, Boxes, FileSpreadsheet, ArrowRight, ShieldCheck,
  ShoppingCart, PackageCheck, Layers, FileText, CheckCircle2, RefreshCw
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { QuantityBadge } from '../components/QuantityBadge';
import { StatusBadge } from '../components/StatusBadge';

interface DashboardProps {
  onNavigate: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Real ERP Metrics from backend
  const [activeChemicalsCount, setActiveChemicalsCount] = useState(0);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [expiringLots, setExpiringLots] = useState<any[]>([]);
  
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [awaitingJobAllocCount, setAwaitingJobAllocCount] = useState(0);
  const [jobsReadyCount, setJobsReadyCount] = useState(0);
  
  const [todayChemicalReceiptsCount, setTodayChemicalReceiptsCount] = useState(0);
  const [todayChemicalReceiptsByUnit, setTodayChemicalReceiptsByUnit] = useState<Record<string, number>>({});
  const [todayChemicalIssuesCount, setTodayChemicalIssuesCount] = useState(0);
  const [todayChemicalIssuesByUnit, setTodayChemicalIssuesByUnit] = useState<Record<string, number>>({});
  
  const [recentChemicalReceipts, setRecentChemicalReceipts] = useState<any[]>([]);
  const [recentCustomerInwards, setRecentCustomerInwards] = useState<any[]>([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError('');
    try {
      const [chemList, alerts, stats] = await Promise.all([
        apiFetch<any[]>('/chemicals'),
        apiFetch<any>('/reports/low-stock-expiry'),
        apiFetch<any>('/reports/dashboard-stats')
      ]);

      const activeChems = chemList.filter(c => c.is_active);
      setActiveChemicalsCount(activeChems.length);

      const low = alerts.low_stock_chemicals || alerts.low_stock_items || [];
      setLowStockItems(low);
      setExpiringLots(alerts.expiring_lots || []);

      setActiveOrdersCount(stats.active_customer_orders_count || 0);
      setAwaitingJobAllocCount(stats.parts_awaiting_job_allocation_count || 0);
      setJobsReadyCount(stats.jobs_ready_for_production_count || 0);

      setTodayChemicalReceiptsCount(stats.today_chemical_receipts_count || 0);
      setTodayChemicalReceiptsByUnit(stats.today_chemical_receipts_by_unit || {});
      setTodayChemicalIssuesCount(stats.today_chemical_issues_count || 0);
      setTodayChemicalIssuesByUnit(stats.today_chemical_issues_by_unit || {});

      setRecentChemicalReceipts(stats.recent_chemical_receipts || []);
      setRecentCustomerInwards(stats.recent_customer_inwards || []);
    } catch (err: any) {
      console.error('Failed to load dashboard:', err);
      setError(err.message || 'Failed to load live ERP metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  return (
    <div className="space-y-6">
      
      {/* Factory Banner */}
      <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 bg-teal-500/20 text-teal-300 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
            Integrated Plating & Stores ERP
          </span>
          <h2 className="text-2xl font-bold text-white">Vetrivel Platers - Operations & Chemical Stores</h2>
          <p className="text-slate-300 text-sm mt-1">
            Customer Orders → Parts Inward → Job Card Allocation → Strict FIFO Chemical Issue Engine.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-slate-800/90 px-4 py-3 rounded-xl border border-slate-700">
          <ShieldCheck className="w-7 h-7 text-teal-400 shrink-0" />
          <div className="text-xs">
            <div className="font-bold text-slate-200">Strict FIFO Allocation Enforced</div>
            <div className="text-slate-400">Atomic Stock Ledger & Lot Tracking</div>
          </div>
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
            onClick={fetchDashboardData}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs"
          >
            Retry Dashboard
          </button>
        </div>
      )}

      {/* Large Action Buttons for Factory Floor */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => onNavigate('parts-inward')}
          className="p-4 bg-white border border-slate-200 hover:border-teal-500 rounded-2xl shadow-sm flex flex-col gap-2 hover:shadow-md transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-700 group-hover:bg-teal-600 group-hover:text-white transition-colors">
            <PackageCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm">Customer Parts Inward</div>
            <div className="text-slate-500 text-xs">Verify DC & receive parts</div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('job-cards')}
          className="p-4 bg-white border border-slate-200 hover:border-blue-500 rounded-2xl shadow-sm flex flex-col gap-2 hover:shadow-md transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm">Allocate Job Card</div>
            <div className="text-slate-500 text-xs">Release batch to tank</div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('receive')}
          className="p-4 bg-white border border-slate-200 hover:border-teal-500 rounded-2xl shadow-sm flex flex-col gap-2 hover:shadow-md transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-700 group-hover:bg-teal-600 group-hover:text-white transition-colors">
            <ArrowDownToLine className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm">Receive Chemicals</div>
            <div className="text-slate-500 text-xs">Inward batch lot into stores</div>
          </div>
        </button>

        <button
          onClick={() => onNavigate('issue')}
          className="p-4 bg-white border border-slate-200 hover:border-purple-500 rounded-2xl shadow-sm flex flex-col gap-2 hover:shadow-md transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-700 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <ArrowUpFromLine className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm">Issue Chemical (FIFO)</div>
            <div className="text-slate-500 text-xs">Dispense oldest lot to tank</div>
          </div>
        </button>
      </div>

      {/* Key Real Production ERP Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* Metric 1: Customer Orders */}
        <div 
          onClick={() => onNavigate('customer-orders')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-teal-500 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
            <span>Customer Orders</span>
            <ShoppingCart className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{activeOrdersCount}</span>
            <span className="text-xs text-teal-600 font-bold">In Production / Active</span>
          </div>
        </div>

        {/* Metric 2: Parts Awaiting Job Allocation */}
        <div 
          onClick={() => onNavigate('parts-inward')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-amber-500 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
            <span>Parts Awaiting Allocation</span>
            <PackageCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{awaitingJobAllocCount}</span>
            <span className="text-xs text-amber-600 font-bold">Unallocated Inward Lots</span>
          </div>
        </div>

        {/* Metric 3: Jobs Ready for Production */}
        <div 
          onClick={() => onNavigate('job-cards')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-blue-500 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
            <span>Jobs Ready for Production</span>
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{jobsReadyCount}</span>
            <span className="text-xs text-blue-600 font-bold">Released Job Cards</span>
          </div>
        </div>

        {/* Metric 4: Today's Chemical Receipts */}
        <div 
          onClick={() => onNavigate('receive')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-teal-500 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
            <span>Today's Chemical Receipts</span>
            <ArrowDownToLine className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-teal-800">{todayChemicalReceiptsCount}</span>
            <span className="text-xs text-slate-500">
              {Object.keys(todayChemicalReceiptsByUnit).length > 0 
                ? Object.entries(todayChemicalReceiptsByUnit).map(([u, q]) => `${q} ${u}`).join(', ')
                : '0 kg received today'}
            </span>
          </div>
        </div>

        {/* Metric 5: Today's Chemical Issues */}
        <div 
          onClick={() => onNavigate('issue')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:border-purple-500 transition-colors"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase">
            <span>Today's Chemical Issues</span>
            <ArrowUpFromLine className="w-4 h-4 text-purple-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-purple-800">{todayChemicalIssuesCount}</span>
            <span className="text-xs text-slate-500">
              {Object.keys(todayChemicalIssuesByUnit).length > 0 
                ? Object.entries(todayChemicalIssuesByUnit).map(([u, q]) => `${q} ${u}`).join(', ')
                : '0 kg issued today'}
            </span>
          </div>
        </div>

      </div>

      {/* Safety Stock & Expiry Critical Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Low Stock Alerts */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Chemical Safety Stock Alerts
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
              {lowStockItems.length} Below Min Stock
            </span>
          </div>

          {lowStockItems.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm bg-slate-50 rounded-xl">
              All chemicals are currently at or above minimum safety levels.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {lowStockItems.slice(0, 4).map(item => (
                <div key={item.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{item.code}</div>
                    <div className="text-slate-500 text-xs">{item.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-amber-700 font-bold font-mono text-sm">
                      <QuantityBadge value={item.total_available} unit={item.base_unit} />
                    </div>
                    <div className="text-slate-400 text-[11px]">
                      Min: <QuantityBadge value={item.min_stock_level} unit={item.base_unit} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-slate-100 text-right">
            <button
              onClick={() => onNavigate('reports')}
              className="text-xs font-bold text-teal-700 hover:text-teal-900 flex items-center gap-1 ml-auto"
            >
              View Full Stock Ledgers & Alerts <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Expiry Alerts */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-red-600" />
              Lot Expiry Alerts (30 Days / Expired)
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
              {expiringLots.length} Lots
            </span>
          </div>

          {expiringLots.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm bg-slate-50 rounded-xl">
              No lots expiring within the next 30 days.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {expiringLots.slice(0, 4).map(lot => (
                <div key={lot.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <span className="font-mono text-red-700">{lot.lot_number}</span>
                      {lot.is_expired ? (
                        <span className="px-1.5 py-0.2 bg-red-100 text-red-800 text-[10px] font-bold rounded">EXPIRED</span>
                      ) : (
                        <span className="px-1.5 py-0.2 bg-orange-100 text-orange-800 text-[10px] font-bold rounded">EXPIRING</span>
                      )}
                    </div>
                    <div className="text-slate-500 text-xs">{lot.chemical_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-red-700 font-bold font-mono text-sm">{lot.expiry_date}</div>
                    <div className="text-slate-400 text-[11px]">
                      Balance: <QuantityBadge value={lot.remaining_qty} unit={lot.base_unit} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-slate-100 text-right">
            <button
              onClick={() => onNavigate('reports')}
              className="text-xs font-bold text-teal-700 hover:text-teal-900 flex items-center gap-1 ml-auto"
            >
              View Expiry Register <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Dual Activity Registers: Recent Chemical Receipts vs Recent Customer Parts Inwards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Recent Chemical Receipts (Unambiguous Label) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-teal-700" />
              Recent Chemical Receipts
            </h3>
            <button
              onClick={() => onNavigate('reports')}
              className="text-xs text-teal-700 font-bold hover:underline"
            >
              View Inward Register
            </button>
          </div>

          {recentChemicalReceipts.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm bg-slate-50 rounded-xl">
              No recent chemical receipts posted.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs font-medium">
              {recentChemicalReceipts.map(r => (
                <div key={r.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 font-mono">{r.receipt_number}</div>
                    <div className="text-slate-500">Supplier: {r.supplier_name} | Bill: {r.bill_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-600 font-bold">{r.actual_received_at?.slice(0, 10)}</div>
                    <div className="text-teal-700 font-semibold">{r.line_count} Chemical Lot(s)</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Customer Parts Inwards */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-blue-700" />
              Recent Customer Parts Inward
            </h3>
            <button
              onClick={() => onNavigate('parts-inward')}
              className="text-xs text-blue-700 font-bold hover:underline"
            >
              View Inward Register
            </button>
          </div>

          {recentCustomerInwards.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm bg-slate-50 rounded-xl">
              No recent customer parts inwards recorded.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs font-medium">
              {recentCustomerInwards.map(inw => (
                <div key={inw.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 font-mono">{inw.inward_number}</div>
                    <div className="text-slate-500">{inw.customer_name} — {inw.part_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-900 font-mono font-black">{inw.accepted_qty} {inw.base_unit || 'nos'}</div>
                    <div className="text-slate-400 text-[11px]">DC: {inw.challan_number}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
