import type { KpiDirection, KpiStatus } from "./types";

/**
 * Compute the traffic-light status for a KPI value.
 *
 * higher_better:
 *   value >= green_threshold → green
 *   value <  red_threshold   → red
 *   else                     → yellow
 *
 * lower_better:
 *   value <= green_threshold → green
 *   value >  red_threshold   → red
 *   else                     → yellow
 */
export function computeKpiStatus(
  value: number,
  red: number,
  green: number,
  direction: KpiDirection,
): KpiStatus {
  if (direction === "higher_better") {
    if (value >= green) return "green";
    if (value < red) return "red";
    return "yellow";
  }
  if (value <= green) return "green";
  if (value > red) return "red";
  return "yellow";
}

export function formatKpiValue(value: number | null, unit: string | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "x") return `${value.toFixed(2)}x`;
  if (unit === "hours") return `${value.toFixed(1)}h`;
  if (unit === "count") return Math.round(value).toString();
  return value.toFixed(2);
}

export function statusColors(status: KpiStatus | null): {
  bg: string;
  border: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case "green":
      return {
        bg: "bg-green-950/40",
        border: "border-green-700/50",
        text: "text-green-300",
        dot: "bg-green-500",
      };
    case "yellow":
      return {
        bg: "bg-yellow-950/40",
        border: "border-yellow-700/50",
        text: "text-yellow-300",
        dot: "bg-yellow-500",
      };
    case "red":
      return {
        bg: "bg-red-950/40",
        border: "border-red-700/50",
        text: "text-red-300",
        dot: "bg-red-500",
      };
    default:
      return {
        bg: "bg-gray-900/40",
        border: "border-gray-800",
        text: "text-gray-500",
        dot: "bg-gray-700",
      };
  }
}
