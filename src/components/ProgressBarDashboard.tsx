import React, { useEffect, useState } from 'react';
import { Sprout, MapPin, Search, X } from 'lucide-react';
import ProgressBar from './progressbar/progressbar';
import { DISTRICT_OPTIONS, type DistrictId } from './progressbar/districts';
import {
  DEFAULT_MONTH_SECTION,
  type MonthSectionLabel,
} from './progressbar/progressConstants';
import {
  consumeProgressNavTarget,
} from './progressbar/progressNavigation';

const ProgressBarDashboard: React.FC<{ navKey?: number }> = ({ navKey = 0 }) => {
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictId>('kalburagi');
  const [searchQuery, setSearchQuery] = useState('');
  const [monthSection, setMonthSection] =
    useState<MonthSectionLabel>(DEFAULT_MONTH_SECTION);
  const [highlightFarmerId, setHighlightFarmerId] = useState<string | undefined>();

  useEffect(() => {
    const target = consumeProgressNavTarget();
    if (!target) return;
    setSelectedDistrict(target.districtId);
    setMonthSection(target.monthSection);
    if (target.searchQuery) setSearchQuery(target.searchQuery);
    if (target.farmerId) setHighlightFarmerId(target.farmerId);
  }, [navKey]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="overflow-hidden rounded-2xl border border-indigo-100/80 bg-white/90 shadow-lg backdrop-blur-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-white to-emerald-50/30 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg shadow-emerald-200/50">
                  <Sprout className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-800">
                    Crop Growth Progress
                  </h1>
                  <p className="text-sm text-slate-500">
                    {/* Weekly check-ins — 10 weeks per month period */}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="district-filter"
                      className="mb-2 block text-sm font-semibold text-slate-700"
                    >
                      Sugar factory / district
                    </label>
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                      <select
                        id="district-filter"
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
                  </div>

                  <div>
                    <label
                      htmlFor="farmer-search"
                      className="mb-2 block text-sm font-semibold text-slate-700"
                    >
                      Search farmer
                    </label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="farmer-search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by farmer name..."
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-10 text-sm font-medium text-slate-800 shadow-sm placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <ProgressBar
              districtId={selectedDistrict}
              searchQuery={searchQuery}
              initialMonthSection={monthSection}
              highlightFarmerId={highlightFarmerId}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressBarDashboard;
