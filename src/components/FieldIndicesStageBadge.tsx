import React from "react";

interface FieldIndicesStageBadgeProps {
  stage: string | null | undefined;
}

/** One-line crop stage next to Moisture Index on Field Indices charts. */
const FieldIndicesStageBadge: React.FC<FieldIndicesStageBadgeProps> = ({
  stage,
}) => {
  if (!stage?.trim()) return null;

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 whitespace-nowrap">
      <span className="font-medium text-amber-800/75">Stage:</span>
      <span className="truncate font-semibold">{stage}</span>
    </span>
  );
};

export default FieldIndicesStageBadge;
