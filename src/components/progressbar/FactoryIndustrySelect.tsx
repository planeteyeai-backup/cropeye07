import React from 'react';
import { Loader2, MapPin } from 'lucide-react';
import type { PublicFactory } from './factoryProgressTypes';

interface FactoryIndustrySelectProps {
  id: string;
  label?: string;
  factories: PublicFactory[];
  value: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (factoryId: string) => void;
  className?: string;
}

const FactoryIndustrySelect: React.FC<FactoryIndustrySelectProps> = ({
  id,
  label = 'Sugar factory / industry',
  factories,
  value,
  loading = false,
  disabled = false,
  onChange,
  className = '',
}) => (
  <div className={className}>
    <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-700">
      {label}
    </label>
    <div className="relative">
      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
      <select
        id={id}
        value={value}
        disabled={disabled || loading || factories.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm font-medium text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        {loading && (
          <option value="">Loading factories…</option>
        )}
        {!loading && factories.length === 0 && (
          <option value="">No factories found</option>
        )}
        {!loading &&
          factories.map((factory) => (
            <option key={factory.factory_id} value={String(factory.factory_id)}>
              {factory.factory_name}
            </option>
          ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '▾'}
      </span>
    </div>
  </div>
);

export default FactoryIndustrySelect;
