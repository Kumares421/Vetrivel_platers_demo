import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, Search, Calendar, User, Download, Printer, 
  DollarSign, CheckCircle2, AlertCircle, Percent, Building2, Filter, Layers
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface GSTSummaryData {
  total_invoice_count: number;
  taxable_invoice_count: number;
  total_taxable_value: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_gst: number;
  total_invoice_value: number;
  current_month_taxable_value: number;
  current_month_gst: number;
  current_month_invoice_value: number;
}

interface InvoiceGSTRow {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  customer_gstin: string;
  place_of_supply: string;
  gst_type: 'INTRA_STATE' | 'INTER_STATE';
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_gst: number;
  invoice_total: number;
  status: string;
}

interface CustomerGSTRow {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_gstin: string;
  invoice_count: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_gst: number;
  invoice_value: number;
}

interface TaxSummaryData {
  overall: {
    taxable_value: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    total_gst: number;
    grand_total: number;
  };
  by_gst_type: {
    intra_state: {
      invoice_count: number;
      taxable_value: number;
      cgst_amount: number;
      sgst_amount: number;
      igst_amount: number;
      total_gst: number;
      invoice_value: number;
    };
    inter_state: {
      invoice_count: number;
      taxable_value: number;
      cgst_amount: number;
      sgst_amount: number;
      igst_amount: number;
      total_gst: number;
      invoice_value: number;
    };
  };
}

interface MonthlyGSTRow {
  month: string;
  invoice_count: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_gst: number;
  invoice_value: number;
}

interface GSTRateRow {
  gst_rate: number;
  line_count: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_gst: number;
}

// Client-side CSV export helper
function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
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

