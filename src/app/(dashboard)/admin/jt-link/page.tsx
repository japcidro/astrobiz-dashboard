"use client";

import { useState } from "react";
import { Link2, Play, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

interface BackfillResult {
  total: number;
  matched: number;
  unmatched: number;
  daysScanned: number;
  trackingMapSize?: number;
  dryRun?: boolean;
  message?: string;
  error?: string;
}

export default function JtLinkPage() {
  const [dryResult, setDryResult] = useState<BackfillResult | null>(null);
  const [realResult, setRealResult] = useState<BackfillResult | null>(null);
  const [loading, setLoading] = useState<"dry" | "real" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setError(null);
    setLoading(dryRun ? "dry" : "real");
    try {
      const url = dryRun
        ? "/api/admin/jt-backfill-shopify-link?dry_run=1"
        : "/api/admin/jt-backfill-shopify-link";
      const res = await fetch(url, { method: "POST" });
      const json = (await res.json()) as BackfillResult;
      if (!res.ok) {
        setError(json.error || `Request failed: ${res.status}`);
        return;
      }
      if (dryRun) setDryResult(json);
      else setRealResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(null);
    }
  }

  const dryMatchRate =
    dryResult && dryResult.total > 0
      ? (dryResult.matched / dryResult.total) * 100
      : null;
  const dryReady = dryMatchRate !== null && dryMatchRate >= 90;
  const dryYellowZone =
    dryMatchRate !== null && dryMatchRate >= 70 && dryMatchRate < 90;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link2 className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-semibold">J&T → Shopify Link Backfill</h1>
          <p className="text-sm text-gray-600">
            One-time tool to retroactively connect existing J&T parcels to their
            Shopify orders via tracking_number = waybill. After this runs,
            per-date margins on the P&L dashboard become cohort-correct.
          </p>
        </div>
      </div>

      {/* Step 1: Dry run */}
      <div className="border rounded-lg p-5 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Step 1 — Dry run (safe, no changes)</h2>
          {dryResult && <CheckCircle2 className="w-5 h-5 text-green-600" />}
        </div>
        <p className="text-sm text-gray-600">
          Counts how many existing rows can be matched without touching the
          database. Use this to verify match rate before running for real.
        </p>
        <button
          onClick={() => run(true)}
          disabled={loading !== null}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "dry" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {dryResult ? "Re-run Dry Run" : "Run Dry Run"}
        </button>

        {dryResult && (
          <div className="mt-3 p-4 bg-gray-50 rounded text-sm space-y-1">
            {dryResult.message ? (
              <p className="text-green-700">{dryResult.message}</p>
            ) : (
              <>
                <Stat label="Total unmatched rows" value={dryResult.total} />
                <Stat
                  label="Would match"
                  value={`${dryResult.matched} (${dryMatchRate?.toFixed(1)}%)`}
                  good={dryReady}
                />
                <Stat
                  label="Would stay unmatched"
                  value={dryResult.unmatched}
                  bad={dryResult.unmatched > dryResult.total * 0.1}
                />
                <Stat
                  label="Shopify lookback window"
                  value={`${dryResult.daysScanned} days`}
                />
                <Stat
                  label="Shopify orders fetched"
                  value={dryResult.trackingMapSize ?? "—"}
                />
                {dryReady && (
                  <p className="mt-2 text-green-700 font-medium">
                    ✓ Match rate ≥ 90% — safe to run for real.
                  </p>
                )}
                {dryYellowZone && (
                  <p className="mt-2 text-yellow-700 font-medium">
                    ⚠ Match rate 70-90% — proceed but check unmatched waybills
                    afterward.
                  </p>
                )}
                {!dryReady && !dryYellowZone && (
                  <p className="mt-2 text-red-700 font-medium">
                    ✗ Match rate &lt; 70% — investigate before backfilling.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Real run */}
      <div className="border rounded-lg p-5 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Step 2 — Run for real</h2>
          {realResult && <CheckCircle2 className="w-5 h-5 text-green-600" />}
        </div>
        <p className="text-sm text-gray-600">
          Writes shopify_order_id / shopify_order_date / customer_email to every
          matched row. Idempotent — running twice is safe; only NULL columns
          get filled.
        </p>
        <button
          onClick={() => run(false)}
          disabled={loading !== null || !dryResult}
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "real" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run Backfill
        </button>
        {!dryResult && (
          <p className="text-xs text-gray-500">
            Run the dry run first so you can confirm the match rate before
            writing.
          </p>
        )}

        {realResult && (
          <div className="mt-3 p-4 bg-green-50 rounded text-sm space-y-1">
            {realResult.message ? (
              <p className="text-green-700">{realResult.message}</p>
            ) : (
              <>
                <Stat label="Rows scanned" value={realResult.total} />
                <Stat label="Rows updated" value={realResult.matched} good />
                <Stat
                  label="Stayed unmatched"
                  value={realResult.unmatched}
                  bad={realResult.unmatched > realResult.total * 0.1}
                />
                <p className="mt-2 text-green-700 font-medium">
                  ✓ Backfill complete. Refresh the P&L dashboard to see updated
                  per-date margins.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div className="text-sm text-red-700">
            <p className="font-medium">Something went wrong</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500 border-t pt-4 mt-6 space-y-1">
        <p>
          <strong>How matching works:</strong> for each unmatched J&T row, we
          look up the Shopify order whose fulfillments[].tracking_number equals
          the row&apos;s waybill. When found, we copy over order id, name,
          created_at (PHT date), and customer email.
        </p>
        <p>
          <strong>Why some rows stay unmatched:</strong> manual fulfillment
          without a tracking number, voided/cancelled orders, or orders older
          than the 90-day Shopify lookback window.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string | number;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600">{label}</span>
      <span
        className={`font-medium ${
          good ? "text-green-700" : bad ? "text-red-700" : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
