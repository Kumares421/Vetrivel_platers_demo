import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ArrowUpFromLine, AlertTriangle, CheckCircle2, ShieldAlert, Clock, Boxes, Layers } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SearchableSelect, Option } from '../components/SearchableSelect';
import { QuantityBadge } from '../components/QuantityBadge';
import { StatusBadge } from '../components/StatusBadge';

export const IssueChemical: React.FC = () => {
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [tanks, setTanks] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [chemicalId, setChemicalId] = useState('');
  const [tankId, setTankId] = useState('');
  const [requiredQty, setRequiredQty] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [jobCardNumber, setJobCardNumber] = useState('');
  const [shift, setShift] = useState('Day Shift (8 AM - 4 PM)');
  const [remarks, setRemarks] = useState('');
  const [adminOverrideReason, setAdminOverrideReason] = useState('');

  // FIFO Preview state
  const [fifoProposal, setFifoProposal] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewSeq, setPreviewSeq] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string; issueId?: string } | null>(null);

  useEffect(() => {
    async function initData() {
      try {
        const chemRes = await apiFetch<any[]>('/chemicals');
        setChemicals(chemRes.filter(c => c.is_active));

        const tankRes = await apiFetch<any[]>('/tanks');
        setTanks(tankRes.filter(t => t.is_active).map(t => ({
          value: t.id,
          label: `${t.code} - ${t.display_name}`,
        })));
      } catch (err) {
        console.error('Failed to load issue form data:', err);
      } finally {
        setLoading(false);
      }
    }
    initData();
  }, []);

  // Stale chemical or tank selection invalidation effect
  useEffect(() => {
    if (chemicalId && chemicals.length > 0 && !chemicals.some(c => c.id === chemicalId)) {
      setChemicalId('');
      setFifoProposal(null);
    }
  }, [chemicals, chemicalId]);

  useEffect(() => {
    if (tankId && tanks.length > 0 && !tanks.some(t => t.value === tankId)) {
      setTankId('');
    }
  }, [tanks, tankId]);

  const selectedChemical = chemicals.find(c => c.id === chemicalId);
  const chemicalOptions: Option[] = chemicals.map(c => ({
    value: c.id,
    label: `${c.code} - ${c.name}`,
    sublabel: `Available Stock: ${parseFloat(c.total_available || '0').toLocaleString()} ${c.base_unit}`,
  }));

  // Fetch FIFO Allocation Preview whenever Chemical or Required Qty changes (with in-flight cancellation)
  useEffect(() => {
    let isCancelled = false;

    async function fetchFifoPreview() {
      if (!chemicalId || !requiredQty || parseFloat(requiredQty) <= 0) {
        setFifoProposal(null);
        setPreviewError('');
        return;
      }

      setPreviewLoading(true);
      setPreviewError('');

      try {
        const res = await apiFetch<any>(
          `/issues/fifo-preview?chemical_id=${chemicalId}&required_qty=${requiredQty}`
        );
        if (!isCancelled) {
          setFifoProposal(res);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setPreviewError(err.message || 'Failed to generate FIFO preview proposal');
          setFifoProposal(null);
        }
      } finally {
        if (!isCancelled) {
          setPreviewLoading(false);
        }
      }
    }

    const timer = setTimeout(fetchFifoPreview, 300);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [chemicalId, requiredQty, previewSeq]);

  const handlePostIssue = async () => {
    setStatusMessage(null);

    const activeChem = chemicals.find(c => c.id === chemicalId);
    const activeTank = tanks.find(t => t.value === tankId);

    if (!chemicalId || !activeChem) {
      setStatusMessage({ type: 'error', text: 'Please select a valid active chemical' });
      setChemicalId('');
      return;
    }

    if (!tankId || !activeTank) {
      setStatusMessage({ type: 'error', text: 'Please select a valid production tank' });
      setTankId('');
      return;
    }

    if (!requiredQty || parseFloat(requiredQty) <= 0) {
      setStatusMessage({ type: 'error', text: 'Please enter a valid positive issue quantity' });
      return;
    }

    if (fifoProposal && !fifoProposal.is_sufficient) {
      setStatusMessage({
        type: 'error',
        text: `Insufficient stock! Requested ${requiredQty} ${activeChem.base_unit}, but only ${fifoProposal.total_available} ${activeChem.base_unit} eligible stock available.`
      });
      return;
    }

    setSubmitting(true);

    try {
      const idempotencyKey = uuidv4();

      const payload = {
        chemical_id: chemicalId,
        tank_id: tankId,
        required_qty: parseFloat(requiredQty),
        issued_by_name: issuedBy,
        job_reference: jobCardNumber,
        job_card_number: jobCardNumber,
        shift,
        remarks,
        override_reason: adminOverrideReason || undefined,
        idempotency_key: idempotencyKey,
      };

      const res = await apiFetch<any>('/issues', {
        method: 'POST',
        headers: {
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const issueId = res.id || res.issue?.id || '';
      const issueNum = res.issue_number || res.issue?.issue_number || '';

      setStatusMessage({
        type: 'success',
        text: `Chemical Issue ${issueNum ? `(${issueNum})` : ''} posted successfully! Deducted ${requiredQty} ${activeChem.base_unit} using strict FIFO allocations.`,
        issueId,
      });

      // Clear Form & FIFO Proposal
      setRequiredQty('');
      setRemarks('');
      setJobCardNumber('');
      setAdminOverrideReason('');
      setFifoProposal(null);

      // Refresh chemicals stock immediately
      const chemRes = await apiFetch<any[]>('/chemicals');
      setChemicals(chemRes.filter(c => c.is_active));
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to issue chemical' });

      // Invalidate stale preview & refetch stock data on error
      setFifoProposal(null);
      setPreviewSeq(prev => prev + 1);
      try {
        const chemRes = await apiFetch<any[]>('/chemicals');
        setChemicals(chemRes.filter(c => c.is_active));
      } catch (e) {
        // ignore background refresh failure
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ArrowUpFromLine className="w-7 h-7 text-slate-900" />
            Issue Chemical to Production Tank (FIFO Allocation)
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            Automatic First-In-First-Out (FIFO) stock deduction from oldest eligible supplier batch lots.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div className={`p-4 rounded-xl text-sm font-semibold flex items-center gap-3 shadow-sm ${
          statusMessage.type === 'success' ? 'bg-teal-50 border border-teal-200 text-teal-900' : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {statusMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Issue Input Form (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 text-base">Issue Details</h3>

          <SearchableSelect
            label="Select Chemical"
            required
            options={chemicalOptions}
            value={chemicalId}
            onChange={setChemicalId}
            placeholder="Search chemical code or name..."
          />

          <SearchableSelect
            label="Destination Tank / Process Line"
            required
            options={tanks}
            value={tankId}
            onChange={setTankId}
            placeholder="Select Production Tank..."
          />

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Required Issue Quantity {selectedChemical && <span className="text-teal-700 font-bold">({selectedChemical.base_unit})</span>} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                required
                value={requiredQty}
                onChange={e => setRequiredQty(e.target.value)}
                placeholder={`Enter quantity in ${selectedChemical ? selectedChemical.base_unit : 'units'}`}
                className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-bold text-lg focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
              {selectedChemical && (
                <span className="absolute right-3 top-3 text-xs font-bold uppercase text-slate-500">
                  {selectedChemical.base_unit}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">Issued By Staff Name</label>
              <input
                type="text"
                value={issuedBy}
                onChange={e => setIssuedBy(e.target.value)}
                placeholder="Storekeeper Name"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1">Job Card / Lot Ref</label>
              <input
                type="text"
                value={jobCardNumber}
                onChange={e => setJobCardNumber(e.target.value)}
                placeholder="JOB-2026-99"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">Production Shift</label>
            <select
              value={shift}
              onChange={e => setShift(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            >
              <option value="Day Shift (8 AM - 4 PM)">Day Shift (8 AM - 4 PM)</option>
              <option value="Evening Shift (4 PM - 12 AM)">Evening Shift (4 PM - 12 AM)</option>
              <option value="Night Shift (12 AM - 8 AM)">Night Shift (12 AM - 8 AM)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">Remarks / Tank Addition Reason</label>
            <textarea
              rows={2}
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Concentration adjustment, fresh bath make-up..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={
              submitting ||
              previewLoading ||
              !chemicalId ||
              !tankId ||
              !requiredQty ||
              parseFloat(requiredQty || '0') <= 0 ||
              Boolean(fifoProposal && !fifoProposal.is_sufficient)
            }
            onClick={handlePostIssue}
            className="w-full min-h-[48px] bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mt-4"
          >
            <ArrowUpFromLine className="w-5 h-5 text-teal-400" />
            <span>{submitting ? 'Allocating & Deducting...' : 'Confirm & Post Chemical Issue'}</span>
          </button>
        </div>

        {/* Right Column: Real-Time FIFO Allocation Preview (7 Cols) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Layers className="w-5 h-5 text-teal-600" />
              FIFO Batch Allocation Proposal (Preview)
            </h3>
            {selectedChemical && (
              <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded">
                Total Available: {parseFloat(selectedChemical.total_available || '0').toLocaleString()} {selectedChemical.base_unit}
              </span>
            )}
          </div>

          {!chemicalId ? (
            <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl space-y-2">
              <Boxes className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-semibold">Select a chemical and enter quantity to view FIFO lot breakdown.</p>
            </div>
          ) : previewLoading ? (
            <div className="p-8 text-center text-slate-500 font-semibold">Calculating FIFO allocations...</div>
          ) : previewError ? (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>{previewError}</span>
            </div>
          ) : fifoProposal ? (
            <div className="space-y-4">
              
              {/* Sufficiency Status */}
              {!fifoProposal.is_sufficient && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  <span>Stock Shortage: Insufficient available quantity to fulfill request.</span>
                </div>
              )}

              {/* Proposed Lots Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-800 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Sequence</th>
                      <th className="p-3">Lot Number</th>
                      <th className="p-3">Supplier Batch</th>
                      <th className="p-3">Inward Date</th>
                      <th className="p-3">Lot Balance</th>
                      <th className="p-3">To Issue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {fifoProposal.proposed_allocations.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400 font-sans">
                          No eligible available lots found for this chemical.
                        </td>
                      </tr>
                    ) : (
                      fifoProposal.proposed_allocations.map((lot: any, index: number) => (
                        <tr key={lot.lot_id} className="hover:bg-teal-50/50">
                          <td className="p-3 font-bold text-slate-900">#{index + 1}</td>
                          <td className="p-3 font-bold text-teal-800">{lot.lot_number}</td>
                          <td className="p-3 text-slate-700">{lot.supplier_batch_number}</td>
                          <td className="p-3 text-slate-600 font-sans">
                            {lot.received_at ? lot.received_at.slice(0, 10) : 'N/A'}
                          </td>
                          <td className="p-3 font-sans">
                            <QuantityBadge value={lot.remaining_qty} unit={selectedChemical?.base_unit || ''} />
                          </td>
                          <td className="p-3 font-sans font-bold text-teal-900 bg-teal-50">
                            <QuantityBadge value={lot.allocated_qty} unit={selectedChemical?.base_unit || ''} bold />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary Footer */}
              <div className="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400">Total FIFO Allocation:</span>
                  <span className="font-bold text-teal-400 ml-2">
                    {fifoProposal.total_allocated} {selectedChemical?.base_unit}
                  </span>
                </div>
                <div className="text-slate-400">
                  Lots Used: {fifoProposal.proposed_allocations.length}
                </div>
              </div>

              {/* Ineligible Lots Warnings */}
              {fifoProposal.ineligible_lots && fifoProposal.ineligible_lots.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Blocked / Quarantined Lots Excluded ({fifoProposal.ineligible_lots.length})
                  </h4>
                  <div className="space-y-1.5">
                    {fifoProposal.ineligible_lots.map((l: any) => (
                      <div key={l.id} className="p-2 bg-purple-50 border border-purple-200 rounded-lg text-xs flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-purple-900">{l.lot_number}</span>
                          <span className="text-purple-700 ml-2">({l.supplier_batch_number})</span>
                        </div>
                        <StatusBadge status={l.status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : null}
        </div>

      </div>

    </div>
  );
};
