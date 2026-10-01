import React from 'react';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const s = (status || '').toUpperCase();

  let style = 'bg-slate-100 text-slate-700 border-slate-200';

  if (s === 'AVAILABLE' || s === 'POSTED') {
    style = 'bg-teal-50 text-teal-800 border-teal-200 font-semibold';
  } else if (s === 'DRAFT' || s === 'REVIEW') {
    style = 'bg-amber-50 text-amber-800 border-amber-200';
  } else if (s === 'QUARANTINED') {
    style = 'bg-purple-50 text-purple-800 border-purple-200 font-semibold';
  } else if (s === 'BLOCKED' || s === 'EXPIRED') {
    style = 'bg-red-50 text-red-800 border-red-200 font-semibold';
  } else if (s === 'REVERSED') {
    style = 'bg-slate-200 text-slate-700 border-slate-300 line-through';
  } else if (s === 'EXHAUSTED') {
    style = 'bg-slate-100 text-slate-400 border-slate-200';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border ${style}`}>
      {s}
    </span>
  );
};
