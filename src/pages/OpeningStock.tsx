import React, { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SearchableSelect, Option } from '../components/SearchableSelect';

export const OpeningStock: React.FC = () => {
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('Initial physical count setup');
  
  const [lines, setLines] = useState<any[]>([
    { chemical_id: '', supplier_batch_number: 'OPENING-BATCH-01', initial_qty: '', rate_per_unit: '0', location: 'MAIN-STORE' }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await apiFetch<any[]>('/chemicals');
        setChemicals(res.filter(c => c.is_active));
      } catch (err) {
        console.error('Failed to load chemicals:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const chemicalOptions: Option[] = chemicals.map(c => ({
    value: c.id,
    label: `${c.code} - ${c.name}`,
    sublabel: `Base Unit: ${c.base_unit}`,
  }));

  const handleAddLine = () => {
    setLines([
      ...lines,
      { chemical_id: '', supplier_batch_number: `OPENING-BATCH-0${lines.length + 1}`, initial_qty: '', rate_per_unit: '0', location: 'MAIN-STORE' }
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length === 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: string, val: any) => {
    const updated = [...lines];
    updated[idx][field] = val;
    setLines(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (lines.some(l => !l.chemical_id || !l.initial_qty || parseFloat(l.initial_qty) <= 0)) {
      setStatusMessage({ type: 'error', text: 'Please fill out all chemical items and valid opening quantities.' });
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/opening-stock', {
        method: 'POST',
        body: JSON.stringify({
          as_of_date: asOfDate,
          remarks,
          lines: lines.map(l => ({
            chemical_id: l.chemical_id,
            supplier_batch_number: l.supplier_batch_number || 'OPENING-BATCH',
            initial_qty: parseFloat(l.initial_qty),
            rate_per_unit: parseFloat(l.rate_per_unit) || 0,
            location: l.location || 'MAIN-STORE'
          }))
        })
      });

      setStatusMessage({ type: 'success', text: 'Opening stock lots posted to inventory successfully!' });
      setLines([{ chemical_id: '', supplier_batch_number: 'OPENING-BATCH-01', initial_qty: '', rate_per_unit: '0', location: 'MAIN-STORE' }]);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to post opening stock' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-7 h-7 text-teal-600" />
            Opening Physical Stock Onboarding
          </h2>
          <p className="text-slate-500 text-sm">
            Initial setup wizard for existing chemical balances in stores prior to daily transactions.
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

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Opening Count As-Of Date</label>
            <input
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Stock Take Notes</label>
            <input
              type="text"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="e.g. Initial onboarding audit count"
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Physical Stock Count Items</h3>
            <button
              type="button"
              onClick={handleAddLine}
              className="px-3 py-1.5 bg-teal-50 text-teal-700 text-xs font-bold rounded-lg hover:bg-teal-100 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add Item Line
            </button>
          </div>

          {lines.map((l, idx) => {
            const chem = chemicals.find(c => c.id === l.chemical_id);
            const unit = chem ? chem.base_unit : '';

            return (
              <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 relative">
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(idx)}
                    className="absolute top-3 right-3 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <SearchableSelect
                    label={`Chemical #${idx + 1}`}
                    required
                    options={chemicalOptions}
                    value={l.chemical_id}
                    onChange={val => handleLineChange(idx, 'chemical_id', val)}
                    placeholder="Select Chemical..."
                  />

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1">
                      Counted Qty {unit && <span className="text-teal-700 font-bold">({unit})</span>} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0.0001"
                      required
                      value={l.initial_qty}
                      onChange={e => handleLineChange(idx, 'initial_qty', e.target.value)}
                      placeholder="Physical quantity"
                      className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-bold focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1">Batch Ref / Lot Code</label>
                    <input
                      type="text"
                      value={l.supplier_batch_number}
                      onChange={e => handleLineChange(idx, 'supplier_batch_number', e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow transition-colors disabled:opacity-50"
          >
            {submitting ? 'Posting Opening Stock...' : 'Confirm & Post Opening Stock'}
          </button>
        </div>
      </form>
    </div>
  );
};
