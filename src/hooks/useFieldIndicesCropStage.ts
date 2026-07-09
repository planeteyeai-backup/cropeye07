import { useEffect, useMemo, useState } from "react";
import { getFarmsByFarmerId } from "../api";
import {
  enrichPlotsWithFarmDetails,
  resolveCropStageFromContext,
} from "../utils/fertilizerStage";

function parseFarmsList(data: unknown): any[] {
  const payload = data as { results?: unknown[] };
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(data)) return data as any[];
  return [];
}

/** Crop stage for Field Indices — uses plot/farmer data, then farms API if needed. */
export function useFieldIndicesCropStage(
  plot: unknown,
  farmer: unknown,
  plotId: string | null | undefined,
  farmerId?: string | null,
): string | null {
  const quickStage = useMemo(
    () => resolveCropStageFromContext(plot, farmer, plotId),
    [plot, farmer, plotId],
  );

  const [fetchedStage, setFetchedStage] = useState<string | null>(null);

  useEffect(() => {
    if (quickStage) {
      setFetchedStage(null);
      return;
    }

    const id = farmerId?.trim();
    const plotKey = plotId?.trim();
    if (!id || !plotKey) {
      setFetchedStage(null);
      return;
    }

    let cancelled = false;

    void getFarmsByFarmerId(id)
      .then((response) => {
        if (cancelled) return;
        const farms = parseFarmsList(response.data);
        const plotRecord = plot as Record<string, unknown> | null | undefined;
        const enrichedPlot = enrichPlotsWithFarmDetails(
          [plotRecord ?? { fastapi_plot_id: plotKey }],
          farms,
        )[0];

        const stageFromEnrichedPlot = resolveCropStageFromContext(
          enrichedPlot,
          null,
          plotKey,
        );
        if (stageFromEnrichedPlot) {
          setFetchedStage(stageFromEnrichedPlot);
          return;
        }

        for (const farm of farms) {
          const stage = resolveCropStageFromContext(farm, null, plotKey);
          if (stage) {
            setFetchedStage(stage);
            return;
          }
        }

        setFetchedStage(null);
      })
      .catch(() => {
        if (!cancelled) setFetchedStage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [quickStage, farmerId, plotId, plot]);

  return quickStage ?? fetchedStage;
}
