"use client";

import { useCallback, useState } from "react";
import {
  Trash2,
  Archive,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

interface EmptyCampaign {
  id: string;
  name: string;
  account_id: string;
  effective_status: string;
  ad_count: number;
  adset_statuses: string[];
  spend: number;
  impressions: number;
  created_time: string | null;
}

type Mode = "archive" | "delete";

function whenCreated(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Clears out the campaigns a half-failed promote leaves behind.
//
// Only campaigns that cannot be doing anything are listed at all — no ads,
// no spend ever, every ad set paused, and never the campaign a store scales
// into. The server re-checks all of that against Facebook immediately
// before acting, so a stale list can't be used to remove something that has
// since gone live.
export function EmptyCampaignsCleanup() {
  const [rows, setRows] = useState<EmptyCampaign[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    id: string;
    mode: Mode;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setConfirming(null);
    try {
      const res = await fetch("/api/marketing/campaigns/empty");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scan failed");
      setRows((json.campaigns as EmptyCampaign[]) ?? []);
      setWarnings((json.warnings as string[]) ?? []);
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  async function act(id: string, mode: Mode) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/marketing/campaigns/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: id, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Could not ${mode} it`);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setSuccess(
        mode === "delete"
          ? `Deleted "${json.campaign_name}".`
          : `Archived "${json.campaign_name}" — undo it in Ads Manager if you need it back.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${mode} it`);
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Trash2 size={16} className="text-gray-400" />
            Empty campaigns
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            A promote that fails part-way leaves its campaign and ad set
            behind. They can&apos;t spend — a cloned ad set is always created
            paused, and there is no ad in it — but they clutter every
            dropdown. Only campaigns with no ads, no spend ever, every ad set
            paused, and no store scaling into them are listed here.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:border-gray-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {scanned ? "Rescan" : "Scan ad accounts"}
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0">{error}</div>
        </div>
      )}
      {success && (
        <div className="mb-3 p-2.5 bg-emerald-900/30 border border-emerald-700/50 rounded-lg text-emerald-300 text-xs flex items-start gap-2">
          <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0">{success}</div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mb-3 p-2.5 bg-yellow-900/20 border border-yellow-700/40 rounded-lg text-yellow-300 text-[11px]">
          Some ad accounts could not be read, so this list may be
          incomplete:
          <ul className="mt-1 space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}

      {!scanned ? (
        <p className="text-xs text-gray-500">
          Scanning reads every campaign in your selected ad accounts, so it
          runs when you ask rather than on every page load.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">
          Nothing to clean up — no empty campaigns in the accounts scanned.
        </p>
      ) : (
        <div className="border border-gray-800 rounded-lg divide-y divide-gray-800">
          {rows.map((r) => {
            const isBusy = busyId === r.id;
            const confirm = confirming?.id === r.id ? confirming.mode : null;
            return (
              <div key={r.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{r.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {r.account_id} · {r.effective_status.toLowerCase()} ·{" "}
                      {r.adset_statuses.length === 0
                        ? "no ad sets"
                        : `${r.adset_statuses.length} paused ad set${r.adset_statuses.length === 1 ? "" : "s"}`}
                      , no ads, never spent
                      {r.created_time ? ` · created ${whenCreated(r.created_time)}` : ""}
                    </p>
                  </div>
                  {confirm ? null : (
                    <div className="flex-shrink-0 flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          setConfirming({ id: r.id, mode: "archive" })
                        }
                        disabled={isBusy}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-gray-800 border border-gray-700 text-gray-300 rounded hover:border-gray-500 cursor-pointer disabled:opacity-40"
                      >
                        <Archive size={11} />
                        Archive
                      </button>
                      <button
                        onClick={() =>
                          setConfirming({ id: r.id, mode: "delete" })
                        }
                        disabled={isBusy}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-gray-800 border border-red-900/60 text-red-300 rounded hover:border-red-600 cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 size={11} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {confirm && (
                  <div className="mt-2 p-2.5 bg-gray-800/60 border border-gray-700/60 rounded-lg">
                    <p className="text-[11px] text-gray-300 flex items-start gap-1.5">
                      <AlertTriangle
                        size={12}
                        className={`mt-0.5 flex-shrink-0 ${confirm === "delete" ? "text-red-400" : "text-gray-400"}`}
                      />
                      {confirm === "delete" ? (
                        <span>
                          Delete <span className="text-white">{r.name}</span>{" "}
                          on Facebook. This cannot be undone by anyone —
                          archive instead if you are not certain.
                        </span>
                      ) : (
                        <span>
                          Archive <span className="text-white">{r.name}</span>.
                          It leaves every dropdown and Ads Manager&apos;s
                          default view, and you can bring it back from Ads
                          Manager.
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => setConfirming(null)}
                        disabled={isBusy}
                        className="px-2 py-1 text-[11px] text-gray-400 hover:text-white cursor-pointer disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => act(r.id, confirm)}
                        disabled={isBusy}
                        className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded text-white cursor-pointer disabled:opacity-40 ${
                          confirm === "delete"
                            ? "bg-red-700 hover:bg-red-600"
                            : "bg-gray-700 hover:bg-gray-600"
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : confirm === "delete" ? (
                          <Trash2 size={11} />
                        ) : (
                          <Archive size={11} />
                        )}
                        Yes, {confirm} it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
