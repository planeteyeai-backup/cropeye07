import React, { useState } from 'react';
import { BarChart3, MapPin } from 'lucide-react';
import ProgressGridChart from './progressbar/ProgressGridChart';
import { DISTRICT_OPTIONS, type DistrictId } from './progressbar/districts';

const ProgressGridDashboard: React.FC = () => {
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictId>('kalburagi');

  const selected = DISTRICT_OPTIONS.find((d) => d.id === selectedDistrict)!;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="overflow-hidden rounded-2xl border border-indigo-100/80 bg-white/90 shadow-lg backdrop-blur-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-white to-emerald-50/30 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg shadow-emerald-200/50">
                  <BarChart3 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-800">
                    Chart of Progress
                  </h1>
                  <p className="text-sm text-slate-500">
                    Farmer progress bubble chart by district
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <label
                  htmlFor="grid-district-filter"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Select district
                </label>
                <div className="relative max-w-xl">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                  <select
                    id="grid-district-filter"
                    value={selectedDistrict}
                    onChange={(e) => setSelectedDistrict(e.target.value as DistrictId)}
                    className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm font-medium text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  >
                    {DISTRICT_OPTIONS.map((district) => (
                      <option key={district.id} value={district.id}>
                        {district.label}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    ▾
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {/* Showing chart for:{' '} */}
                  <span className="font-medium text-slate-700">{selected.label}</span>
                </p>  
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <ProgressGridChart districtId={selectedDistrict} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressGridDashboard;
