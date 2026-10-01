import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ArrowDownToLine, FileText, Upload, CheckCircle2, Save, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SearchableSelect, Option } from '../components/SearchableSelect';
import { QuantityBadge } from '../components/QuantityBadge';

export const ReceiveChemical: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper to format local date for datetime-local input
  const getNowLocalISO = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    return localISOTime;
  };

  // Form Header
  const [supplierId, setSupplierId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [actualReceivedAt, setActualReceivedAt] = useState(getNowLocalISO());
  const [deliveryChallanNumber, setDeliveryChallanNumber] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Multi-line Items
  const [lines, setLines] = useState<any[]>([
    {
      chemical_id: '',
      supplier_batch_number: '',
      received_qty: '',
      rate_per_unit: '0',
      location: 'MAIN-STORE-RACK-01',
      expiry_date: '',
    }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function initData() {
      try {
        const suppRes = await apiFetch<any[]>('/suppliers');
        setSuppliers(suppRes.filter(s => s.is_active).map(s => ({
          value: s.id,
          label: s.name,
          sublabel: s.contact_details
        })));

        const chemRes = await apiFetch<any[]>('/chemicals');
        setChemicals(chemRes.filter(c => c.is_active));
      } catch (err) {
        console.error('Failed to load receipt form data:', err);
      } finally {
        setLoading(false);
      }
    }
    initData();
  }, []);

  const chemicalOptions: Option[] = chemicals.map(c => ({
    value: c.id,
    label: `${c.code} - ${c.name}`,
    sublabel: `Base Unit: ${c.base_unit}`,
  }));

  const handleAddLine = () => {
    setLines([
      ...lines,
      {
        chemical_id: '',
        supplier_batch_number: '',
        received_qty: '',
        rate_per_unit: '0',
        location: 'MAIN-STORE-RACK-01',
        expiry_date: '',
      }
    ]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length === 1) return;
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const updated = [...lines];
    updated[index][field] = value;
    setLines(updated);
  };

  const handleSubmit = async (postDirectly: boolean) => {
    setStatusMessage(null);

    if (!supplierId) {
      setStatusMessage({ type: 'error', text: 'Please select a chemical supplier' });
      return;
    }
    if (!billNumber.trim()) {
      setStatusMessage({ type: 'error', text: 'Please enter the Invoice / Bill Number' });
      return;
    }
    if (!billDate) {
      setStatusMessage({ type: 'error', text: 'Please select the Bill Date' });
      return;
    }
    if (!actualReceivedAt) {
      setStatusMessage({ type: 'error', text: 'Please select the Actual Received Date & Time' });
      return;
    }
    if (new Date(actualReceivedAt) > new Date()) {
      setStatusMessage({ type: 'error', text: 'Actual Received Date & Time cannot be in the future' });
      return;
    }

    if (lines.some(l => !l.chemical_id || !l.supplier_batch_number || !l.received_qty)) {
      setStatusMessage({ type: 'error', text: 'Please fill out all chemical lines, batch numbers, and received quantities' });
      return;
    }

    setSubmitting(true);

    try {
      // 1. Post/Save Purchase Receipt Payload (matches backend expected keys)
      const payload = {
        supplier_id: supplierId,
        bill_number: billNumber.trim(),
        bill_date: billDate,
        actual_received_at: actualReceivedAt,
        delivery_challan_number: deliveryChallanNumber.trim() || null,
        notes: remarks.trim() || null,
        lines: lines.map(l => ({
          chemical_id: l.chemical_id,
          supplier_batch_number: l.supplier_batch_number.trim(),
          received_qty: parseFloat(l.received_qty) || 0,
          rate_per_unit: parseFloat(l.rate_per_unit) || 0,
          location: l.location ? l.location.trim() : null,
          expiry_date: l.expiry_date || null,
        })),
        status: postDirectly ? 'POSTED' : 'DRAFT'
      };

      const res = await apiFetch<{ id: string; message: string }>('/receipts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const receiptId = res.id;

      // 2. Upload attachment if attached
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('parent_type', 'PURCHASE_RECEIPT');
        formData.append('parent_id', receiptId);

        await apiFetch('/attachments/upload', {
          method: 'POST',
          body: formData,
        });
      }

      setStatusMessage({
        type: 'success',
        text: postDirectly
          ? 'Purchase Receipt posted successfully! Stock & traceable lots generated.'
          : 'Purchase Receipt saved as Draft for review.'
      });

      // Reset form
      setSupplierId('');
      setBillNumber('');
      setBillDate(new Date().toISOString().slice(0, 10));
      setActualReceivedAt(getNowLocalISO());
      setDeliveryChallanNumber('');
      setRemarks('');
      setSelectedFile(null);
      setLines([{ chemical_id: '', supplier_batch_number: '', received_qty: '', rate_per_unit: '0', location: 'MAIN-STORE-RACK-01', expiry_date: '' }]);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to submit receipt' });
    } finally {
      setSubmitting(false);
    }
  };

  const calculateTotalAmount = () => {
    return lines.reduce((sum, l) => {
      const qty = parseFloat(l.received_qty) || 0;
      const rate = parseFloat(l.rate_per_unit) || 0;
      return sum + (qty * rate);
    }, 0);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ArrowDownToLine className="w-7 h-7 text-teal-600" />
            Receive Chemical (Inward Stock Entry)
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            Record incoming chemical shipments, supplier batch IDs, and generate traceable inventory lots.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div className={`p-4 rounded-xl text-sm font-semibold flex items-center gap-3 shadow-sm ${
          statusMessage.type === 'success' ? 'bg-teal-50 border border-teal-200 text-teal-900' : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {statusMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Primary Inward Form */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        
        <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">1. Invoice & Supplier Details</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <SearchableSelect
            label="Supplier"
            required
            options={suppliers}
            value={supplierId}
            onChange={setSupplierId}
            placeholder="Select Chemical Supplier..."
          />

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Invoice / Bill Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={billNumber}
              onChange={e => setBillNumber(e.target.value)}
              placeholder="e.g. INV-2026-8891"
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono font-bold focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Bill Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={billDate}
              onChange={e => setBillDate(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Actual Received Date & Time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              required
              max={getNowLocalISO()}
              value={actualReceivedAt}
              onChange={e => setActualReceivedAt(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Delivery Challan Number (Optional)</label>
            <input
              type="text"
              value={deliveryChallanNumber}
              onChange={e => setDeliveryChallanNumber(e.target.value)}
              placeholder="e.g. DC-2026-99"
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Received By (Storekeeper Name)</label>
            <input
              type="text"
              value={receivedBy}
              onChange={e => setReceivedBy(e.target.value)}
              placeholder="Storekeeper Staff Name"
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Invoice / Delivery Challan Attachment (Optional, Max 10MB PDF/Image)</label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
              />
            </div>
          </div>
        </div>

        {/* Lines Section */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-slate-900">2. Chemicals & Batch Lots Received</h3>
            <button
              type="button"
              onClick={handleAddLine}
              className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add Item Line
            </button>
          </div>

          <div className="space-y-4">
            {lines.map((line, idx) => {
              const selectedChem = chemicals.find(c => c.id === line.chemical_id);
              const unit = selectedChem ? selectedChem.base_unit : '';

              return (
                <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl relative space-y-3">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      className="absolute top-3 right-3 p-1 text-slate-400 hover:text-red-600 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <SearchableSelect
                      label={`Chemical #${idx + 1}`}
                      required
                      options={chemicalOptions}
                      value={line.chemical_id}
                      onChange={val => handleLineChange(idx, 'chemical_id', val)}
                      placeholder="Select Chemical..."
                    />

                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-1">
                        Supplier Batch / Lot No. <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={line.supplier_batch_number}
                        onChange={e => handleLineChange(idx, 'supplier_batch_number', e.target.value)}
                        placeholder="e.g. BATCH-2026-X1"
                        className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-1">
                        Received Qty {unit && <span className="text-teal-700 font-bold">({unit})</span>} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        required
                        value={line.received_qty}
                        onChange={e => handleLineChange(idx, 'received_qty', e.target.value)}
                        placeholder="Quantity"
                        className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-bold focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Rate per Unit (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.rate_per_unit}
                        onChange={e => handleLineChange(idx, 'rate_per_unit', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Storage Location Rack/Bay</label>
                      <input
                        type="text"
                        value={line.location}
                        onChange={e => handleLineChange(idx, 'location', e.target.value)}
                        placeholder="MAIN-STORE-RACK-01"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Expiry Date (If Applicable)</label>
                      <input
                        type="date"
                        value={line.expiry_date}
                        onChange={e => handleLineChange(idx, 'expiry_date', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                      />
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>

        {/* Total Summary */}
        <div className="p-4 bg-slate-900 text-white rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs uppercase font-bold text-teal-400">Total Purchase Value</span>
            <div className="text-2xl font-black">₹ {calculateTotalAmount().toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="text-xs text-slate-400 text-right">
            <div>Lines Count: {lines.length}</div>
            <div>Strict Batch FIFO Enforced</div>
          </div>
        </div>

        {/* Form Action Buttons */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSubmit(false)}
            className="w-full sm:w-auto px-5 py-3 border border-slate-300 text-slate-800 font-semibold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5 text-slate-500" />
            <span>Save as Draft</span>
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => handleSubmit(true)}
            className="w-full sm:w-auto px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{submitting ? 'Posting Receipt...' : 'Post Inward Receipt to Stock'}</span>
          </button>
        </div>

      </div>

    </div>
  );
};
