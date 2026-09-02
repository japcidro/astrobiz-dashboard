"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Award,
  Calendar,
  CheckCircle2,
  Lock,
  Package,
  RefreshCw,
  RotateCcw,
  Settings2,
  Target,
} from "lucide-react";
import type { BonusOverview } from "@/lib/bonus/types";
import { TierLadder } from "./tier-ladder";
import { ParcelTrend } from "./parcel-trend";
import { TierEditor } from "./tier-editor";

interface Props {
  employeeName: string;
  isAdmin: boolean;
}

function peso(value: number, decimals = 2): string {
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function num(value: number, decimals = 1): string {
  return value.toLocaleString("en-PH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function BonusDashboardClient({ employeeName, isAdmin }: Props) {
  const [data, setData] = useState<BonusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/bonus/overview${force ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load bonus data");
      setData(json as BonusOverview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bonus data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="h-8 w-56 bg-gray-900 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-gray-900 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-4">Bonus Tracker</h1>
        <div className="p-4 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-sm">
          {error ?? "No data"}
        </div>
        <button
          onClick={() => load(true)}
          className="mt-4 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600 cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  const { period, parcels, progress, cpp, rts, previous, tiers } = data;
  const earned = progress.current_tier;
  const firstName = employeeName.split(" ")[0];

  // Until the cutoff day the headline is the rolling window, so every label
  // around it has to say which number the team is actually looking at.
  const onPace = data.judged_on === "pace";
  const pace = parcels.pace;

  return (
    <div className="max-w-6xl mx-auto pb-10">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Award size={24} className="text-yellow-400" />
            Bonus Tracker
          </h1>
          <p className="text-sm text-gray-500">
            Company-wide parcel bonus for the {period.label} cutoff.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowEditor((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded border border-gray-800 hover:border-gray-600 cursor-pointer"
            >
              <Settings2 size={12} />
              {showEditor ? "Close editor" : "Edit tiers"}
            </button>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded border border-gray-800 hover:border-gray-600 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {isAdmin && showEditor && (
        <div className="mb-6">
          <TierEditor
            tiers={tiers}
            onSaved={() => {
              setShowEditor(false);
              load(true);
            }}
          />
        </div>
      )}

      {/* Hero — where the company stands right now */}
      <section
        className={`rounded-xl border p-5 sm:p-6 mb-6 ${
          earned
            ? "bg-gradient-to-br from-yellow-950/40 to-gray-950 border-yellow-700/50"
            : "bg-gray-950 border-gray-800"
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="lg:w-64 shrink-0">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              Average parcels / day
            </p>
            <p className="text-5xl font-bold text-white leading-none">
              {num(data.judged_average)}
            </p>
            {onPace ? (
              <>
                <p className="text-xs text-gray-500 mt-2">
                  Last {pace.window_days} days ·{" "}
                  {pace.total.toLocaleString("en-PH")} parcels
                </p>
                <p className="text-[11px] text-gray-600 mt-1">
                  This cutoff so far: {num(parcels.average_per_day)}/day over{" "}
                  {period.days_elapsed}{" "}
                  {period.days_elapsed === 1 ? "day" : "days"}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 mt-2">
                  {parcels.total.toLocaleString("en-PH")} parcels over{" "}
                  {period.days_elapsed}{" "}
                  {period.days_elapsed === 1 ? "day" : "days"}
                </p>
                <p className="text-[11px] text-yellow-600/80 mt-1">
                  Cutoff average — this is the figure the bonus settles on.
                </p>
              </>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {earned ? (
              <p className="text-sm text-yellow-300 flex items-center gap-1.5 mb-1">
                <CheckCircle2 size={15} />
                {firstName}, we&apos;re at{" "}
                <strong>{earned.label ?? `Tier ${earned.parcel_threshold}`}</strong>{" "}
                — {earned.parcel_threshold}/day cleared
              </p>
            ) : (
              <p className="text-sm text-gray-400 flex items-center gap-1.5 mb-1">
                <Lock size={14} />
                {onPace
                  ? "No tier hit yet at the current pace."
                  : "No tier hit for this cutoff."}
              </p>
            )}

            {progress.next_tier ? (
              <>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5 mt-3">
                  <span>{earned?.parcel_threshold ?? 0}/day</span>
                  <span className="text-gray-400">
                    next:{" "}
                    {progress.next_tier.label ??
                      `Tier ${progress.next_tier.parcel_threshold}`}{" "}
                    · {progress.next_tier.parcel_threshold}/day
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-400 transition-all"
                    style={{ width: `${progress.progress_pct}%` }}
                  />
                </div>
                {progress.to_next && (
                  <p className="text-xs text-gray-400 mt-2.5">
                    <strong className="text-white">
                      {num(Math.ceil(progress.to_next.per_day_gap), 0)} more
                      parcels/day
                    </strong>{" "}
                    to reach{" "}
                    {progress.next_tier.label ??
                      `Tier ${progress.next_tier.parcel_threshold}`}
                    {onPace
                      ? ` — that is the pace over the last ${pace.window_days} days.`
                      : "."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400 mt-3">
                {tiers.length === 0
                  ? "No tiers set yet."
                  : "Top tier — the highest rung is already cleared."}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Context metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          icon={<Target size={18} className="text-cyan-400" />}
          bg="bg-cyan-600/20"
          label="Average CPP"
          value={cpp.error ? "—" : peso(cpp.average, 0)}
          subtitle={
            cpp.error
              ? cpp.error
              : `last ${cpp.window_days} days · ${cpp.order_count.toLocaleString("en-PH")} orders`
          }
          subtitleColor={cpp.error ? "text-yellow-400" : "text-gray-500"}
        />
        <MetricCard
          icon={<Package size={18} className="text-purple-400" />}
          bg="bg-purple-600/20"
          label="Parcels this cutoff"
          value={parcels.total.toLocaleString("en-PH")}
          subtitle={`projected ${parcels.projected_total.toLocaleString("en-PH")} by ${period.end.slice(5)}`}
        />
        <MetricCard
          icon={<RotateCcw size={18} className="text-orange-400" />}
          bg="bg-orange-600/20"
          label="RTS rate"
          value={`${num(rts.rate_pct)}%`}
          subtitle={`last ${rts.window_days} days · ${rts.returned.toLocaleString("en-PH")} of ${rts.settled.toLocaleString("en-PH")} settled`}
          valueColor={
            rts.rate_pct >= 25
              ? "text-red-400"
              : rts.rate_pct >= 15
                ? "text-yellow-400"
                : "text-green-400"
          }
        />
        <MetricCard
          icon={<Calendar size={18} className="text-blue-400" />}
          bg="bg-blue-600/20"
          label="Cutoff period"
          value={
            period.is_complete
              ? "Closed"
              : `${period.days_remaining} ${period.days_remaining === 1 ? "day" : "days"} left`
          }
          subtitle={`${period.label} · day ${period.days_elapsed} of ${period.days_total}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TierLadder
          tiers={tiers}
          average={data.judged_average}
          windowLabel={
            onPace ? `last ${pace.window_days} days` : "this cutoff"
          }
          currentTierId={earned?.id ?? null}
        />
        <ParcelTrend
          daily={parcels.daily}
          average={parcels.average_per_day}
          tiers={tiers}
        />
      </div>

      {previous && (
        <section className="mt-6 rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h2 className="text-sm font-semibold text-white mb-2">
            Previous cutoff — {previous.period.label}
          </h2>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <Stat label="Parcels" value={previous.total.toLocaleString("en-PH")} />
            <Stat label="Average / day" value={num(previous.average_per_day)} />
            <Stat
              label="Tier reached"
              value={
                previous.tier
                  ? (previous.tier.label ??
                    `Tier ${previous.tier.parcel_threshold}`)
                  : "None"
              }
              valueColor={previous.tier ? "text-yellow-300" : "text-gray-500"}
            />
          </div>
        </section>
      )}

      <p className="text-[10px] text-gray-600 mt-6 leading-relaxed">
        The headline average is the last {pace.window_days} days while the
        cutoff is still running, and switches to the cutoff period&apos;s own
        average on the 15th and end-of-month — that second figure is the one
        the bonus is settled on. Parcels are counted from the J&amp;T upload by
        submission date (PHT), across all stores. Average CPP is total ad spend
        ÷ total orders over the last {cpp.window_days} days, from the same
        P&amp;L pipeline as Net Profit. RTS rate is returned ÷ settled (delivered + returned) parcels
        over the last {rts.window_days} days — parcels still in transit are
        excluded. Data refreshes every 5 minutes; the J&amp;T numbers are only
        as current as the latest upload.
      </p>
    </div>
  );
}

function MetricCard({
  icon,
  bg,
  label,
  value,
  subtitle,
  subtitleColor = "text-gray-500",
  valueColor = "text-white",
}: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  value: string;
  subtitle?: string;
  subtitleColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
          {icon}
        </span>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {subtitle && <p className={`text-[11px] mt-1 ${subtitleColor}`}>{subtitle}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  valueColor = "text-white",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}
