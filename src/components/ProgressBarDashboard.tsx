import React, { useEffect, useState } from 'react';
import { Sprout, Search, X } from 'lucide-react';
import ProgressBar from './progressbar/progressbar';
import FactoryIndustrySelect from './progressbar/FactoryIndustrySelect';
import {
  DEFAULT_MONTH_SECTION,
  type MonthSectionLabel,
} from './progressbar/progressConstants';
import { consumeProgressNavTarget } from './progressbar/progressNavigation';
import { useFactoryProgress } from './progressbar/useFactoryProgress';

const ProgressBarDashboard: React.FC<{ navKey?: number }> = ({ navKey = 0 }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [monthSection, setMonthSection] =
    useState<MonthSectionLabel>(DEFAULT_MONTH_SECTION);
  const [highlightFarmerId, setHighlightFarmerId] = useState<string | undefined>();
  const [initialFactoryId, setInitialFactoryId] = useState<string | undefined>();

  useEffect(() => {
    const target = consumeProgressNavTarget();
    if (!target) return;
    if (target.factoryId) setInitialFactoryId(target.factoryId);
    setMonthSection(target.monthSection);
    if (target.searchQuery) setSearchQuery(target.searchQuery);
    if (target.farmerId) setHighlightFarmerId(target.farmerId);
  }, [navKey]);

  const {
    factories,
    loading,
    error,
    selectedFactoryId,
    setSelectedFactoryId,
    selectedFactory,
    farmerConfigs,
  } = useFactoryProgress(initialFactoryId);

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
                    {/* Weekly check-ins by sugar factory */}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FactoryIndustrySelect
                    id="district-filter"
                    label="Sugar factory / industry"
                    factories={factories}
                    value={selectedFactoryId}
                    loading={loading}
                    onChange={setSelectedFactoryId}
                  />

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

                {error && (
                  <p className="mt-3 text-sm text-red-600">{error}</p>
                )}
                {selectedFactory && !loading && (
                  <p className="mt-2 text-xs text-slate-500">
                    Selected industry:{' '}
                    <span className="font-medium text-slate-700">
                      {selectedFactory.factory_name}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {loading ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center text-sm text-slate-500">
                Loading factories and farmers…
              </div>
            ) : (
              <ProgressBar
                factoryId={selectedFactoryId}
                farmerConfigs={farmerConfigs}
                searchQuery={searchQuery}
                initialMonthSection={monthSection}
                highlightFarmerId={highlightFarmerId}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressBarDashboard;