export const GSTReports: React.FC = () => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'INVOICES' | 'CUSTOMERS' | 'SUMMARY' | 'MONTHLY' | 'RATES'>('OVERVIEW');

  // Filters
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [gstTypeFilter, setGstTypeFilter] = useState<string>('');
  const [gstRateFilter, setGstRateFilter] = useState<string>('');

  // Data states
  const [summary, setSummary] = useState<GSTSummaryData | null>(null);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceGSTRow[]>([]);
  const [customerRows, setCustomerRows] = useState<CustomerGSTRow[]>([]);
  const [taxSummary, setTaxSummary] = useState<TaxSummaryData | null>(null);
  const [monthlyRows, setMonthlyRows] = useState<MonthlyGSTRow[]>([]);
  const [rateRows, setRateRows] = useState<GSTRateRow[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGSTData = async () => {
    try {
      setLoading(true);
      setError(null);

      let queryParams = '';
      const params: string[] = [];
      if (fromDate) params.push(`from_date=${fromDate}`);
      if (toDate) params.push(`to_date=${toDate}`);
      if (params.length > 0) queryParams = '?' + params.join('&');

      const [sumRes, invRes, custRes, taxRes, monRes, rateRes] = await Promise.all([
        apiFetch(`/api/gst-reports/summary${queryParams}`),
        apiFetch(`/api/gst-reports/invoices${queryParams}`),
        apiFetch(`/api/gst-reports/customers${queryParams}`),
        apiFetch(`/api/gst-reports/tax-summary${queryParams}`),
        apiFetch(`/api/gst-reports/monthly`),
        apiFetch(`/api/gst-reports/rates${queryParams}`)
      ]);

      setSummary(sumRes);
      setInvoiceRows(invRes || []);
      setCustomerRows(custRes || []);
      setTaxSummary(taxRes);
      setMonthlyRows(monRes || []);
      setRateRows(rateRes || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load GST Report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGSTData();
  }, [fromDate, toDate]);

  // Filtered rows
  const filteredInvoices = invoiceRows.filter(row => {
    if (gstTypeFilter && row.gst_type !== gstTypeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchInv = row.invoice_number.toLowerCase().includes(q);
      const matchCust = row.customer_name.toLowerCase().includes(q);
      const matchGst = row.customer_gstin.toLowerCase().includes(q);
      if (!matchInv && !matchCust && !matchGst) return false;
    }
    return true;
  });

  const filteredCustomers = customerRows.filter(row => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return row.customer_name.toLowerCase().includes(q) || row.customer_code.toLowerCase().includes(q) || row.customer_gstin.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredRates = rateRows.filter(row => {
    if (gstRateFilter && row.gst_rate.toString() !== gstRateFilter) return false;
    return true;
  });

  // CSV Export Handlers
  const handleExportInvoicesCSV = () => {
    const headers = ['Invoice Number', 'Invoice Date', 'Customer Name', 'Customer GSTIN', 'Place of Supply', 'GST Type', 'Taxable Value (INR)', 'CGST (INR)', 'SGST (INR)', 'IGST (INR)', 'Total GST (INR)', 'Invoice Total (INR)'];
    const rows = filteredInvoices.map(i => [
      i.invoice_number, i.invoice_date, i.customer_name, i.customer_gstin, i.place_of_supply, i.gst_type, i.taxable_value, i.cgst_amount, i.sgst_amount, i.igst_amount, i.total_gst, i.invoice_total
    ]);
    exportCSV(`GST_Invoice_Register_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handleExportCustomersCSV = () => {
    const headers = ['Customer Code', 'Customer Name', 'GSTIN', 'Invoice Count', 'Taxable Value (INR)', 'CGST (INR)', 'SGST (INR)', 'IGST (INR)', 'Total GST (INR)', 'Total Invoice Value (INR)'];
    const rows = filteredCustomers.map(c => [
      c.customer_code, c.customer_name, c.customer_gstin, c.invoice_count, c.taxable_value, c.cgst_amount, c.sgst_amount, c.igst_amount, c.total_gst, c.invoice_value
    ]);
    exportCSV(`Customer_GST_Summary_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handleExportMonthlyCSV = () => {
    const headers = ['Month', 'Invoice Count', 'Taxable Value (INR)', 'CGST (INR)', 'SGST (INR)', 'IGST (INR)', 'Total GST (INR)', 'Total Invoice Value (INR)'];
    const rows = monthlyRows.map(m => [
      m.month, m.invoice_count, m.taxable_value, m.cgst_amount, m.sgst_amount, m.igst_amount, m.total_gst, m.invoice_value
    ]);
    exportCSV(`Monthly_GST_Report_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handleExportRatesCSV = () => {
    const headers = ['GST Rate (%)', 'Line Count', 'Taxable Value (INR)', 'CGST (INR)', 'SGST (INR)', 'IGST (INR)', 'Total GST (INR)'];
    const rows = filteredRates.map(r => [
      `${r.gst_rate}%`, r.line_count, r.taxable_value, r.cgst_amount, r.sgst_amount, r.igst_amount, r.total_gst
    ]);
    exportCSV(`GST_Rate_Summary_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6 pb-12 font-sans">
      
      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm print:hidden">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Percent className="w-7 h-7 text-teal-600" />
            GST & Tax Reporting Module
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Read-only statutory tax register, GSTR preparation data, rate analysis & customer summaries
          </p>
        </div>

        {/* DATE RANGE CONTROLS */}
        <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs">
          <Calendar className="w-4 h-4 text-teal-600" />
          <span className="font-bold text-slate-700">Period:</span>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-semibold text-slate-900"
            placeholder="From Date"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-semibold text-slate-900"
            placeholder="To Date"
          />
          {(fromDate || toDate) && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); }}
              className="text-xs font-bold text-teal-600 hover:underline px-1"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium flex items-center gap-2 print:hidden">
          <AlertCircle className="w-4 h-4 text-red-600" />
          {error}
        </div>
      )}

      {/* GST DASHBOARD METRIC TILES */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 print:hidden">
        
        {/* Total Taxable Value */}
        <div className="bg-slate-900 text-white p-3.5 rounded-2xl shadow-sm border border-slate-800 col-span-2 sm:col-span-1 lg:col-span-2">
          <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Total Taxable Value</div>
          <div className="text-xl font-black font-mono mt-1 text-teal-400">
            ₹{summary?.total_taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">Across {summary?.taxable_invoice_count || 0} issued invoices</div>
        </div>

        {/* CGST */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">CGST (Intra-State)</div>
          <div className="text-base font-bold font-mono text-slate-900 mt-1">
            ₹{summary?.total_cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>

        {/* SGST */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">SGST (Intra-State)</div>
          <div className="text-base font-bold font-mono text-slate-900 mt-1">
            ₹{summary?.total_sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>

        {/* IGST */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">IGST (Inter-State)</div>
          <div className="text-base font-bold font-mono text-slate-900 mt-1">
            ₹{summary?.total_igst.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>

        {/* Total GST */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">Total GST Tax</div>
          <div className="text-base font-bold font-mono text-teal-800 mt-1">
            ₹{summary?.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>

        {/* Total Invoice Value */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Total Invoice Value</div>
          <div className="text-base font-bold font-mono text-indigo-900 mt-1">
            ₹{summary?.total_invoice_value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>

      </div>

      {/* REPORT TABS & CONTROLS CONTAINER */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:border-none print:shadow-none">
        
        {/* TAB NAVIGATION */}
        <div className="p-3 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-3 print:hidden">
          
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-200/60 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('OVERVIEW')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'OVERVIEW' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('INVOICES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'INVOICES' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Invoice GST Register ({filteredInvoices.length})
            </button>
            <button
              onClick={() => setActiveTab('CUSTOMERS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'CUSTOMERS' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Customer GST ({filteredCustomers.length})
            </button>
            <button
              onClick={() => setActiveTab('SUMMARY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'SUMMARY' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tax Summary
            </button>
            <button
              onClick={() => setActiveTab('MONTHLY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'MONTHLY' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly Breakdown ({monthlyRows.length})
            </button>
            <button
              onClick={() => setActiveTab('RATES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'RATES' ? 'bg-white text-teal-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              GST Rates ({filteredRates.length})
            </button>
          </div>

          {/* SEARCH & FILTERS */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Invoice / Customer..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-xl text-xs font-medium w-44 sm:w-52"
              />
            </div>

            {activeTab === 'INVOICES' && (
              <select
                value={gstTypeFilter}
                onChange={e => setGstTypeFilter(e.target.value)}
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
              >
                <option value="">All GST Types</option>
                <option value="INTRA_STATE">Intra-State (CGST+SGST)</option>
                <option value="INTER_STATE">Inter-State (IGST)</option>
              </select>
            )}

            <button
              onClick={() => window.print()}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
          </div>
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'OVERVIEW' && (
          <div className="p-6 space-y-6">
            
            {/* CURRENT MONTH STATS CARD */}
            <div className="bg-gradient-to-r from-teal-900 to-slate-900 text-white p-5 rounded-2xl shadow-sm border border-teal-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold text-teal-300 uppercase tracking-wider">Current Month Performance</span>
                <h3 className="text-xl font-bold mt-1">Live GST Tax Collection</h3>
              </div>
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <div className="text-[10px] text-teal-200">Taxable Value</div>
                  <div className="text-base font-black font-mono text-white">₹{summary?.current_month_taxable_value.toLocaleString('en-IN') || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] text-teal-200">Total GST</div>
                  <div className="text-base font-black font-mono text-teal-300">₹{summary?.current_month_gst.toLocaleString('en-IN') || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] text-teal-200">Invoice Total</div>
                  <div className="text-base font-black font-mono text-white">₹{summary?.current_month_invoice_value.toLocaleString('en-IN') || 0}</div>
                </div>
              </div>
            </div>

            {/* QUICK PREVIEW TABLES */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Intra vs Inter-State Quick Breakdown */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Place of Supply Breakdown</h4>
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 block">Intra-State (CGST + SGST)</span>
                      <span className="text-[10px] text-slate-500">{taxSummary?.by_gst_type.intra_state.invoice_count || 0} Invoices</span>
                    </div>
                    <div className="text-right font-mono font-bold text-slate-900">
                      ₹{taxSummary?.by_gst_type.intra_state.total_gst.toLocaleString('en-IN') || 0} GST
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 block">Inter-State (IGST)</span>
                      <span className="text-[10px] text-slate-500">{taxSummary?.by_gst_type.inter_state.invoice_count || 0} Invoices</span>
                    </div>
                    <div className="text-right font-mono font-bold text-slate-900">
                      ₹{taxSummary?.by_gst_type.inter_state.total_gst.toLocaleString('en-IN') || 0} GST
                    </div>
                  </div>
                </div>
              </div>

              {/* Rate Wise Quick Breakdown */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">GST Rate Breakdown</h4>
                <div className="space-y-2 text-xs">
                  {rateRows.map(r => (
                    <div key={r.gst_rate} className="p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between font-mono">
                      <div>
                        <span className="font-bold font-sans text-slate-900">{r.gst_rate}% GST Rate</span>
                        <span className="text-[10px] text-slate-500 font-sans block">{r.line_count} Invoice Line Items</span>
                      </div>
                      <div className="text-right font-bold text-teal-800">
                        ₹{r.total_gst.toLocaleString('en-IN')} GST
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: INVOICE GST REGISTER */}
        {activeTab === 'INVOICES' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between print:hidden">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Invoice-wise Statutory GST Register
              </h3>
              <button
                onClick={handleExportInvoicesCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3">Invoice #</th>
                    <th className="p-3">Invoice Date</th>
                    <th className="p-3">Customer & GSTIN</th>
                    <th className="p-3 text-center">Type</th>
                    <th className="p-3 text-right">Taxable (₹)</th>
                    <th className="p-3 text-right">CGST (₹)</th>
                    <th className="p-3 text-right">SGST (₹)</th>
                    <th className="p-3 text-right">IGST (₹)</th>
                    <th className="p-3 text-right">Total GST (₹)</th>
                    <th className="p-3 text-right">Invoice Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map(inv => (
                    <tr key={inv.invoice_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">{inv.invoice_date}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{inv.customer_name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{inv.customer_gstin}</div>
                      </td>
                      <td className="p-3 text-center font-semibold">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          inv.gst_type === 'INTRA_STATE' ? 'bg-teal-100 text-teal-800' : 'bg-purple-100 text-purple-800'
                        }`}>
                          {inv.gst_type}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-800 font-medium">₹{inv.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-600">₹{inv.cgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-600">₹{inv.sgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-600">₹{inv.igst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-teal-800">₹{inv.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">₹{inv.invoice_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: CUSTOMER GST REPORT */}
        {activeTab === 'CUSTOMERS' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between print:hidden">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Customer-wise GST Aggregation Report
              </h3>
              <button
                onClick={handleExportCustomersCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3">Customer & GSTIN</th>
                    <th className="p-3 text-center">Invoices</th>
                    <th className="p-3 text-right">Taxable Value (₹)</th>
                    <th className="p-3 text-right">CGST (₹)</th>
                    <th className="p-3 text-right">SGST (₹)</th>
                    <th className="p-3 text-right">IGST (₹)</th>
                    <th className="p-3 text-right">Total GST (₹)</th>
                    <th className="p-3 text-right">Invoice Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map(c => (
                    <tr key={c.customer_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-slate-900">{c.customer_name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{c.customer_code} | GSTIN: {c.customer_gstin}</div>
                      </td>
                      <td className="p-3 text-center font-bold font-mono text-slate-700">{c.invoice_count}</td>
                      <td className="p-3 text-right font-mono font-medium text-slate-800">₹{c.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-600">₹{c.cgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-600">₹{c.sgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono text-slate-600">₹{c.igst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-teal-800">₹{c.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">₹{c.invoice_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: TAX SUMMARY */}
        {activeTab === 'SUMMARY' && taxSummary && (
          <div className="p-5 space-y-6">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider print:hidden">
              Comprehensive GST Tax Summary Breakdown
            </h3>

            {/* OVERALL GRAND TOTALS CARD */}
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
              <h4 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2">Overall Tax Totals</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-center">
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500">TAXABLE VALUE</div>
                  <div className="font-mono font-bold text-slate-900 mt-1">₹{taxSummary.overall.taxable_value.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500">CGST</div>
                  <div className="font-mono font-bold text-slate-900 mt-1">₹{taxSummary.overall.cgst_amount.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500">SGST</div>
                  <div className="font-mono font-bold text-slate-900 mt-1">₹{taxSummary.overall.sgst_amount.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500">IGST</div>
                  <div className="font-mono font-bold text-slate-900 mt-1">₹{taxSummary.overall.igst_amount.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg">
                  <div className="text-[10px] font-bold text-teal-800">TOTAL GST</div>
                  <div className="font-mono font-bold text-teal-900 mt-1">₹{taxSummary.overall.total_gst.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-3 bg-indigo-900 text-white rounded-lg">
                  <div className="text-[10px] font-bold text-indigo-200">GRAND TOTAL</div>
                  <div className="font-mono font-bold mt-1">₹{taxSummary.overall.grand_total.toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            {/* INTRA VS INTER STATE BREAKDOWN TABLE */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3">GST Classification Type</th>
                    <th className="p-3 text-center">Invoices</th>
                    <th className="p-3 text-right">Taxable Value (₹)</th>
                    <th className="p-3 text-right">CGST (₹)</th>
                    <th className="p-3 text-right">SGST (₹)</th>
                    <th className="p-3 text-right">IGST (₹)</th>
                    <th className="p-3 text-right">Total GST (₹)</th>
                    <th className="p-3 text-right">Invoice Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-900">Intra-State (Local Supply: CGST + SGST)</td>
                    <td className="p-3 text-center font-sans font-bold">{taxSummary.by_gst_type.intra_state.invoice_count}</td>
                    <td className="p-3 text-right">₹{taxSummary.by_gst_type.intra_state.taxable_value.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right">₹{taxSummary.by_gst_type.intra_state.cgst_amount.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right">₹{taxSummary.by_gst_type.intra_state.sgst_amount.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right text-slate-400">₹0.00</td>
                    <td className="p-3 text-right font-bold text-teal-800">₹{taxSummary.by_gst_type.intra_state.total_gst.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right font-bold text-slate-900">₹{taxSummary.by_gst_type.intra_state.invoice_value.toLocaleString('en-IN')}</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-sans font-bold text-slate-900">Inter-State (Out-of-State Supply: IGST)</td>
                    <td className="p-3 text-center font-sans font-bold">{taxSummary.by_gst_type.inter_state.invoice_count}</td>
                    <td className="p-3 text-right">₹{taxSummary.by_gst_type.inter_state.taxable_value.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right text-slate-400">₹0.00</td>
                    <td className="p-3 text-right text-slate-400">₹0.00</td>
                    <td className="p-3 text-right font-bold text-purple-800">₹{taxSummary.by_gst_type.inter_state.igst_amount.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right font-bold text-teal-800">₹{taxSummary.by_gst_type.inter_state.total_gst.toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right font-bold text-slate-900">₹{taxSummary.by_gst_type.inter_state.invoice_value.toLocaleString('en-IN')}</td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* TAB 5: MONTHLY GST BREAKDOWN */}
        {activeTab === 'MONTHLY' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between print:hidden">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Monthly GST Collection & Tax Liability Breakdown
              </h3>
              <button
                onClick={handleExportMonthlyCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3">Month (YYYY-MM)</th>
                    <th className="p-3 text-center">Invoices</th>
                    <th className="p-3 text-right">Taxable Value (₹)</th>
                    <th className="p-3 text-right">CGST (₹)</th>
                    <th className="p-3 text-right">SGST (₹)</th>
                    <th className="p-3 text-right">IGST (₹)</th>
                    <th className="p-3 text-right">Total GST (₹)</th>
                    <th className="p-3 text-right">Total Invoice Value (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {monthlyRows.map(m => (
                    <tr key={m.month} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-sans font-bold text-slate-900">{m.month}</td>
                      <td className="p-3 text-center font-sans font-bold text-slate-700">{m.invoice_count}</td>
                      <td className="p-3 text-right">₹{m.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right text-slate-600">₹{m.cgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right text-slate-600">₹{m.sgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right text-slate-600">₹{m.igst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-bold text-teal-800">₹{m.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-bold text-slate-900 text-sm">₹{m.invoice_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: GST RATE BREAKDOWN */}
        {activeTab === 'RATES' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between print:hidden">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                GST Tax Rate Summary Report
              </h3>
              <button
                onClick={handleExportRatesCSV}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3">GST Rate (%)</th>
                    <th className="p-3 text-center">Invoice Line Items</th>
                    <th className="p-3 text-right">Taxable Value (₹)</th>
                    <th className="p-3 text-right">CGST (₹)</th>
                    <th className="p-3 text-right">SGST (₹)</th>
                    <th className="p-3 text-right">IGST (₹)</th>
                    <th className="p-3 text-right">Total GST Tax (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredRates.map(r => (
                    <tr key={r.gst_rate} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-sans font-bold text-slate-900 text-sm">{r.gst_rate}% GST</td>
                      <td className="p-3 text-center font-sans font-bold text-slate-700">{r.line_count}</td>
                      <td className="p-3 text-right">₹{r.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right text-slate-600">₹{r.cgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right text-slate-600">₹{r.sgst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right text-slate-600">₹{r.igst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-bold text-teal-800 text-sm">₹{r.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
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
