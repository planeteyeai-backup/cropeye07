import React, { useEffect, useState } from 'react';
import { Loader2, Sprout, Search, X } from 'lucide-react';
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
    farmersLoading,
    error,
    selectedFactoryId,
    setSelectedFactoryId,
    selectedFactory,
    farmerConfigs,
  } = useFactoryProgress(initialFactoryId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-2 sm:p-3">
      <div className="mx-auto flex max-w-7xl flex-col space-y-3">
        <div className="flex min-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-indigo-100/80 bg-white/90 shadow-lg backdrop-blur-sm sm:min-h-[calc(100vh-2rem)]">
          <div className="border-b border-slate-100 bg-gradient-to-r from-white to-emerald-50/30 px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-md shadow-emerald-200/50 sm:h-11 sm:w-11 sm:rounded-2xl">
                  <Sprout className="h-5 w-5 text-white sm:h-6 sm:w-6" />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight text-slate-800 sm:text-xl">
                    Crop Growth Progress
                  </h1>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
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
                {selectedFactory && !loading && !farmersLoading && (
                  <p className="mt-2 text-xs text-slate-500">
                    Selected industry:{' '}
                    <span className="font-medium text-slate-700">
                      {selectedFactory.factory_name}
                    </span>
                    {farmerConfigs.length > 0 && (
                      <>
                        {' '}
                        · {farmerConfigs.length} farmers
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
            {loading || farmersLoading ? (
              <div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-6 text-center">
                <Loader2
                  className="h-8 w-8 animate-spin text-emerald-600"
                  aria-hidden
                />
                <p className="text-sm font-medium text-slate-600">
                  {loading ? 'Loading factories…' : 'Loading farmer…'}
                </p>
                <p className="max-w-sm text-xs text-slate-400">
                  Large factories can take up to a minute on first load.
                </p>
              </div>
            ) : (
              <ProgressBar
                className="flex min-h-0 flex-1 flex-col"
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
