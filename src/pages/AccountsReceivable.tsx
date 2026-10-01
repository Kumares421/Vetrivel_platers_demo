import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Search, Calendar, User, FileText, Printer, Download,
  DollarSign, AlertCircle, Clock, CheckCircle2, Filter, XCircle, ArrowUpRight, BookOpen, Layers, CreditCard
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface ARSummary {
  as_of_date: string;
  total_invoiced_amount: number;
  total_paid_amount: number;
  total_outstanding_amount: number;
  current_amount: number;
  overdue_amount: number;
  buckets: {
    current: number;
    days_1_30: number;
    days_31_60: number;
    days_61_90: number;
    days_90_plus: number;
  };
  customer_count_with_outstanding: number;
  total_pending_invoices_count: number;
}

interface CustomerReportRow {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  address?: string;
  gst_number?: string;
  invoice_count: number;
  total_invoiced_amount: number;
  total_paid_amount: number;
  total_outstanding_amount: number;
  overdue_amount: number;
  pending_invoices_count: number;
  buckets: {
    current: number;
    days_1_30: number;
    days_31_60: number;
    days_61_90: number;
    days_90_plus: number;
  };
}

interface InvoiceReportRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  invoice_total: number;
  paid_amount: number;
  outstanding_amount: number;
  days_old: number;
  ageing_bucket: 'CURRENT' | '1_30' | '31_60' | '61_90' | '90_PLUS';
}

interface AgeingReportRow {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
  total_outstanding: number;
}

interface OverdueReportRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  invoice_total: number;
  paid_amount: number;
  outstanding_amount: number;
  days_overdue: number;
  ageing_bucket: string;
}

interface PaymentHistoryRow {
  payment_id: string;
  payment_number: string;
  payment_date: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  payment_mode: string;
  reference_number?: string;
  bank_name?: string;
  amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  status: string;
}

interface StatementEntry {
  id: string;
  date: string;
  document_type: 'INVOICE' | 'PAYMENT';
  document_number: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
}

interface CustomerStatementData {
  customer: {
    id: string;
    code: string;
    name: string;
    address?: string;
    gst_number?: string;
  };
  statement_period: {
    from_date: string | null;
    to_date: string;
    as_of_date: string;
  };
  opening_balance: number;
  closing_balance: number;
  total_debits: number;
  total_credits: number;
  entries: StatementEntry[];
}

