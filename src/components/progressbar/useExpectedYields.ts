import { useEffect, useState } from 'react';
// import { fetchExpectedYieldForFarmer } from './fetchFarmerExpectedYield';

const BATCH_SIZE = 4;

/** Loads analyzeSinglePlot expected yield (T/acre) per farmer when Live mode is active. */
export function useExpectedYields(
  farmerIds: string[],
  enabled: boolean,
): Record<string, number> {
  const [byFarmerId, setByFarmerId] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled || farmerIds.length === 0) {
      setByFarmerId({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const next: Record<string, number> = {};

      for (let i = 0; i < farmerIds.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const chunk = farmerIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          chunk.map(async (farmerId) => {
            // const expected = await fetchExpectedYieldForFarmer(farmerId);
            const expected = null;
            return { farmerId, expected };
          }),
        );
        for (const { farmerId, expected } of results) {
          if (expected != null) next[farmerId] = expected;
        }
      }

      if (!cancelled) setByFarmerId(next);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, farmerIds.join('|')]);

  return byFarmerId;
}
