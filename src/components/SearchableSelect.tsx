import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select an option...',
  label,
  required,
  disabled
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(
    o => o.label.toLowerCase().includes(search.toLowerCase()) ||
         (o.sublabel && o.sublabel.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="w-full" ref={containerRef}>
      {label && (
        <label className="block text-sm font-semibold text-slate-800 mb-1">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`w-full min-h-[44px] px-3 py-2 text-left bg-white border rounded-lg shadow-sm flex items-center justify-between text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 ${
            disabled ? 'bg-slate-100 cursor-not-allowed text-slate-400 border-slate-200' : 'border-slate-300 hover:border-teal-500'
          }`}
        >
          <div className="truncate pr-2">
            {selectedOption ? (
              <span className="font-medium text-slate-900">
                {selectedOption.label}
                {selectedOption.sublabel && (
                  <span className="text-xs text-slate-500 ml-2">({selectedOption.sublabel})</span>
                )}
              </span>
            ) : (
              <span className="text-slate-400">{placeholder}</span>
            )}
          </div>
          <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Type to filter..."
                autoFocus
                className="w-full bg-transparent text-sm text-slate-800 focus:outline-none"
              />
            </div>
            <div className="overflow-y-auto max-h-48 divide-y divide-slate-50">
              {filteredOptions.length === 0 ? (
                <div className="p-3 text-xs text-slate-400 text-center">No matching records found</div>
              ) : (
                filteredOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={`w-full text-left p-3 text-sm hover:bg-teal-50 flex items-center justify-between transition-colors ${
                      opt.value === value ? 'bg-teal-50/70 font-semibold text-teal-900' : 'text-slate-800'
                    }`}
                  >
                    <div>
                      <div>{opt.label}</div>
                      {opt.sublabel && <div className="text-xs text-slate-500">{opt.sublabel}</div>}
                    </div>
                    {opt.value === value && <Check className="w-4 h-4 text-teal-600 flex-shrink-0 ml-2" />}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