// Client-side CSV Download Utility
function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [
    headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map(row => row.map(cell => `"${(cell ?? '').toString().replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export const AccountsReceivable: React.FC = () => {
  const { user } = useAuth();

  // Primary Controls
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'STATEMENTS' | 'INVOICES' | 'AGEING' | 'OVERDUE' | 'PAYMENTS'>('OVERVIEW');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [bucketFilter, setBucketFilter] = useState<string>('');
  const [paymentModeFilter, setPaymentModeFilter] = useState<string>('');

  // Data states
  const [summary, setSummary] = useState<ARSummary | null>(null);
  const [customerReports, setCustomerReports] = useState<CustomerReportRow[]>([]);
  const [invoiceReports, setInvoiceReports] = useState<InvoiceReportRow[]>([]);
  const [ageingReports, setAgeingReports] = useState<AgeingReportRow[]>([]);
  const [overdueReports, setOverdueReports] = useState<OverdueReportRow[]>([]);
  const [paymentReports, setPaymentReports] = useState<PaymentHistoryRow[]>([]);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Statement Specific State
  const [selectedCustomerForStatement, setSelectedCustomerForStatement] = useState<string>('');
  const [statementData, setStatementData] = useState<CustomerStatementData | null>(null);
  const [statementLoading, setStatementLoading] = useState<boolean>(false);

  // Load Report Data
  const loadAllARReports = async () => {
    try {
      setLoading(true);
      setError(null);

      const [sumRes, custRes, invRes, ageRes, overRes, payRes] = await Promise.all([
        apiFetch(`/api/accounts-receivable/summary?as_of_date=${asOfDate}`),
        apiFetch(`/api/accounts-receivable/reports/customers?as_of_date=${asOfDate}`),
        apiFetch(`/api/accounts-receivable/reports/invoices?as_of_date=${asOfDate}`),
        apiFetch(`/api/accounts-receivable/reports/ageing?as_of_date=${asOfDate}`),
        apiFetch(`/api/accounts-receivable/reports/overdue?as_of_date=${asOfDate}`),
        apiFetch(`/api/accounts-receivable/reports/payments${fromDate ? `?from_date=${fromDate}&to_date=${toDate}` : ''}`)
      ]);

      setSummary(sumRes);
      setCustomerReports(custRes || []);
      setInvoiceReports(invRes || []);
      setAgeingReports(ageRes || []);
      setOverdueReports(overRes || []);
      setPaymentReports(payRes || []);

      if (custRes && custRes.length > 0 && !selectedCustomerForStatement) {
        setSelectedCustomerForStatement(custRes[0].customer_id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load Accounts Receivable report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllARReports();
  }, [asOfDate, fromDate, toDate]);

  // Load Specific Customer Statement
  const loadCustomerStatement = async (cId: string) => {
    if (!cId) return;
    try {
      setStatementLoading(true);
      let url = `/api/accounts-receivable/customer/${cId}/statement?as_of_date=${asOfDate}`;
      if (fromDate) url += `&from_date=${fromDate}`;
      if (toDate) url += `&to_date=${toDate}`;

      const data = await apiFetch(url);
      setStatementData(data);
    } catch (err: any) {
      console.error('Error loading statement:', err);
    } finally {
      setStatementLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCustomerForStatement && activeTab === 'STATEMENTS') {
      loadCustomerStatement(selectedCustomerForStatement);
    }
  }, [selectedCustomerForStatement, activeTab, asOfDate, fromDate, toDate]);

  // CSV Export Handlers for Reports
  const exportCustomerOutstandingCSV = () => {
    const headers = ['Customer Code', 'Customer Name', 'Invoices Count', 'Total Invoiced (INR)', 'Total Paid (INR)', 'Total Outstanding (INR)', 'Overdue Amount (INR)'];
    const rows = customerReports.map(c => [
      c.customer_code, c.customer_name, c.invoice_count, c.total_invoiced_amount, c.total_paid_amount, c.total_outstanding_amount, c.overdue_amount
    ]);
    exportToCSV(`Customer_Outstanding_Report_${asOfDate}.csv`, headers, rows);
  };

  const exportInvoiceOutstandingCSV = () => {
    const headers = ['Invoice Number', 'Invoice Date', 'Customer Code', 'Customer Name', 'Invoice Amount (INR)', 'Paid Amount (INR)', 'Outstanding (INR)', 'Age (Days)', 'Ageing Bucket'];
    const rows = invoiceReports.map(i => [
      i.invoice_number, i.invoice_date, i.customer_code, i.customer_name, i.invoice_total, i.paid_amount, i.outstanding_amount, i.days_old, i.ageing_bucket
    ]);
    exportToCSV(`Invoice_Outstanding_Report_${asOfDate}.csv`, headers, rows);
  };

  const exportAgeingCSV = () => {
    const headers = ['Customer Code', 'Customer Name', 'Current (INR)', '1-30 Days (INR)', '31-60 Days (INR)', '61-90 Days (INR)', '90+ Days (INR)', 'Total Outstanding (INR)'];
    const rows = ageingReports.map(a => [
      a.customer_code, a.customer_name, a.current, a.days_1_30, a.days_31_60, a.days_61_90, a.days_90_plus, a.total_outstanding
    ]);
    exportToCSV(`Customer_Ageing_Report_${asOfDate}.csv`, headers, rows);
  };

  const exportOverdueCSV = () => {
    const headers = ['Invoice Number', 'Invoice Date', 'Customer Code', 'Customer Name', 'Invoice Amount (INR)', 'Paid Amount (INR)', 'Outstanding (INR)', 'Days Overdue', 'Ageing Bucket'];
    const rows = overdueReports.map(o => [
      o.invoice_number, o.invoice_date, o.customer_code, o.customer_name, o.invoice_total, o.paid_amount, o.outstanding_amount, o.days_overdue, o.ageing_bucket
    ]);
    exportToCSV(`Overdue_Invoices_Report_${asOfDate}.csv`, headers, rows);
  };

  const exportPaymentHistoryCSV = () => {
    const headers = ['Payment Number', 'Payment Date', 'Customer Code', 'Customer Name', 'Payment Mode', 'Reference #', 'Amount (INR)', 'Allocated Amount (INR)', 'Unallocated Amount (INR)', 'Status'];
    const rows = paymentReports.map(p => [
      p.payment_number, p.payment_date, p.customer_code, p.customer_name, p.payment_mode, p.reference_number || 'N/A', p.amount, p.allocated_amount, p.unallocated_amount, p.status
    ]);
    exportToCSV(`Payment_History_Report_${asOfDate}.csv`, headers, rows);
  };

  const getBucketBadge = (bucket: string) => {
    switch (bucket) {
      case 'CURRENT':
        return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded text-[10px]">CURRENT (0d)</span>;
      case '1_30':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold rounded text-[10px]">1-30 DAYS</span>;
      case '31_60':
        return <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded text-[10px]">31-60 DAYS</span>;
      case '61_90':
        return <span className="px-2 py-0.5 bg-orange-100 text-orange-800 font-bold rounded text-[10px]">61-90 DAYS</span>;
      case '90_PLUS':
        return <span className="px-2 py-0.5 bg-red-100 text-red-800 font-bold rounded text-[10px]">90+ DAYS</span>;
      default:
        return null;
    }
  };

  // Filtered rows
  const filteredInvoices = invoiceReports.filter(i => {
    if (selectedCustomerId && i.customer_id !== selectedCustomerId) return false;
    if (bucketFilter && i.ageing_bucket !== bucketFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return i.invoice_number.toLowerCase().includes(q) || i.customer_name.toLowerCase().includes(q) || i.customer_code.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredOverdue = overdueReports.filter(o => {
    if (selectedCustomerId && o.customer_id !== selectedCustomerId) return false;
    if (bucketFilter && o.ageing_bucket !== bucketFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return o.invoice_number.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q) || o.customer_code.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredPayments = paymentReports.filter(p => {
    if (selectedCustomerId && p.customer_id !== selectedCustomerId) return false;
    if (paymentModeFilter && p.payment_mode !== paymentModeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return p.payment_number.toLowerCase().includes(q) || (p.reference_number || '').toLowerCase().includes(q) || p.customer_name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* TOP BAR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm print:hidden">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-indigo-600" />
            Advanced Accounts Receivable & Financial Reports
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Customer statement ledger, ageing matrix, overdue tracking & payment history
          </p>
        </div>

        {/* CONTROLS */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs">
            <Calendar className="w-4 h-4 text-indigo-600" />
            <span className="font-bold text-slate-700">As-Of Date:</span>
            <input
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold text-slate-900"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2 print:hidden">
          <AlertCircle className="w-4 h-4 text-red-600" />
          {error}
        </div>
      )}

      {/* DASHBOARD STAT TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
        <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-4 rounded-2xl shadow-md border border-indigo-800">
          <div className="text-[11px] font-bold text-indigo-200 uppercase tracking-wider">Total AR Receivables</div>
          <div className="text-2xl font-black font-mono mt-1">
            ₹{summary?.total_outstanding_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="mt-2 text-[10px] text-indigo-300 font-medium">
            Invoiced: ₹{summary?.total_invoiced_amount.toLocaleString('en-IN') || 0} | Paid: ₹{summary?.total_paid_amount.toLocaleString('en-IN') || 0}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider flex items-center justify-between">
            <span>Current (0 Days)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            ₹{summary?.current_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Due on report date {asOfDate}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold text-red-600 uppercase tracking-wider flex items-center justify-between">
            <span>Total Overdue (1+ Days)</span>
            <AlertCircle className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-xl font-bold font-mono text-red-600 mt-1">
            ₹{summary?.overdue_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Across {summary?.customer_count_with_outstanding || 0} customer accounts
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>Pending Invoices</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {summary?.total_pending_invoices_count || 0} Invoices
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            With open remaining balance
          </div>
        </div>
      </div>

      {/* NAVIGATION TABS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:border-none print:shadow-none">
        
        <div className="p-3 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-200/60 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('OVERVIEW')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'OVERVIEW' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Overview ({customerReports.length})
            </button>
            <button
              onClick={() => setActiveTab('STATEMENTS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'STATEMENTS' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Customer Statements
            </button>
            <button
              onClick={() => setActiveTab('INVOICES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'INVOICES' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Outstanding Invoices ({filteredInvoices.length})
            </button>
            <button
              onClick={() => setActiveTab('AGEING')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'AGEING' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ageing Report ({ageingReports.length})
            </button>
            <button
              onClick={() => setActiveTab('OVERDUE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'OVERDUE' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Overdue ({filteredOverdue.length})
            </button>
            <button
              onClick={() => setActiveTab('PAYMENTS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'PAYMENTS' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Payment History ({filteredPayments.length})
            </button>
          </div>

          {/* SEARCH & FILTERS */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-xl text-xs font-medium w-40 sm:w-48"
              />
            </div>
          </div>
        </div>

        {/* TAB 1: OVERVIEW & CUSTOMER SUMMARY */}
        {activeTab === 'OVERVIEW' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Customer Outstanding Report
              </h3>
              <button
                onClick={exportCustomerOutstandingCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="p-3">Customer Code & Name</th>
                    <th className="p-3 text-center">Invoices</th>
                    <th className="p-3 text-right">Total Invoiced (₹)</th>
                    <th className="p-3 text-right">Total Paid (₹)</th>
                    <th className="p-3 text-right">Outstanding (₹)</th>
                    <th className="p-3 text-right">Overdue (₹)</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customerReports.map(c => (
                    <tr key={c.customer_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{c.customer_name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{c.customer_code}</div>
                      </td>
                      <td className="p-3 text-center font-bold font-mono text-slate-700">{c.invoice_count}</td>
                      <td className="p-3 text-right font-mono font-medium text-slate-700">₹{c.total_invoiced_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-medium text-emerald-700">₹{c.total_paid_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">₹{c.total_outstanding_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-red-600">₹{c.overdue_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            setSelectedCustomerForStatement(c.customer_id);
                            setActiveTab('STATEMENTS');
                          }}
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-[11px] inline-flex items-center gap-1"
                        >
                          <BookOpen className="w-3.5 h-3.5" /> View Ledger
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: CUSTOMER STATEMENT */}
        {activeTab === 'STATEMENTS' && (
          <div className="p-5 space-y-6">
            
            {/* STATEMENT CONTROLS */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs print:hidden">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-slate-600 font-bold mb-1">Select Customer:</label>
                  <select
                    value={selectedCustomerForStatement}
                    onChange={e => setSelectedCustomerForStatement(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                  >
                    {customerReports.map(c => (
                      <option key={c.customer_id} value={c.customer_id}>
                        {c.customer_name} ({c.customer_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">From Date (Opening Bal):</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-bold mb-1">To Date:</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-semibold"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Statement
                </button>
                <a
                  href={`/api/accounts-receivable/customer/${selectedCustomerForStatement}/statement/export?as_of_date=${asOfDate}${fromDate ? `&from_date=${fromDate}` : ''}${toDate ? `&to_date=${toDate}` : ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </a>
              </div>
            </div>

            {statementLoading || !statementData ? (
              <div className="p-12 text-center text-slate-400 font-medium">
                Loading customer ledger statement...
              </div>
            ) : (
              /* STATEMENT LEDGER CARD */
              <div className="space-y-6 font-sans">
                
                {/* STATEMENT HEADER */}
                <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">VETRIVEL PLATERS</h2>
                    <p className="text-xs text-slate-600 font-bold">Electroplating & Metal Finishing Services</p>
                    <p className="text-[11px] text-slate-500">Plot No 42, SIDCO Industrial Estate, Ambattur, Chennai</p>
                  </div>
                  <div className="text-right">
                    <h3 className="text-lg font-black text-indigo-900 uppercase">Customer Statement</h3>
                    <p className="text-xs font-bold text-slate-700">As of Date: {statementData.statement_period.as_of_date}</p>
                    {statementData.statement_period.from_date && (
                      <p className="text-[11px] text-slate-500">Period: {statementData.statement_period.from_date} to {statementData.statement_period.to_date}</p>
                    )}
                  </div>
                </div>

                {/* CUSTOMER INFO & SUMMARY BAR */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Statement For</span>
                    <span className="font-bold text-slate-900 text-sm block">{statementData.customer.name}</span>
                    <span className="font-mono text-slate-600 font-semibold block">Code: {statementData.customer.code}</span>
                    {statementData.customer.address && <span className="text-slate-600 block mt-0.5">{statementData.customer.address}</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">GSTIN</span>
                    <span className="font-mono font-bold text-slate-800 block">{statementData.customer.gst_number || 'N/A'}</span>
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">Closing Outstanding Balance</span>
                      <span className="text-base font-black font-mono text-indigo-900">
                        ₹{statementData.closing_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* RECONCILIATION SUMMARY BOXES */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 bg-slate-100 rounded-xl">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Opening Balance</div>
                    <div className="font-mono font-bold text-slate-900 mt-1">₹{statementData.opening_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-slate-100 rounded-xl">
                    <div className="text-[10px] font-bold text-indigo-700 uppercase">Period Debits (Invoices)</div>
                    <div className="font-mono font-bold text-indigo-900 mt-1">₹{statementData.total_debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-slate-100 rounded-xl">
                    <div className="text-[10px] font-bold text-emerald-700 uppercase">Period Credits (Payments)</div>
                    <div className="font-mono font-bold text-emerald-800 mt-1">₹{statementData.total_credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="p-3 bg-indigo-900 text-white rounded-xl shadow-sm">
                    <div className="text-[10px] font-bold text-indigo-200 uppercase">Closing Balance</div>
                    <div className="font-mono font-bold mt-1">₹{statementData.closing_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>

                {/* STATEMENT TABLE */}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <th className="p-3">Date</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Document #</th>
                        <th className="p-3">Description</th>
                        <th className="p-3 text-right">Debit (₹)</th>
                        <th className="p-3 text-right">Credit (₹)</th>
                        <th className="p-3 text-right">Running Balance (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {statementData.entries.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-400">
                            No ledger entries found for this statement period.
                          </td>
                        </tr>
                      ) : (
                        statementData.entries.map((entry, idx) => (
                          <tr key={idx} className={entry.document_type === 'PAYMENT' ? 'bg-emerald-50/30' : ''}>
                            <td className="p-3 font-medium text-slate-700 whitespace-nowrap">{entry.date}</td>
                            <td className="p-3 font-bold">
                              <span className={`px-2 py-0.5 rounded text-[10px] ${
                                entry.document_type === 'INVOICE' ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {entry.document_type}
                              </span>
                            </td>
                            <td className="p-3 font-mono font-bold text-slate-900">{entry.document_number}</td>
                            <td className="p-3 text-slate-600">{entry.description}</td>
                            <td className="p-3 text-right font-mono font-bold text-indigo-900">
                              {entry.debit > 0 ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-emerald-700">
                              {entry.credit > 0 ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">
                              ₹{entry.running_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

              </div>
            )}
          </div>
        )}

        {/* TAB 3: INVOICE OUTSTANDING REPORT */}
        {activeTab === 'INVOICES' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Invoice Outstanding Report
              </h3>
              <button
                onClick={exportInvoiceOutstandingCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="p-3">Invoice #</th>
                    <th className="p-3">Invoice Date</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-center">Age (Days)</th>
                    <th className="p-3 text-center">Ageing Bucket</th>
                    <th className="p-3 text-right">Invoice Total (₹)</th>
                    <th className="p-3 text-right">Paid (₹)</th>
                    <th className="p-3 text-right">Outstanding (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map(inv => (
                    <tr key={inv.invoice_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                      <td className="p-3 text-slate-600">{inv.invoice_date}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        {inv.customer_name} <span className="text-[10px] text-slate-400 font-mono">({inv.customer_code})</span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-700">{inv.days_old} d</td>
                      <td className="p-3 text-center">{getBucketBadge(inv.ageing_bucket)}</td>
                      <td className="p-3 text-right font-mono text-slate-700">₹{inv.invoice_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-emerald-700">₹{inv.paid_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-red-600 text-sm">₹{inv.outstanding_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: AGEING REPORT MATRIX */}
        {activeTab === 'AGEING' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Customer Ageing Report
              </h3>
              <button
                onClick={exportAgeingCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-right bg-emerald-50/50">Current (0d)</th>
                    <th className="p-3 text-right bg-blue-50/50">1–30 Days</th>
                    <th className="p-3 text-right bg-amber-50/50">31–60 Days</th>
                    <th className="p-3 text-right bg-orange-50/50">61–90 Days</th>
                    <th className="p-3 text-right bg-red-50/50">90+ Days</th>
                    <th className="p-3 text-right font-black">Total Outstanding (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {ageingReports.map(a => (
                    <tr key={a.customer_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-sans font-bold text-slate-900">
                        {a.customer_name} <span className="text-[10px] text-slate-400 font-mono">({a.customer_code})</span>
                      </td>
                      <td className="p-3 text-right text-emerald-800">₹{a.current.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right text-blue-800">₹{a.days_1_30.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right text-amber-800">₹{a.days_31_60.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right text-orange-800">₹{a.days_61_90.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right text-red-800 font-bold">₹{a.days_90_plus.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right font-black text-slate-900 text-sm">₹{a.total_outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: OVERDUE INVOICE REPORT */}
        {activeTab === 'OVERDUE' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-red-700 uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-600" /> Overdue Invoice Report (Days Overdue &gt; 0)
              </h3>
              <button
                onClick={exportOverdueCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-red-50/50 text-red-900 font-bold border-b border-red-200">
                    <th className="p-3">Invoice #</th>
                    <th className="p-3">Invoice Date</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 text-center">Days Overdue</th>
                    <th className="p-3 text-center">Bucket</th>
                    <th className="p-3 text-right">Invoice Total (₹)</th>
                    <th className="p-3 text-right">Paid (₹)</th>
                    <th className="p-3 text-right">Overdue Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOverdue.map(o => (
                    <tr key={o.invoice_id} className="hover:bg-red-50/30 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-900">{o.invoice_number}</td>
                      <td className="p-3 text-slate-600">{o.invoice_date}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        {o.customer_name} <span className="text-[10px] text-slate-400 font-mono">({o.customer_code})</span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-red-600">{o.days_overdue} days</td>
                      <td className="p-3 text-center">{getBucketBadge(o.ageing_bucket)}</td>
                      <td className="p-3 text-right font-mono text-slate-700">₹{o.invoice_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-emerald-700">₹{o.paid_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-red-600 text-sm">₹{o.outstanding_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: PAYMENT HISTORY REPORT */}
        {activeTab === 'PAYMENTS' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Payment History Report
              </h3>
              <button
                onClick={exportPaymentHistoryCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="p-3">Payment #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Mode</th>
                    <th className="p-3">Ref #</th>
                    <th className="p-3 text-right">Total Amount (₹)</th>
                    <th className="p-3 text-right">Allocated (₹)</th>
                    <th className="p-3 text-right">Unallocated (₹)</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPayments.map(p => (
                    <tr key={p.payment_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-900">{p.payment_number}</td>
                      <td className="p-3 text-slate-600">{p.payment_date}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        {p.customer_name} <span className="text-[10px] text-slate-400 font-mono">({p.customer_code})</span>
                      </td>
                      <td className="p-3 font-semibold">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-800">
                          {p.payment_mode}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-slate-600">{p.reference_number || 'N/A'}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">₹{p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-emerald-700">₹{p.allocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-500">₹{p.unallocated_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
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
        )}

      </div>
    </div>
  );
};
