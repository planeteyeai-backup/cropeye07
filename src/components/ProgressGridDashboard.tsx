import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import ProgressGridChart from './progressbar/ProgressGridChart';
import FactoryIndustrySelect from './progressbar/FactoryIndustrySelect';
import { YIELD_TARGET_TON } from './progressbar/progressData';
import { useFactoryProgress } from './progressbar/useFactoryProgress';

const ProgressGridDashboard: React.FC = () => {
  const {
    factories,
    loading,
    error,
    selectedFactoryId,
    setSelectedFactoryId,
    selectedFactory,
    farmerConfigs,
  } = useFactoryProgress();

  const chartFarmerConfigs = useMemo(
    () => [...farmerConfigs].sort((a, b) => b.tons - a.tons),
    [farmerConfigs],
  );

  const underTargetCount = useMemo(
    () => chartFarmerConfigs.filter((farmer) => farmer.tons < YIELD_TARGET_TON).length,
    [chartFarmerConfigs],
  );

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
                    All farmers by yield — colored dots below {YIELD_TARGET_TON} ton
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <FactoryIndustrySelect
                  id="grid-district-filter"
                  label="Select industry"
                  factories={factories}
                  value={selectedFactoryId}
                  loading={loading}
                  onChange={setSelectedFactoryId}
                  className="max-w-xl"
                />
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
                Loading chart data…
              </div>
            ) : (
              <ProgressGridChart
                factoryId={selectedFactoryId}
                factoryLabel={selectedFactory?.factory_name ?? ''}
                farmerConfigs={chartFarmerConfigs}
                underTargetCount={underTargetCount}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressGridDashboard;
