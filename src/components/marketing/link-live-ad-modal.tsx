"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Search, RefreshCw, AlertCircle, Link2 } from "lucide-react";

interface AdRow {
  account: string;
  account_id: string;
  ad: string;
  ad_id: string;
  status: string;
  spend: number;
  purchases: number;
  cpa: number;
  thumbnail_url: string | null;
}

interface AccountInfo {
  id: string;
  name: string;
  account_id: string;
  is_active: boolean;
}

interface ScriptByAd {
  script_id: string;
  angle_title: string;
  source: "manual" | "draft";
}

interface Props {
  open: boolean;
  scriptId: string;
  scriptTitle: string;
  // fb_ad_ids already linked to THIS script — rendered as "Linked" so the
  // marketer doesn't accidentally link the same ad twice (the upsert would
  // succeed silently, but the UI should make it obvious).
  alreadyLinkedAdIds: Set<string>;
  onClose: () => void;
  onLinked: () => void;
}

export function LinkLiveAdModal({
  open,
  scriptId,
  scriptTitle,
  alreadyLinkedAdIds,
  onClose,
  onLinked,
}: Props) {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [otherScriptByAd, setOtherScriptByAd] = useState<
    Record<string, ScriptByAd>
  >({});
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Reuse the dashboard's main ad listing — already cached + rate-limit
      // resilient. include_zero_spend=1 surfaces ads that didn't spend in the
      // window so the marketer can still tag a freshly-launched ad.
      const res = await fetch(
        `/api/facebook/all-ads?account=ALL&date_preset=last_7d&include_zero_spend=1`
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json.error as string) || "Failed to load Facebook ads"
        );
      }
      const adRows: AdRow[] = (json.data || []).map(
        (r: Record<string, unknown>) => ({
          account: (r.account as string) || "",
          account_id: (r.account_id as string) || "",
          ad: (r.ad as string) || "(unnamed ad)",
          ad_id: (r.ad_id as string) || "",
          status: (r.status as string) || "UNKNOWN",
          spend: (r.spend as number) || 0,
          purchases: (r.purchases as number) || 0,
          cpa: (r.cpa as number) || 0,
          thumbnail_url: (r.thumbnail_url as string | null) || null,
        })
      );
      setAds(adRows);
      setAccounts((json.accounts || []) as AccountInfo[]);

      // Cross-reference: which of these ads is already linked to a DIFFERENT
      // script? We grey those out and show "Linked to: <other script>".
      const adIds = adRows.map((a) => a.ad_id).filter(Boolean);
      if (adIds.length > 0) {
        try {
          const mapRes = await fetch("/api/ai/approved-scripts/by-ads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ad_ids: adIds }),
          });
          const mapJson = await mapRes.json();
          if (mapRes.ok) {
            setOtherScriptByAd(
              (mapJson.mapping || {}) as Record<string, ScriptByAd>
            );
          }
        } catch {
          // Non-blocking — picker still works without cross-reference info
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSearch("");
      setAccountFilter("ALL");
      setStatusFilter("active");
      load();
    }
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads.filter((a) => {
      if (accountFilter !== "ALL" && a.account_id !== accountFilter) {
        return false;
      }
      if (statusFilter === "active" && a.status !== "ACTIVE") return false;
      if (q) {
        const hay = `${a.ad} ${a.account} ${a.ad_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ads, search, accountFilter, statusFilter]);

  const handleLink = async (ad: AdRow) => {
    setLinking(ad.ad_id);
    setError(null);
    try {
      const res = await fetch("/api/ai/approved-scripts/link-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fb_ad_id: ad.ad_id,
          fb_ad_account_id: ad.account_id,
          approved_script_id: scriptId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error((json.error as string) || "Failed to link ad");
      }
      onLinked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link ad");
    } finally {
      setLinking(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-800 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Link2 size={18} />
              Link to Live Ad
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              For: <span className="text-gray-200">{scriptTitle}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ad name or id..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ALL">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "active" | "all")
            }
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="active">Active only</option>
            <option value="all">All statuses</option>
          </select>

          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>

          <span className="text-xs text-gray-500 ml-auto">
            {filtered.length} / {ads.length}
          </span>
        </div>

        {error && (
          <div className="mx-6 mt-3 p-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-center gap-2">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading && ads.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw size={20} className="animate-spin text-gray-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500 text-sm">
              {ads.length === 0
                ? "No ads found in selected accounts."
                : "No ads match your filters."}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((ad) => {
                const isAlreadyLinkedHere = alreadyLinkedAdIds.has(ad.ad_id);
                const otherScript = otherScriptByAd[ad.ad_id];
                const linkedToOther =
                  !!otherScript && otherScript.script_id !== scriptId;

                return (
                  <AdPickerRow
                    key={ad.ad_id}
                    ad={ad}
                    isAlreadyLinkedHere={isAlreadyLinkedHere}
                    linkedToOther={linkedToOther}
                    otherScriptTitle={
                      linkedToOther ? otherScript.angle_title : null
                    }
                    linking={linking === ad.ad_id}
                    disabled={linking !== null}
                    onLink={() => handleLink(ad)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-3 flex items-center justify-between text-[11px] text-gray-500">
          <span>
            Linking lets us track this ad&apos;s performance against the script
            and feed winner detection.
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AdPickerRow({
  ad,
  isAlreadyLinkedHere,
  linkedToOther,
  otherScriptTitle,
  linking,
  disabled,
  onLink,
}: {
  ad: AdRow;
  isAlreadyLinkedHere: boolean;
  linkedToOther: boolean;
  otherScriptTitle: string | null;
  linking: boolean;
  disabled: boolean;
  onLink: () => void;
}) {
  const isActive = ad.status === "ACTIVE";

  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
        isAlreadyLinkedHere
          ? "bg-emerald-900/20 border-emerald-700/40"
          : "bg-gray-800/40 border-gray-700/50 hover:bg-gray-800/80"
      }`}
    >
      <div className="flex-shrink-0 w-12 h-12 bg-gray-900 border border-gray-700 rounded overflow-hidden">
        {ad.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.thumbnail_url}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-[9px]">
            no preview
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-white truncate">{ad.ad}</p>
          <span
            className={`flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-medium ${
              isActive
                ? "bg-green-900/30 text-green-300 border-green-700/50"
                : "bg-gray-800 text-gray-500 border-gray-700"
            }`}
          >
            {ad.status}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
          <span className="truncate">{ad.account}</span>
          <span className="font-mono text-gray-600 truncate">{ad.ad_id}</span>
        </div>
        {(ad.spend > 0 || ad.purchases > 0) && (
          <div className="flex items-center gap-3 text-[10px] text-gray-400 mt-1">
            <span>₱{Math.round(ad.spend).toLocaleString()} spend (7d)</span>
            <span>{ad.purchases} purch</span>
            {ad.purchases > 0 && (
              <span>CPP ₱{Math.round(ad.cpa).toLocaleString()}</span>
            )}
          </div>
        )}
        {linkedToOther && otherScriptTitle && (
          <p className="text-[10px] text-yellow-400 mt-1">
            Currently linked to: {otherScriptTitle} (will be replaced)
          </p>
        )}
      </div>

      <button
        onClick={onLink}
        disabled={disabled || isAlreadyLinkedHere}
        className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
          isAlreadyLinkedHere
            ? "bg-emerald-700/40 text-emerald-300 cursor-default"
            : "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        }`}
      >
        {isAlreadyLinkedHere
          ? "Linked"
          : linking
          ? "Linking..."
          : linkedToOther
          ? "Re-link"
          : "Link"}
      </button>
    </div>
  );
}
