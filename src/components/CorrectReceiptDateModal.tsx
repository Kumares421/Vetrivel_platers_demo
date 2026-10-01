import React, { useState } from 'react';
import { Calendar, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface CorrectReceiptDateModalProps {
  receiptId: string;
  receiptNumber: string;
  currentActualReceivedAt: string;
  createdAt?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const CorrectReceiptDateModal: React.FC<CorrectReceiptDateModalProps> = ({
  receiptId,
  receiptNumber,
  currentActualReceivedAt,
  createdAt,
  onClose,
  onSuccess
}) => {
  const getNowLocalISO = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const formatIST = (isoString?: string) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    }) + ' IST';
  };

  const [newDate, setNewDate] = useState(() => {
    if (currentActualReceivedAt) {
      try {
        const d = new Date(currentActualReceivedAt);
        const tzOffset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
      } catch (e) {}
    }
    return getNowLocalISO();
  });

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Explicit audit reason is required for correcting receipt date.');
      return;
    }
    if (new Date(newDate) > new Date()) {
      setError('New actual received date & time cannot be in the future.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await apiFetch(`/receipts/${receiptId}/correct-date`, {
        method: 'POST',
        body: JSON.stringify({
          new_actual_received_at: newDate,
          reason: reason.trim()
        })
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update receipt date.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
        
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-teal-600" />
            <h3 className="font-bold text-slate-900 text-lg font-mono">
              Correct Receipt Date: {receiptNumber}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-4 p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs font-sans">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 font-semibold">Current Actual Received Date:</span>
            <span className="font-mono font-bold text-slate-900">{formatIST(currentActualReceivedAt)}</span>
          </div>
          {createdAt && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
              <span className="text-slate-400">Record Created Timestamp:</span>
              <span className="font-mono text-slate-600">{formatIST(createdAt)}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">
              Corrected Actual Received Date & Time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              required
              max={getNowLocalISO()}
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Select the exact date/time when chemicals physically arrived at the factory.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">
              Correction Audit Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Correcting typo in receipt date timestamp for DEMO-002 lot"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow transition-colors flex items-center gap-1.5"
            >
              {submitting ? 'Updating...' : 'Save Date Correction'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
