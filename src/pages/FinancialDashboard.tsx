import React, { useState, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, DollarSign, CreditCard, Percent, 
  Calendar, Search, Download, Printer, Filter, Building2, 
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight,
  Factory, ShieldCheck, Truck, Receipt, Layers, RefreshCw
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface SummaryData {
  as_of_date: string;
  revenue: {
    total_invoiced_value: number;
    current_month_revenue: number;
    previous_month_revenue: number;
    revenue_growth_pct: number;
    invoice_count: number;
    average_invoice_value: number;
  };
  receivables: {
    total_outstanding: number;
    current_outstanding: number;
    overdue_outstanding: number;
    outstanding_invoice_count: number;
    buckets: {
      current: number;
      days_1_30: number;
      days_31_60: number;
      days_61_90: number;
      days_90_plus: number;
    };
  };
  collections: {
    total_payments_received: number;
    current_month_collections: number;
    previous_month_collections: number;
    collection_rate_pct: number;
    unallocated_payment_amount: number;
    cancelled_payment_count: number;
  };
  gst: {
    taxable_value: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_gst: number;
  };
  operational: {
    production_count: number;
    qc_passed_count: number;
    qc_failed_count: number;
    dispatch_count: number;
    invoiced_count: number;
    payment_received_count: number;
  };
}

interface MonthlyRow {
  month: string;
  invoiced_amount: number;
  payment_received: number;
  gst_amount: number;
  outstanding_created: number;
  invoice_count: number;
  payment_count: number;
}

interface CustomerPerfRow {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_gstin: string;
  invoice_count: number;
  invoiced_value: number;
  paid_value: number;
  outstanding_value: number;
  overdue_value: number;
  collection_percentage: number;
}

interface OperationalSummaryData {
  production: {
    executions_count: number;
    planned_qty: number;
    processed_qty: number;
  };
  quality_control: {
    inspections_count: number;
    passed_count: number;
    failed_count: number;
    pass_rate_pct: number;
    inspected_qty: number;
    accepted_qty: number;
    rejected_qty: number;
  };
  dispatch: {
    dispatch_count: number;
    dispatched_qty: number;
  };
  billing: {
    invoiced_count: number;
    taxable_value: number;
    invoiced_amount: number;
  };
  collections: {
    payment_count: number;
    collected_amount: number;
  };
}

export const FinancialDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'revenue' | 'receivables' | 'collections' | 'monthly' | 'customers' | 'operational'>('overview');

  // Filters
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [minOutstanding, setMinOutstanding] = useState<string>('');

  // States
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyRow[]>([]);
  const [customerData, setCustomerData] = useState<CustomerPerfRow[]>([]);
  const [revenueData, setRevenueData] = useState<any>(null);
  const [receivablesData, setReceivablesData] = useState<any>(null);
  const [paymentsData, setPaymentsData] = useState<any>(null);
  const [operationalData, setOperationalData] = useState<OperationalSummaryData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (asOfDate) params.append('as_of_date', asOfDate);
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (searchQuery) params.append('search', searchQuery);
      if (minOutstanding) params.append('min_outstanding', minOutstanding);

      const [sumRes, monRes, custRes, revRes, recRes, payRes, opRes] = await Promise.all([
        apiFetch(`/api/financial-dashboard/summary?${params.toString()}`),
        apiFetch(`/api/financial-dashboard/monthly?${params.toString()}`),
        apiFetch(`/api/financial-dashboard/customer-performance?${params.toString()}`),
        apiFetch(`/api/financial-dashboard/revenue?${params.toString()}`),
        apiFetch(`/api/financial-dashboard/receivables?${params.toString()}`),
        apiFetch(`/api/financial-dashboard/payments?${params.toString()}`),
        apiFetch(`/api/financial-dashboard/operational-summary?${params.toString()}`)
      ]);

      setSummary(sumRes);
      setMonthlyData(monRes);
      setCustomerData(custRes);
      setRevenueData(revRes);
      setReceivablesData(recRes);
      setPaymentsData(payRes);
      setOperationalData(opRes);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch financial MIS data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [asOfDate, fromDate, toDate, minOutstanding]);

  // Handle Enter on Search
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAllData();
  };

  // CSV Exporters
  const exportMonthlyCSV = () => {
    if (!monthlyData.length) return;
    const header = `"Month","Invoiced Amount (INR)","Collections (INR)","GST (INR)","Net Balance Created (INR)","Invoices","Payments"`;
    const rows = monthlyData.map(r => 
      `"${r.month}","${r.invoiced_amount.toFixed(2)}","${r.payment_received.toFixed(2)}","${r.gst_amount.toFixed(2)}","${r.outstanding_created.toFixed(2)}","${r.invoice_count}","${r.payment_count}"`
    );
    downloadCSV([header, ...rows].join('\n'), `financial_monthly_mis_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const exportCustomerCSV = () => {
    if (!customerData.length) return;
    const header = `"Customer Code","Customer Name","GSTIN","Invoices","Invoiced (INR)","Paid (INR)","Outstanding (INR)","Overdue (INR)","Collection %"`;
    const rows = customerData.map(c => 
      `"${c.customer_code}","${c.customer_name.replace(/"/g, '""')}","${c.customer_gstin}","${c.invoice_count}","${c.invoiced_value.toFixed(2)}","${c.paid_value.toFixed(2)}","${c.outstanding_value.toFixed(2)}","${c.overdue_value.toFixed(2)}","${c.collection_percentage.toFixed(1)}%"`
    );
    downloadCSV([header, ...rows].join('\n'), `customer_performance_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const exportReceivablesCSV = () => {
    if (!receivablesData?.invoices?.length) return;
    const header = `"Invoice #","Date","Customer Code","Customer Name","Invoice Total (INR)","Paid (INR)","Outstanding (INR)","Days Old","Ageing Bucket","Status"`;
    const rows = receivablesData.invoices.map((inv: any) => 
      `"${inv.invoice_number}","${inv.invoice_date}","${inv.customer_code}","${inv.customer_name.replace(/"/g, '""')}","${inv.total_amount.toFixed(2)}","${inv.paid_amount.toFixed(2)}","${inv.outstanding_amount.toFixed(2)}","${inv.days_old}","${inv.ageing_bucket}","${inv.is_overdue ? 'OVERDUE' : 'CURRENT'}"`
    );
    downloadCSV([header, ...rows].join('\n'), `receivables_ageing_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-teal-600" />
            <h1 className="text-xl font-bold text-slate-900">Financial MIS & Management Dashboard</h1>
            <span className="bg-teal-50 text-teal-700 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-teal-200">
              Live MIS Layer
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Consolidated operational & financial performance metrics across Revenue, Receivables, Collections, GST, and Factory Throughput.
          </p>
        </div>

        {/* Global Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={fetchAllData}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Refresh Live Data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={handlePrint}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print MIS</span>
          </button>
        </div>
      </div>

      {/* Date & Filter Ribbon */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm print:hidden">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">As of Date</label>
            <div className="relative">
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Customer / Text Search</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search name, code, GSTIN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Apply Filters</span>
            </button>
            {(fromDate || toDate || searchQuery || minOutstanding) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setSearchQuery('');
                  setMinOutstanding('');
                }}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold"
              >
                Reset
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && !summary ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center">
          <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-slate-600 font-semibold">Consolidating live Financial MIS metrics...</p>
        </div>
      ) : summary ? (
        <>
          {/* Executive KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Invoiced Revenue */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Revenue</span>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg"><DollarSign className="w-4 h-4" /></span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900">₹{summary.revenue.total_invoiced_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
                <span>{summary.revenue.invoice_count} Invoices</span>
                <span className="font-semibold text-slate-700">Avg ₹{summary.revenue.average_invoice_value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>

            {/* Current vs Prev Month Growth */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Monthly Revenue Trend</span>
                <span className={`p-2 rounded-lg ${summary.revenue.revenue_growth_pct >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {summary.revenue.revenue_growth_pct >= 0 ? <TrendingUp className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900">₹{summary.revenue.current_month_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex items-center ${summary.revenue.revenue_growth_pct >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {summary.revenue.revenue_growth_pct >= 0 ? '+' : ''}{summary.revenue.revenue_growth_pct}%
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
                <span>Prev Month:</span>
                <span className="font-semibold text-slate-700">₹{summary.revenue.previous_month_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Total Receivables & Overdue */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Outstanding</span>
                <span className="p-2 bg-amber-50 text-amber-600 rounded-lg"><Receipt className="w-4 h-4" /></span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-amber-600">₹{summary.receivables.total_outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
                <span>Overdue ({summary.receivables.outstanding_invoice_count} inv):</span>
                <span className="font-bold text-rose-600">₹{summary.receivables.overdue_outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Collections & Efficiency */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Collections</span>
                <span className="p-2 bg-teal-50 text-teal-600 rounded-lg"><CreditCard className="w-4 h-4" /></span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-teal-700">₹{summary.collections.total_payments_received.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                <span className="text-xs font-bold text-teal-800 bg-teal-100 px-1.5 py-0.5 rounded">
                  {summary.collections.collection_rate_pct.toFixed(1)}% Rate
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
                <span>Unallocated:</span>
                <span className="font-semibold text-slate-700">₹{summary.collections.unallocated_payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="bg-white border-b border-slate-200 rounded-t-xl px-4 flex items-center space-x-2 overflow-x-auto print:hidden">
            {[
              { id: 'overview', label: 'Executive Overview', icon: Layers },
              { id: 'revenue', label: 'Revenue Analysis', icon: DollarSign },
              { id: 'receivables', label: 'Receivables & Ageing', icon: TrendingUp },
              { id: 'collections', label: 'Collections', icon: CreditCard },
              { id: 'monthly', label: 'Monthly MIS', icon: Calendar },
              { id: 'customers', label: 'Customer Scorecard', icon: Building2 },
              { id: 'operational', label: 'Operations Pipeline', icon: Factory },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-3.5 px-3 border-b-2 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isActive 
                      ? 'border-teal-600 text-teal-600' 
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: EXECUTIVE OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Secondary Metrics Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Taxable Value</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">₹{summary.gst.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-[11px] text-slate-500 mt-1">Excludes GST component</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">GST Liability</div>
                  <div className="text-xl font-bold text-indigo-600 mt-1">₹{summary.gst.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-[11px] text-slate-500 mt-1">CGST: ₹{summary.gst.cgst_amount} | SGST: ₹{summary.gst.sgst_amount} | IGST: ₹{summary.gst.igst_amount}</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Current Month Collections</div>
                  <div className="text-xl font-bold text-emerald-600 mt-1">₹{summary.collections.current_month_collections.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-[11px] text-slate-500 mt-1">Prev: ₹{summary.collections.previous_month_collections.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Operational Throughput</div>
                  <div className="text-xl font-bold text-slate-900 mt-1">{summary.operational.production_count} Prod / {summary.operational.dispatch_count} Disp</div>
                  <div className="text-[11px] text-slate-500 mt-1">QC Pass: {summary.operational.qc_passed_count} | QC Fail: {summary.operational.qc_failed_count}</div>
                </div>
              </div>

              {/* Receivables Ageing Breakdown Card */}
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Accounts Receivable Ageing Slabs</h2>
                    <p className="text-xs text-slate-500">Live outstanding balance classification as of {summary.as_of_date}</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('receivables')}
                    className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1"
                  >
                    <span>View Detail</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                    <div className="text-[11px] font-bold text-emerald-800">Current (0d)</div>
                    <div className="text-base font-bold text-emerald-900 mt-1">₹{summary.receivables.buckets.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="text-[11px] font-bold text-blue-800">1–30 Days</div>
                    <div className="text-base font-bold text-blue-900 mt-1">₹{summary.receivables.buckets.days_1_30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                    <div className="text-[11px] font-bold text-amber-800">31–60 Days</div>
                    <div className="text-base font-bold text-amber-900 mt-1">₹{summary.receivables.buckets.days_31_60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                    <div className="text-[11px] font-bold text-orange-800">61–90 Days</div>
                    <div className="text-base font-bold text-orange-900 mt-1">₹{summary.receivables.buckets.days_61_90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                    <div className="text-[11px] font-bold text-rose-800">90+ Days</div>
                    <div className="text-base font-bold text-rose-900 mt-1">₹{summary.receivables.buckets.days_90_plus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>

              {/* Monthly Overview Snapshot Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Recent Monthly Performance Trend</h2>
                  <button
                    onClick={exportMonthlyCSV}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Billing Month</th>
                        <th className="py-2.5 px-4 text-right">Invoiced (INR)</th>
                        <th className="py-2.5 px-4 text-right">Collections (INR)</th>
                        <th className="py-2.5 px-4 text-right">GST (INR)</th>
                        <th className="py-2.5 px-4 text-right">Net Created (INR)</th>
                        <th className="py-2.5 px-4 text-center">Invoices</th>
                        <th className="py-2.5 px-4 text-center">Payments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyData.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">No monthly billing records available</td>
                        </tr>
                      ) : (
                        monthlyData.slice(0, 5).map(m => (
                          <tr key={m.month} className="hover:bg-slate-50 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-800">{m.month}</td>
                            <td className="py-3 px-4 text-right font-semibold text-slate-900">₹{m.invoiced_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right font-semibold text-emerald-600">₹{m.payment_received.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right text-indigo-600">₹{m.gst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className={`py-3 px-4 text-right font-bold ${m.outstanding_created > 0 ? 'text-amber-600' : 'text-slate-600'}`}>
                              ₹{m.outstanding_created.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-center font-medium">{m.invoice_count}</td>
                            <td className="py-3 px-4 text-center font-medium">{m.payment_count}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: REVENUE ANALYSIS */}
          {activeTab === 'revenue' && revenueData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Gross Invoiced Revenue</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">₹{revenueData.summary.total_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-slate-500 mt-1">{revenueData.summary.invoice_count} issued invoices</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Taxable Component</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">₹{revenueData.summary.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-slate-500 mt-1">Base turnover without GST</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Average Invoice Value</div>
                  <div className="text-2xl font-bold text-teal-700 mt-1">₹{revenueData.summary.average_invoice_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-slate-500 mt-1">Per transaction average</div>
                </div>
              </div>

              {/* Customer Revenue Ranking Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Revenue Contribution by Customer</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4">GSTIN</th>
                        <th className="py-2.5 px-4 text-center">Invoices</th>
                        <th className="py-2.5 px-4 text-right">Taxable Turnover</th>
                        <th className="py-2.5 px-4 text-right">GST Collected</th>
                        <th className="py-2.5 px-4 text-right">Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {revenueData.customer_revenue.map((c: any) => (
                        <tr key={c.customer_id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-800">
                            <div>{c.customer_name}</div>
                            <div className="text-[11px] font-mono text-slate-400">{c.customer_code}</div>
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600">{c.customer_gstin}</td>
                          <td className="py-3 px-4 text-center">{c.invoice_count}</td>
                          <td className="py-3 px-4 text-right font-medium">₹{c.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right text-indigo-600">₹{c.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900">₹{c.total_revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RECEIVABLES & AGEING */}
          {activeTab === 'receivables' && receivablesData && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Unsettled Invoices as of {receivablesData.as_of_date}</h2>
                  <p className="text-xs text-slate-500">Total Outstanding: ₹{receivablesData.summary.total_outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })} across {receivablesData.summary.outstanding_invoice_count} open invoices</p>
                </div>
                <button
                  onClick={exportReceivablesCSV}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Receivables CSV</span>
                </button>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Invoice #</th>
                        <th className="py-2.5 px-4">Invoice Date</th>
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4 text-right">Invoice Total</th>
                        <th className="py-2.5 px-4 text-right">Paid Amount</th>
                        <th className="py-2.5 px-4 text-right">Outstanding</th>
                        <th className="py-2.5 px-4 text-center">Age</th>
                        <th className="py-2.5 px-4 text-center">Bucket</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {receivablesData.invoices.length === 0 ? (
                        <tr><td colSpan={8} className="py-8 text-center text-slate-400">All invoices are 100% settled!</td></tr>
                      ) : (
                        receivablesData.invoices.map((inv: any) => (
                          <tr key={inv.invoice_id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-bold text-teal-700 font-mono">{inv.invoice_number}</td>
                            <td className="py-3 px-4 text-slate-600">{inv.invoice_date}</td>
                            <td className="py-3 px-4 font-semibold text-slate-800">{inv.customer_name}</td>
                            <td className="py-3 px-4 text-right font-medium">₹{inv.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right text-emerald-600">₹{inv.paid_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-right font-bold text-amber-600">₹{inv.outstanding_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className="py-3 px-4 text-center font-bold">{inv.days_old} days</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                inv.ageing_bucket === 'CURRENT' ? 'bg-emerald-100 text-emerald-800' :
                                inv.ageing_bucket === '1_30' ? 'bg-blue-100 text-blue-800' :
                                inv.ageing_bucket === '31_60' ? 'bg-amber-100 text-amber-800' :
                                inv.ageing_bucket === '61_90' ? 'bg-orange-100 text-orange-800' :
                                'bg-rose-100 text-rose-800'
                              }`}>
                                {inv.ageing_bucket}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: COLLECTIONS */}
          {activeTab === 'collections' && paymentsData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Total Collected</div>
                  <div className="text-2xl font-bold text-emerald-600 mt-1">₹{paymentsData.summary.total_payments_received.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-slate-500 mt-1">{paymentsData.summary.payment_count} transactions</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Allocated to Invoices</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">₹{paymentsData.summary.total_allocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-slate-500 mt-1">Applied to open invoices</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Unallocated Advance</div>
                  <div className="text-2xl font-bold text-teal-700 mt-1">₹{paymentsData.summary.unallocated_payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  <div className="text-xs text-slate-500 mt-1">Available advance balance</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">Cancelled Payments</div>
                  <div className="text-2xl font-bold text-rose-600 mt-1">{paymentsData.summary.cancelled_payment_count}</div>
                  <div className="text-xs text-slate-500 mt-1">Strictly excluded from totals</div>
                </div>
              </div>

              {/* Payments register */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Collections Register</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Payment #</th>
                        <th className="py-2.5 px-4">Date</th>
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4">Mode / Ref</th>
                        <th className="py-2.5 px-4 text-right">Amount</th>
                        <th className="py-2.5 px-4 text-right">Allocated</th>
                        <th className="py-2.5 px-4 text-right">Unallocated</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paymentsData.payments.map((p: any) => (
                        <tr key={p.payment_id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-teal-700 font-mono">{p.payment_number}</td>
                          <td className="py-3 px-4 text-slate-600">{p.payment_date}</td>
                          <td className="py-3 px-4 font-semibold text-slate-800">{p.customer_name}</td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-700">{p.payment_mode}</span>
                            <div className="text-[11px] text-slate-400">{p.reference_number}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900">₹{p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right text-emerald-600 font-medium">₹{p.allocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right text-slate-600 font-medium">₹{p.unallocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              p.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: MONTHLY MIS */}
          {activeTab === 'monthly' && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Month-on-Month Financial MIS</h2>
                  <p className="text-xs text-slate-500">Chronological analysis of billing, tax, collections, and net balance creation</p>
                </div>
                <button
                  onClick={exportMonthlyCSV}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Monthly CSV</span>
                </button>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">Billing Month</th>
                        <th className="py-3 px-4 text-right">Invoiced Amount</th>
                        <th className="py-3 px-4 text-right">Payments Received</th>
                        <th className="py-3 px-4 text-right">GST Liability</th>
                        <th className="py-3 px-4 text-right">Net Created Balance</th>
                        <th className="py-3 px-4 text-center">Invoices</th>
                        <th className="py-3 px-4 text-center">Collections</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyData.map(m => (
                        <tr key={m.month} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900">{m.month}</td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900">₹{m.invoiced_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-600">₹{m.payment_received.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right text-indigo-600 font-medium">₹{m.gst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className={`py-3 px-4 text-right font-bold ${m.outstanding_created > 0 ? 'text-amber-600' : 'text-slate-600'}`}>
                            ₹{m.outstanding_created.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-center font-bold">{m.invoice_count}</td>
                          <td className="py-3 px-4 text-center font-bold">{m.payment_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: CUSTOMER SCORECARD */}
          {activeTab === 'customers' && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Customer Performance & Credit Exposure</h2>
                  <p className="text-xs text-slate-500">Invoiced turnover, collections, open exposure, and collection rates</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Min Outstanding ₹"
                    value={minOutstanding}
                    onChange={(e) => setMinOutstanding(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs w-36"
                  />
                  <button
                    onClick={exportCustomerCSV}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">Customer</th>
                        <th className="py-3 px-4">GSTIN</th>
                        <th className="py-3 px-4 text-center">Invoices</th>
                        <th className="py-3 px-4 text-right">Invoiced (INR)</th>
                        <th className="py-3 px-4 text-right">Paid (INR)</th>
                        <th className="py-3 px-4 text-right">Outstanding (INR)</th>
                        <th className="py-3 px-4 text-right">Overdue (INR)</th>
                        <th className="py-3 px-4 text-right">Collection Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customerData.map(c => (
                        <tr key={c.customer_id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900">
                            <div>{c.customer_name}</div>
                            <div className="text-[11px] font-mono text-slate-400">{c.customer_code}</div>
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">{c.customer_gstin}</td>
                          <td className="py-3 px-4 text-center font-bold">{c.invoice_count}</td>
                          <td className="py-3 px-4 text-right font-medium">₹{c.invoiced_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right font-medium text-emerald-600">₹{c.paid_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right font-bold text-amber-600">₹{c.outstanding_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right font-bold text-rose-600">₹{c.overdue_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-4 text-right">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              c.collection_percentage >= 90 ? 'bg-emerald-100 text-emerald-800' :
                              c.collection_percentage >= 50 ? 'bg-amber-100 text-amber-800' :
                              'bg-rose-100 text-rose-800'
                            }`}>
                              {c.collection_percentage.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: OPERATIONAL SUMMARY */}
          {activeTab === 'operational' && operationalData && (
            <div className="space-y-6">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900">Factory Operational Pipeline Performance</h2>
                <p className="text-xs text-slate-500">Cross-department flow from Production to QC, Dispatch, Invoicing, and Cash Realization</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Production */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-900 font-bold mb-3">
                    <Factory className="w-4 h-4 text-teal-600" />
                    <span>Production Execution</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Active Executions:</span>
                      <span className="font-bold text-slate-800">{operationalData.production.executions_count}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Planned Quantity:</span>
                      <span className="font-bold text-slate-800">{operationalData.production.planned_qty.toLocaleString()} pcs</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Processed Quantity:</span>
                      <span className="font-bold text-teal-700">{operationalData.production.processed_qty.toLocaleString()} pcs</span>
                    </div>
                  </div>
                </div>

                {/* Quality Control */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-900 font-bold mb-3">
                    <ShieldCheck className="w-4 h-4 text-blue-600" />
                    <span>Quality Control (QC)</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Total Inspections:</span>
                      <span className="font-bold text-slate-800">{operationalData.quality_control.inspections_count}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">QC Pass Rate:</span>
                      <span className="font-bold text-emerald-600">{operationalData.quality_control.pass_rate_pct}%</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Accepted vs Rejected:</span>
                      <span className="font-bold text-slate-800">
                        {operationalData.quality_control.accepted_qty.toLocaleString()} / <span className="text-rose-600">{operationalData.quality_control.rejected_qty.toLocaleString()}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dispatch & Delivery */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 text-slate-900 font-bold mb-3">
                    <Truck className="w-4 h-4 text-amber-600" />
                    <span>Logistics & Dispatch</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Dispatches Made:</span>
                      <span className="font-bold text-slate-800">{operationalData.dispatch.dispatch_count} batches</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Total Dispatched Qty:</span>
                      <span className="font-bold text-amber-700">{operationalData.dispatch.dispatched_qty.toLocaleString()} pcs</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default FinancialDashboard;
