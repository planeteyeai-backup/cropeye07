import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchIndustrialYieldByOwner } from "../api";
import type { IndustrialYieldByOwnerResponse, IndustrialYieldFarmer } from "./progressbar/industrialYieldTypes";
import { findIndustrialFarmerMatch } from "./progressbar/mapIndustrialYield";
import { resolveProgressOwnerId } from "./progressbar/useFactoryProgress";
import {
  computeIndustrialNpkFromReadings,
  type IndustrialNpkResult,
} from "../utils/industrialYieldNpk";
import { getUserData } from "../utils/auth";

const FALLBACK_PROGRESS_OWNER_ID = 2476;

type ProfileLike = {
  farmer_profile?: {
    id?: number;
    personal_info?: {
      phone_number?: string;
      full_name?: string;
      first_name?: string;
      last_name?: string;
    };
  };
  plots?: unknown[];
} | null;

function collectIndustrialFarmers(
  payload: IndustrialYieldByOwnerResponse | null | undefined,
): IndustrialYieldFarmer[] {
  if (!payload?.factories?.length) return [];
  return payload.factories.flatMap((factory) => factory.farmers ?? []);
}

function findIndustrialFarmer(
  payload: IndustrialYieldByOwnerResponse | null | undefined,
  farmerId: number | string | undefined,
  phone?: string,
  name?: string,
): IndustrialYieldFarmer | null {
  const industrialFarmers = collectIndustrialFarmers(payload);
  if (!industrialFarmers.length) return null;

  const parsedId = Number(farmerId);
  const match = findIndustrialFarmerMatch(
    {
      id: Number.isFinite(parsedId) && parsedId > 0 ? parsedId : 0,
      farmer_name: name ?? "",
      phone_number: phone ?? "",
    },
    industrialFarmers,
  );
  return match ?? null;
}

async function fetchIndustrialYieldPayload(ownerId: number) {
  let result = await fetchIndustrialYieldByOwner(ownerId);
  if (
    !result.ok &&
    ownerId !== FALLBACK_PROGRESS_OWNER_ID
  ) {
    result = await fetchIndustrialYieldByOwner(FALLBACK_PROGRESS_OWNER_ID);
  }
  return result;
}

interface FertilizerNpkCardsProps {
  profile?: ProfileLike;
  profileLoading?: boolean;
  compact?: boolean;
}

const FertilizerNpkCards: React.FC<FertilizerNpkCardsProps> = ({
  profile,
  profileLoading = false,
  compact = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [npk, setNpk] = useState<IndustrialNpkResult | null>(null);
  const inFlight = useRef(false);

  const farmerId = useMemo(() => {
    const user = getUserData();
    return (
      profile?.farmer_profile?.id ??
      user?.id ??
      user?.user_id ??
      null
    );
  }, [profile?.farmer_profile?.id]);

  const farmerPhone = useMemo(
    () => profile?.farmer_profile?.personal_info?.phone_number ?? getUserData()?.phone_number,
    [profile?.farmer_profile?.personal_info?.phone_number],
  );

  const farmerName = useMemo(() => {
    const info = profile?.farmer_profile?.personal_info;
    const fullName = info?.full_name?.trim();
    if (fullName) return fullName;
    const joined = [info?.first_name, info?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    return joined || undefined;
  }, [profile?.farmer_profile?.personal_info]);

  const loadNpk = useCallback(async () => {
    if (profileLoading || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const ownerId = resolveProgressOwnerId();
      const { ok, data } = await fetchIndustrialYieldPayload(ownerId);
      if (!ok) {
        throw new Error(
          (data as { error?: string })?.error ??
            "Industrial yield not available for NPK calculation",
        );
      }

      const industrialFarmer = findIndustrialFarmer(
        data as IndustrialYieldByOwnerResponse,
        farmerId ?? undefined,
        farmerPhone,
        farmerName,
      );

      if (!industrialFarmer?.yields?.length) {
        throw new Error(
          "No industrial yield readings found for your farm. Check phone/name in profile matches SEF data.",
        );
      }

      const result = computeIndustrialNpkFromReadings(industrialFarmer.yields);
      if (!result) {
        throw new Error(
          "Need at least 2 industrial yield readings in a month to calculate NPK (highest − lowest).",
        );
      }
      setNpk(result);
    } catch (err: unknown) {
      setNpk(null);
      setError(
        err instanceof Error ? err.message : "Failed to calculate NPK from yield",
      );
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [farmerId, farmerName, farmerPhone, profileLoading]);

  useEffect(() => {
    if (!profileLoading) {
      void loadNpk();
    }
  }, [loadNpk, profileLoading]);

  const cards = [
    {
      short: "N",
      value: npk?.N,
      bgColor: "bg-green-50",
      iconBg: "bg-green-500",
      textColor: "text-green-700",
    },
    {
      short: "P",
      value: npk?.P,
      bgColor: "bg-blue-50",
      iconBg: "bg-blue-500",
      textColor: "text-blue-700",
    },
    {
      short: "K",
      value: npk?.K,
      bgColor: "bg-yellow-50",
      iconBg: "bg-yellow-500",
      textColor: "text-yellow-700",
    },
  ];

  const formatValue = (v: number | undefined): string => {
    if (loading) return "Loading...";
    if (v == null || !Number.isFinite(v)) return "—";
    return v.toFixed(2);
  };

  return (
    <div className={compact ? "mb-3" : "mb-6"}>
      <div
        className={`grid grid-cols-1 sm:grid-cols-3 ${compact ? "gap-3" : "gap-6"}`}
      >
        {cards.map((card) => (
          <div
            key={card.short}
            className={`${card.bgColor} shadow-lg rounded-xl ${compact ? "p-4" : "p-6"} text-center`}
          >
            <div
              className={`${card.iconBg} ${compact ? "w-14 h-14" : "w-20 h-20"} rounded-full flex flex-col items-center justify-center mx-auto mb-3`}
            >
              <span
                className={`${compact ? "text-2xl" : "text-4xl"} font-bold text-white`}
              >
                {card.short}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <div
                className={`${compact ? "text-2xl" : "text-4xl"} font-extrabold ${card.textColor}`}
              >
                {formatValue(card.value)}
              </div>
              {!loading && card.value != null && (
                <span className="text-sm text-gray-500 font-medium mt-1">
                  kg/acre
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {npk && !loading && (
        <p className="mt-2 text-center text-xs text-gray-500">
          {/* From industrial yield ({npk.periodLabel}):{" "} */}
          <span className="font-semibold text-gray-700">
            {/* {npk.monthlyMinYield.toFixed(2)} – {npk.monthlyMaxYield.toFixed(2)} T/acre */}
          </span>{" "}
          {/* (Δ {npk.yieldDiffTonPerAcre.toFixed(2)} T/acre) · N=2.5, P=1, */}
          {/* K=3.5 kg/tonne */}
        </p>
      )}

      {error && !loading && (
        <p className="mt-2 text-center text-xs text-amber-700">{error}</p>
      )}
    </div>
  );
};

export default FertilizerNpkCards;
