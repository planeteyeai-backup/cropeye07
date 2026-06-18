import React, { useMemo } from 'react';
import { useFarmerProfile } from '../hooks/useFarmerProfile';
import { useI18nLite } from '../i18nLite.ts';
import { getPlantationFromRecord } from '../utils/plantation';

interface HeaderFarmProps {}

const displayOrNA = (value?: string | null) => {
  const text = value?.trim();
  if (!text || text === 'N/A') return 'N/A';
  return text;
};

export const Header: React.FC<HeaderFarmProps> = () => {
  const { profile, loading: profileLoading } = useFarmerProfile();
  const { t } = useI18nLite();

  const plantation = useMemo(
    () => (profile ? getPlantationFromRecord(profile) : null),
    [profile],
  );

  const plantationDate = displayOrNA(plantation?.plantation_date);
  const plantationType = displayOrNA(plantation?.plantation_type);

  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <header className="bg-green-800 py-2 shadow-md">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-y-1 gap-x-2 px-2 sm:px-4">
        {profileLoading ? (
          <div className="col-span-full text-gray-300 text-xs sm:text-sm text-center">
            {t('headerFarm.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : profile ? (
          <>
            <div className="flex items-center justify-center sm:justify-start min-w-0">
              <span className="font-bold text-white text-xs sm:text-sm truncate">
                {profile.farmer_profile?.personal_info?.full_name ||
                  t('headerFarm.unknown', { defaultValue: 'Unknown' })}
              </span>
            </div>

            <div className="flex flex-col items-center justify-center text-white text-center min-w-0">
              <span className="font-medium text-xs sm:text-sm whitespace-nowrap">
                {formattedDate}
              </span>
              <span className="text-[10px] sm:text-xs text-green-100 whitespace-nowrap mt-0.5">
                {t('headerFarm.plantationDateLabel', { defaultValue: 'Plantation Date' })}:{' '}
                <span className="font-semibold text-white">{plantationDate}</span>
                <span className="mx-1.5 text-green-200">|</span>
                {t('headerFarm.plantationTypeLabel', { defaultValue: 'Type' })}:{' '}
                <span className="font-semibold text-white">{plantationType}</span>
              </span>
            </div>

            <div className="flex items-center justify-center sm:justify-end min-w-0">
              <span className="font-bold text-white text-xs sm:text-sm whitespace-nowrap">
                {t('headerFarm.totalPlotsLabel', { defaultValue: 'Total Plots:' })}{' '}
                {profile.agricultural_summary?.total_plots || 0}
              </span>
            </div>
          </>
        ) : (
          <div className="col-span-full text-red-300 text-xs sm:text-sm text-center">
            {t('headerFarm.failedToLoad', { defaultValue: 'Failed to load profile' })}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;