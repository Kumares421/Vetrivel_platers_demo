import React from 'react';

interface QuantityBadgeProps {
  value: number | string;
  unit: string;
  className?: string;
  bold?: boolean;
}

export const QuantityBadge: React.FC<QuantityBadgeProps> = ({
  value,
  unit,
  className = '',
  bold = false
}) => {
  const num = typeof value === 'number' ? value : parseFloat(value || '0');
  const formatted = isNaN(num) ? '0' : num.toLocaleString('en-IN', { maximumFractionDigits: 4 });

  return (
    <span className={`inline-flex items-center gap-1 font-mono ${bold ? 'font-bold' : 'font-medium'} ${className}`}>
      <span>{formatted}</span>
      <span className="text-xs uppercase font-sans font-semibold text-slate-500">{unit}</span>
    </span>
  );
};
