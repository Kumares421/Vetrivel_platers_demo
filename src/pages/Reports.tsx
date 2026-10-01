import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Printer, Download, Filter, Calendar, FileText, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { QuantityBadge } from '../components/QuantityBadge';
import { useAuth } from '../context/AuthContext';

export const Reports: React.FC = () => {
  const { user } = useAuth();
  const [activeReportTab, setActiveReportTab] = useState<'ledger' | 'inward' | 'issue' | 'alerts'>('ledger');

  const [chemicals, setChemicals] = useState<any[]>([]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedChemicalId, setSelectedChemicalId] = useState('');

  // Report Data
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [inwardRows, setInwardRows] = useState<any[]>([]);
  const [issueRows, setIssueRows] = useState<any[]>([]);
  const [alertsData, setAlertsData] = useState<any>({ low_stock_chemicals: [], expiring_lots: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadChemicals() {
      try {
        const res = await apiFetch<any[]>('/chemicals');
        setChemicals(res);
      } catch (err) {
        console.error('Failed to load chemicals for report:', err);
      }
    }
    loadChemicals();
  }, []);

  const fetchReportData = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeReportTab === 'ledger') {
        let url = `/reports/ledger?from_date=${startDate}&to_date=${endDate}`;
        if (selectedChemicalId) url += `&chemical_id=${selectedChemicalId}`;
        const res = await apiFetch<any>(url);
        const rows = Array.isArray(res) ? res : (res.entries || []);
        setLedgerRows(rows);
      } else if (activeReportTab === 'inward') {
        let url = `/reports/inward?from_date=${startDate}&to_date=${endDate}`;
        if (selectedChemicalId) url += `&chemical_id=${selectedChemicalId}`;
        const res = await apiFetch<any>(url);
        const rows = Array.isArray(res) ? res : (res.rows || []);
        setInwardRows(rows);
      } else if (activeReportTab === 'issue') {
        let url = `/reports/issues?from_date=${startDate}&to_date=${endDate}`;
        if (selectedChemicalId) url += `&chemical_id=${selectedChemicalId}`;
        const res = await apiFetch<any>(url);
        const rows = Array.isArray(res) ? res : (res.rows || []);
        setIssueRows(rows);
      } else if (activeReportTab === 'alerts') {
        const res = await apiFetch<any>('/reports/low-stock-expiry');
        const lowStock = res?.low_stock_chemicals || res?.low_stock_items || [];
        const expiring = res?.expiring_lots || [];
        setAlertsData({ low_stock_chemicals: lowStock, expiring_lots: expiring });
      }
    } catch (err: any) {
      console.error('Failed to fetch report:', err);
      setError(err.message || 'Failed to load report data from server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [activeReportTab, startDate, endDate, selectedChemicalId]);

  const handleExportCSV = () => {
    if (loading || error) {
      alert('Cannot export report: Report data failed to load or is currently loading. Please retry fetching report data first.');
      return;
    }

    let filename = `vetrivel_${activeReportTab}_report_${startDate}_to_${endDate}.csv`;
    let headers: string[] = [];
    let rows: any[] = [];

    if (activeReportTab === 'ledger') {
      headers = ['Chemical Code', 'Chemical Name', 'Unit', 'Opening Stock', 'Total Received', 'Total Issued', 'Adjustments', 'Closing Stock'];
      rows = ledgerRows.map(r => [
        r.chemical_code,
        `"${r.chemical_name}"`,
        r.base_unit,
        r.opening_stock ?? r.opening_balance ?? 0,
        r.total_received ?? r.total_receipts ?? 0,
        r.total_issued ?? r.total_issues ?? 0,
        r.total_adjustments ?? r.net_adjustments ?? 0,
        r.closing_stock ?? r.closing_balance ?? 0
      ]);
    } else if (activeReportTab === 'inward') {
      headers = ['Lot Number', 'Receipt Date', 'Chemical', 'Supplier', 'Bill No', 'Qty', 'Unit', 'Rate', 'Amount'];
      rows = inwardRows.map(r => [
        r.lot_number,
        r.actual_received_at ? r.actual_received_at.slice(0, 10) : r.received_at ? r.received_at.slice(0, 10) : '',
        `"${r.chemical_name}"`,
        `"${r.supplier_name}"`,
        r.bill_number,
        r.initial_qty,
        r.base_unit,
        r.rate_per_unit,
        r.line_amount
      ]);
    } else if (activeReportTab === 'issue') {
      headers = ['Issue Date', 'Chemical', 'Target Tank', 'Issued Qty', 'Unit', 'Shift', 'Issued By', 'Job Card'];
      rows = issueRows.map(r => [
        r.issue_date ? r.issue_date.slice(0, 10) : '',
        `"${r.chemical_name}"`,
        `"${r.tank_name}"`,
        r.required_qty,
        r.base_unit,
        `"${r.shift || ''}"`,
        `"${r.issued_by_name || ''}"`,
        r.job_card_number
      ]);
    } else if (activeReportTab === 'alerts') {
      const lowStockHeaders = ['Section', 'Chemical Code', 'Chemical Name', 'Unit', 'Available Stock', 'Min Required', 'Shortfall'];
      const lowStockRows = (alertsData.low_stock_chemicals || []).map((c: any) => [
        'Low Stock',
        c.code,
        `"${c.name}"`,
        c.base_unit,
        c.total_available,
        c.min_stock_level,
        // Shortfall = max(minimum - available, 0); 0 when available >= minimum
        c.shortfall ?? (parseFloat(c.total_available) < parseFloat(c.min_stock_level) ? Math.max(0, parseFloat(c.min_stock_level) - parseFloat(c.total_available)) : 0)
      ]);

      const expiringHeaders = ['Section', 'Lot Number', 'Chemical Code', 'Chemical Name', 'Supplier Batch', 'Expiry Date', 'Expiry Status', 'Remaining Qty', 'Unit', 'Lot Status'];
      const expiringRows = (alertsData.expiring_lots || []).map((l: any) => [
        'Expiring/Expired',
        l.lot_number,
        l.chemical_code || '',
        `"${l.chemical_name}"`,
        `"${l.supplier_batch_number}"`,
        l.expiry_date,
        l.expiry_status || (l.is_expired ? 'EXPIRED' : 'EXPIRING_SOON'),
        l.remaining_qty,
        l.base_unit,
        l.status
      ]);

      const csvLines = [
        'LOW STOCK CHEMICALS BELOW MINIMUM STOCK LEVEL (available < minimum)',
        lowStockHeaders.join(','),
        ...lowStockRows.map((e: any) => e.join(',')),
        '',
        'LOTS EXPIRING WITHIN 30 DAYS OR EXPIRED',
        expiringHeaders.join(','),
        ...expiringRows.map((e: any) => e.join(','))
      ];

      const csvContent = 'data:text/csv;charset=utf-8,' + csvLines.join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `vetrivel_low_stock_expiry_report_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    if (loading || error) {
      alert('Cannot print report: Report data failed to load or is currently loading. Please retry fetching report data first.');
      return;
    }
    window.print();
  };

  return (
    <div className="space-y-6">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-7 h-7 text-purple-700" />
            Factory Stock Ledgers & Audit Reports
          </h2>
          <p className="text-slate-500 text-sm">
            Auditable stock movement ledgers (Opening + Inward - Issues ± Adjustments = Closing) with CSV export.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-sm transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl text-sm transition-colors flex items-center gap-2 shadow"
          >
            <Printer className="w-4 h-4" /> Print Report
          </button>
        </div>
      </div>

      {/* Printable Report Branding Header (Visible ONLY during window.print()) */}
      <div className="hidden print:block mb-6 p-4 border-b-2 border-slate-900">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black text-slate-900">VETRIVEL PLATERS</h1>
            <p className="text-sm text-slate-700 font-bold">Chemical Inventory & Stock Ledger Report</p>
            <p className="text-xs text-slate-500">Period: {startDate} to {endDate}</p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div>Report Date: {new Date().toLocaleDateString('en-IN')}</div>
            <div>Generated By: {user?.name} ({user?.role})</div>
            <div className="font-bold text-purple-900 mt-1">Qelanto Factory Manager</div>
          </div>
        </div>
      </div>

      {/* Report Tab Selector & Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4 print:hidden">
        
        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          <button
            onClick={() => setActiveReportTab('ledger')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              activeReportTab === 'ledger' ? 'bg-purple-700 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            Historical Stock Ledger
          </button>
          <button
            onClick={() => setActiveReportTab('inward')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              activeReportTab === 'inward' ? 'bg-purple-700 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            Inward Receipt Register
          </button>
          <button
            onClick={() => setActiveReportTab('issue')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              activeReportTab === 'issue' ? 'bg-purple-700 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            Tank Issue Register
          </button>
          <button
            onClick={() => setActiveReportTab('alerts')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              activeReportTab === 'alerts' ? 'bg-purple-700 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            Low Stock & Expiry Register
          </button>
        </div>

        {/* Date & Chemical Filters */}
        {activeReportTab !== 'alerts' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">From Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">To Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Filter Chemical</label>
              <select
                value={selectedChemicalId}
                onChange={e => setSelectedChemicalId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-purple-500"
              >
                <option value="">All Chemicals</option>
                {chemicals.map(c => (
                  <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-2xl text-sm flex items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
            <div>
              <div className="font-bold">Failed to load report data</div>
              <div className="text-xs text-red-600">{error}</div>
            </div>
          </div>
          <button
            onClick={fetchReportData}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors shrink-0"
          >
            Retry Report
          </button>
        </div>
      )}

      {/* Main Table Display */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        
        {/* Tab 1: Historical Stock Ledger */}
        {activeReportTab === 'ledger' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-4">Chemical Code</th>
                  <th className="p-4">Chemical Name</th>
                  <th className="p-4">Unit</th>
                  <th className="p-4">Opening Stock</th>
                  <th className="p-4 text-teal-700">+ Inward Receipts</th>
                  <th className="p-4 text-slate-900">- Tank Issues</th>
                  <th className="p-4 text-purple-700">± Adjustments</th>
                  <th className="p-4 text-right font-black">Closing Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-400 font-sans">Calculating ledger records...</td>
                  </tr>
                ) : ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-400 font-sans">No stock ledger data for chosen period.</td>
                  </tr>
                ) : (
                  ledgerRows.map(r => (
                    <tr key={r.chemical_id} className="hover:bg-slate-50">
                      <td className="p-4 font-bold text-slate-900">{r.chemical_code}</td>
                      <td className="p-4 font-sans font-semibold text-slate-900">{r.chemical_name}</td>
                      <td className="p-4 uppercase font-bold text-slate-500">{r.base_unit}</td>
                      <td className="p-4 font-sans"><QuantityBadge value={r.opening_stock ?? r.opening_balance ?? 0} unit={r.base_unit} /></td>
                      <td className="p-4 font-sans text-teal-800 font-bold"><QuantityBadge value={r.total_received ?? r.total_receipts ?? 0} unit={r.base_unit} /></td>
                      <td className="p-4 font-sans text-slate-900 font-bold"><QuantityBadge value={r.total_issued ?? r.total_issues ?? 0} unit={r.base_unit} /></td>
                      <td className="p-4 font-sans text-purple-700"><QuantityBadge value={r.total_adjustments ?? r.net_adjustments ?? 0} unit={r.base_unit} /></td>
                      <td className="p-4 text-right font-sans"><QuantityBadge value={r.closing_stock ?? r.closing_balance ?? 0} unit={r.base_unit} bold className="text-slate-900 font-black text-sm" /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Inward Receipt Register */}
        {activeReportTab === 'inward' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-4">Lot Number</th>
                  <th className="p-4">Date</th>
                  <th className="p-4">Chemical</th>
                  <th className="p-4">Supplier</th>
                  <th className="p-4">Invoice / Bill</th>
                  <th className="p-4">Received Qty</th>
                  <th className="p-4">Rate (₹)</th>
                  <th className="p-4 text-right">Line Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-400 font-sans">Loading inward register...</td>
                  </tr>
                ) : inwardRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-400 font-sans">No inward receipt entries found.</td>
                  </tr>
                ) : (
                  inwardRows.map(r => (
                    <tr key={r.lot_id} className="hover:bg-slate-50">
                      <td className="p-4 font-bold text-teal-800">{r.lot_number}</td>
                      <td className="p-4 font-sans text-slate-600">{r.received_at ? r.received_at.slice(0, 10) : 'N/A'}</td>
                      <td className="p-4 font-sans font-semibold text-slate-900">{r.chemical_name}</td>
                      <td className="p-4 font-sans text-slate-700">{r.supplier_name}</td>
                      <td className="p-4 text-slate-700">{r.bill_number || 'OPENING'}</td>
                      <td className="p-4 font-sans"><QuantityBadge value={r.initial_qty} unit={r.base_unit} bold /></td>
                      <td className="p-4 font-sans">₹{parseFloat(r.rate_per_unit || '0').toFixed(2)}</td>
                      <td className="p-4 text-right font-sans font-bold text-slate-900">₹{parseFloat(r.line_amount || '0').toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Tank Issue Register */}
        {activeReportTab === 'issue' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-900 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-4">Issue Date</th>
                  <th className="p-4">Chemical</th>
                  <th className="p-4">Target Tank / Line</th>
                  <th className="p-4">Issued Quantity</th>
                  <th className="p-4">Shift</th>
                  <th className="p-4">Issued By</th>
                  <th className="p-4">Job Card</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400 font-sans">Loading issue register...</td>
                  </tr>
                ) : issueRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400 font-sans">No chemical issues recorded.</td>
                  </tr>
                ) : (
                  issueRows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="p-4 font-sans text-slate-600">{r.issue_date ? r.issue_date.slice(0, 10) : 'N/A'}</td>
                      <td className="p-4 font-sans font-semibold text-slate-900">{r.chemical_name}</td>
                      <td className="p-4 font-sans text-slate-900 font-bold">{r.tank_name}</td>
                      <td className="p-4 font-sans"><QuantityBadge value={r.required_qty} unit={r.base_unit} bold className="text-slate-900" /></td>
                      <td className="p-4 font-sans text-slate-600">{r.shift}</td>
                      <td className="p-4 font-sans text-slate-700">{r.issued_by_name}</td>
                      <td className="p-4 text-slate-700">{r.job_card_number || 'N/A'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Low Stock & Expiry Alerts Register */}
        {activeReportTab === 'alerts' && (
          <div className="p-6 space-y-6">
            {loading ? (
              <div className="p-12 text-center text-slate-400 font-sans">
                Loading low stock and expiry alert register...
              </div>
            ) : error ? (
              <div className="p-6 bg-red-50 text-red-800 border border-red-200 rounded-2xl space-y-3 print:hidden">
                <div className="flex items-center gap-3 font-bold text-base">
                  <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
                  Failed to load Low Stock & Expiry Alert Register
                </div>
                <p className="text-xs text-red-700 font-mono">{error}</p>
                <div>
                  <button
                    onClick={fetchReportData}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm transition-colors shadow"
                  >
                    Retry Loading Alerts
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Low Stock Table */}
                <div>
                  <h3 className="text-base font-bold text-amber-900 flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    Chemicals Below Minimum Threshold ({alertsData.low_stock_chemicals.length})
                  </h3>
                  <div className="border border-amber-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-amber-50 text-amber-900 font-bold border-b border-amber-200">
                        <tr>
                          <th className="p-3">Code</th>
                          <th className="p-3">Chemical Name</th>
                          <th className="p-3">Available Stock</th>
                          <th className="p-3">Min Required</th>
                          <th className="p-3">Shortfall</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 text-xs">
                        {alertsData.low_stock_chemicals.length === 0 ? (
                          <tr><td colSpan={5} className="p-4 text-center text-slate-400">No chemicals below minimum stock level.</td></tr>
                        ) : (
                          alertsData.low_stock_chemicals.map((c: any) => (
                            <tr key={c.id}>
                              <td className="p-3 font-mono font-bold">{c.code}</td>
                              <td className="p-3 font-semibold">{c.name}</td>
                              <td className="p-3 font-bold text-amber-700"><QuantityBadge value={c.total_available} unit={c.base_unit} /></td>
                              <td className="p-3"><QuantityBadge value={c.min_stock_level} unit={c.base_unit} /></td>
                              <td className="p-3 font-bold text-red-700">
                                <QuantityBadge value={c.shortfall ?? Math.max(0, parseFloat(c.min_stock_level) - parseFloat(c.total_available))} unit={c.base_unit} />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Expiring Lots Table */}
                <div>
                  <h3 className="text-base font-bold text-red-900 flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    Lots Expiring Within 30 Days / Expired ({alertsData.expiring_lots.length})
                  </h3>
                  <div className="border border-red-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-red-50 text-red-900 font-bold border-b border-red-200">
                        <tr>
                          <th className="p-3">Lot No.</th>
                          <th className="p-3">Chemical Name</th>
                          <th className="p-3">Supplier Batch</th>
                          <th className="p-3">Expiry Date</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Remaining Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-100 text-xs font-mono">
                        {alertsData.expiring_lots.length === 0 ? (
                          <tr><td colSpan={6} className="p-4 text-center text-slate-400">No expiring stock lots detected.</td></tr>
                        ) : (
                          alertsData.expiring_lots.map((l: any) => (
                            <tr key={l.id}>
                              <td className="p-3 font-bold text-red-800">{l.lot_number}</td>
                              <td className="p-3 font-sans font-semibold">{l.chemical_name}</td>
                              <td className="p-3">{l.supplier_batch_number}</td>
                              <td className="p-3 font-sans font-bold text-red-700">{l.expiry_date}</td>
                              <td className="p-3 font-sans">
                                {l.is_expired || l.expiry_status === 'EXPIRED' ? (
                                  <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[10px]">EXPIRED</span>
                                ) : l.status === 'QUARANTINED' ? (
                                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-[10px]">QUARANTINED</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-[10px]">EXPIRING SOON</span>
                                )}
                              </td>
                              <td className="p-3 text-right font-sans"><QuantityBadge value={l.remaining_qty} unit={l.base_unit} bold /></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>

    </div>
  );
};
