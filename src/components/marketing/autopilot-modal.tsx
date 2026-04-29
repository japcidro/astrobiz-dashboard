"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  X,
  Loader2,
  Bot,
  Settings as SettingsIcon,
  List,
  Activity,
  Play,
  AlertTriangle,
  CheckCircle,
  PauseCircle,
  TrendingUp,
  Search,
} from "lucide-react";

interface AutopilotConfig {
  id: string;
  enabled: boolean;
  kill_no_purchase_spend_min: number;
  kill_high_cpa_max: number;
  auto_resume: boolean;
  updated_at: string;
}

interface WatchedCampaign {
  id: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  added_at: string;
}

interface ActionRow {
  id: string;
  run_id: string;
  action: "paused" | "resumed" | "skipped" | "error";
  ad_id: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  rule_matched: string | null;
  spend: number | null;
  purchases: number | null;
  cpa: number | null;
  status: "ok" | "error" | "skipped";
  error_message: string | null;
  created_at: string;
}

interface CampaignOption {
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  ad_count: number;
}

const fmt = (v: number | null | undefined) =>
  v == null
    ? "—"
    : `₱${v.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function AutopilotModal({
  open,
  onClose,
  campaignOptions,
  onRefreshData,
}: {
  open: boolean;
  onClose: () => void;
  campaignOptions: CampaignOption[];
  onRefreshData: () => void;
}) {
  const [tab, setTab] = useState<"rules" | "campaigns" | "activity">(
    "rules"
  );

  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [watched, setWatched] = useState<WatchedCampaign[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);

  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingWatched, setLoadingWatched] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);

  const [savingConfig, setSavingConfig] = useState(false);
  const [togglingCampaign, setTogglingCampaign] = useState<string | null>(
    null
  );
  const [runningNow, setRunningNow] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Campaigns tab filter
  const [campaignSearch, setCampaignSearch] = useState("");
  const [nurseryOnly, setNurseryOnly] = useState(false);

  // Form state mirrors config
  const [form, setForm] = useState<Partial<AutopilotConfig>>({});

  // Parse response safely — if server returned HTML (auth redirect, 404
  // page, Vercel error), don't crash with 'Unexpected token <'.
  const parseResponse = async (
    res: Response
  ): Promise<Record<string, unknown>> => {
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await res.text().catch(() => "");
      const hint = text.includes("<!DOCTYPE")
        ? "server returned an HTML page — likely a 404 or auth redirect. Try refreshing or check that the autopilot migration was run"
        : `non-JSON response (HTTP ${res.status})`;
      throw new Error(hint);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        (json.error as string) || `Request failed (HTTP ${res.status})`
      );
    }
    return json;
  };

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/facebook/autopilot/config");
      const json = await parseResponse(res);
      setConfig(json.config as AutopilotConfig | null);
      setForm((json.config as Partial<AutopilotConfig>) ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const loadWatched = useCallback(async () => {
    setLoadingWatched(true);
    try {
      const res = await fetch("/api/facebook/autopilot/watchlist");
      const json = await parseResponse(res);
      setWatched((json.campaigns as WatchedCampaign[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load watchlist");
    } finally {
      setLoadingWatched(false);
    }
  }, []);

  const loadActions = useCallback(async () => {
    setLoadingActions(true);
    try {
      const res = await fetch("/api/facebook/autopilot/actions?limit=100");
      const json = await parseResponse(res);
      setActions((json.actions as ActionRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      setLoadingActions(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRunResult(null);
    loadConfig();
    loadWatched();
    loadActions();
  }, [open, loadConfig, loadWatched, loadActions]);

  const watchedIds = useMemo(
    () => new Set(watched.map((w) => w.campaign_id)),
    [watched]
  );

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    return campaignOptions.filter((c) => {
      const name = (c.campaign_name ?? "").toLowerCase();
      if (nurseryOnly && !name.includes("nursery")) return false;
      if (q && !name.includes(q)) return false;
      return true;
    });
  }, [campaignOptions, campaignSearch, nurseryOnly]);

  const saveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await fetch("/api/facebook/autopilot/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await parseResponse(res);
      setConfig(json.config as AutopilotConfig);
      setForm(json.config as AutopilotConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleWatched = async (opt: CampaignOption) => {
    const isWatched = watchedIds.has(opt.campaign_id);
    setTogglingCampaign(opt.campaign_id);
    setError(null);
    try {
      if (isWatched) {
        const res = await fetch(
          `/api/facebook/autopilot/watchlist?campaign_id=${encodeURIComponent(
            opt.campaign_id
          )}`,
          { method: "DELETE" }
        );
        await parseResponse(res);
        setWatched((prev) =>
          prev.filter((w) => w.campaign_id !== opt.campaign_id)
        );
      } else {
        const res = await fetch("/api/facebook/autopilot/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: opt.account_id,
            campaign_id: opt.campaign_id,
            campaign_name: opt.campaign_name,
          }),
        });
        const json = await parseResponse(res);
        setWatched((prev) => [json.campaign as WatchedCampaign, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    } finally {
      setTogglingCampaign(null);
    }
  };

  const runNow = async () => {
    setRunningNow(true);
    setRunResult(null);
    setError(null);
    try {
      const res = await fetch("/api/facebook/autopilot/run", {
        method: "POST",
      });
      const json = await parseResponse(res);
      if (json.skipped) {
        setRunResult((json.reason as string) ?? "Skipped");
      } else {
        setRunResult(
          `Scanned ${json.scanned_ads} ads · paused ${json.paused} · resumed ${json.resumed ?? 0} · errors ${json.errors}`
        );
      }
      await loadActions();
      onRefreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunningNow(false);
    }
  };

  if (!open) return null;

  const enabledBadge = config?.enabled ? (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">
      ON
    </span>
  ) : (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/60 text-gray-400 font-medium">
      OFF
    </span>
  );

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-4xl h-[95dvh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-800 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Bot size={20} className="text-blue-400 shrink-0" />
            <h2 className="text-base sm:text-lg font-semibold text-white shrink-0">
              Autopilot
            </h2>
            {enabledBadge}
            <span className="text-xs text-gray-500 ml-2 truncate hidden md:inline">
              Auto-pause losers · Auto-resume recoveries · Runs hourly
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={runNow}
              disabled={runningNow || !config?.enabled}
              className="flex items-center gap-1.5 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              title={
                config?.enabled
                  ? "Run Autopilot now (ignoring cron schedule)"
                  : "Turn Autopilot ON first"
              }
            >
              {runningNow ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              <span className="hidden xs:inline sm:inline">Run now</span>
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white cursor-pointer p-1 -m-1"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {runResult && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-blue-900/20 border border-blue-700/40 text-xs text-blue-200">
            {runResult}
          </div>
        )}
        {error && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-red-900/30 border border-red-700/50 text-xs text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-200 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <TabButton
            active={tab === "rules"}
            onClick={() => setTab("rules")}
            icon={<SettingsIcon size={14} />}
            label="Rules"
          />
          <TabButton
            active={tab === "campaigns"}
            onClick={() => setTab("campaigns")}
            icon={<List size={14} />}
            label={`Campaigns (${watched.length})`}
          />
          <TabButton
            active={tab === "activity"}
            onClick={() => setTab("activity")}
            icon={<Activity size={14} />}
            label="Activity"
          />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {tab === "rules" &&
            (loadingConfig || !config ? (
              <SkeletonBlock />
            ) : (
              <div className="space-y-5">
                {/* Master switch */}
                <div className="flex items-center justify-between p-4 bg-gray-800/60 border border-gray-700/50 rounded-xl">
                  <div>
                    <p className="text-sm text-white font-medium">
                      Autopilot master switch
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      When ON, Autopilot runs hourly on watched campaigns.
                    </p>
                  </div>
                  <Switch
                    value={!!form.enabled}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, enabled: v }))
                    }
                  />
                </div>

                {/* Kill rules */}
                <div className="p-4 bg-gray-800/40 border border-gray-700/50 rounded-xl space-y-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-red-400" />
                    <p className="text-sm text-white font-medium">
                      Kill rules (pause the ad)
                    </p>
                  </div>

                  <RuleRow
                    label="No purchase yet — pause if spend reaches"
                    value={form.kill_no_purchase_spend_min ?? 330}
                    suffix="₱ with 0 purchases"
                    onChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        kill_no_purchase_spend_min: v,
                      }))
                    }
                  />
                  <RuleRow
                    label="Too expensive — pause if CPA exceeds"
                    value={form.kill_high_cpa_max ?? 380}
                    suffix="₱ (with at least 1 purchase)"
                    onChange={(v) =>
                      setForm((f) => ({ ...f, kill_high_cpa_max: v }))
                    }
                  />
                </div>

                {/* Auto-resume toggle */}
                <div className="flex items-center justify-between p-4 bg-gray-800/40 border border-gray-700/50 rounded-xl">
                  <div className="pr-3">
                    <p className="text-sm text-white font-medium flex items-center gap-2">
                      <TrendingUp size={14} className="text-green-400" />
                      Auto-resume when stats recover
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Late purchases na nag-bawas ng CPA below ₱
                      {(form.kill_high_cpa_max ?? 380).toLocaleString()} ay
                      iba-back ON ang ad. 30-min cooldown after pause to avoid
                      flapping.
                    </p>
                  </div>
                  <Switch
                    value={form.auto_resume ?? true}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, auto_resume: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-gray-500">
                    Last updated:{" "}
                    {config?.updated_at
                      ? relativeTime(config.updated_at)
                      : "—"}
                  </span>
                  <button
                    onClick={saveConfig}
                    disabled={savingConfig}
                    className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                  >
                    {savingConfig && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    Save settings
                  </button>
                </div>
              </div>
            ))}

          {tab === "campaigns" && (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                Toggle ON the campaigns you want Autopilot to watch. Only
                active ads inside ON campaigns get evaluated.
              </p>

              {/* Filter bar */}
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                  />
                  <input
                    type="text"
                    inputMode="search"
                    value={campaignSearch}
                    onChange={(e) => setCampaignSearch(e.target.value)}
                    placeholder="Search campaign name..."
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {campaignSearch && (
                    <button
                      onClick={() => setCampaignSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 cursor-pointer p-0.5"
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setNurseryOnly((v) => !v)}
                  className={`text-xs px-3 py-2 rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    nurseryOnly
                      ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                      : "bg-gray-800/60 border-gray-700 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  NURSERY only
                </button>
              </div>

              {loadingWatched ? (
                <SkeletonBlock />
              ) : campaignOptions.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No campaigns loaded. Refresh the Ad Performance page first.
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No campaigns match your filter.
                </div>
              ) : (
                <div className="border border-gray-800 rounded-lg divide-y divide-gray-800 overflow-hidden">
                  <div className="hidden sm:grid grid-cols-[1fr_60px_96px] bg-gray-800/50 text-gray-400 text-xs font-medium px-3 py-2">
                    <div className="text-left">Campaign</div>
                    <div className="text-right">Ads</div>
                    <div className="text-right">Autopilot</div>
                  </div>
                  {filteredCampaigns.map((opt) => {
                    const on = watchedIds.has(opt.campaign_id);
                    const toggling =
                      togglingCampaign === opt.campaign_id;
                    return (
                      <div
                        key={opt.campaign_id}
                        className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_60px_96px] items-center gap-2 px-3 py-2.5 ${
                          on ? "bg-blue-900/10" : ""
                        }`}
                      >
                        <div className="min-w-0 text-sm text-gray-200">
                          <div className="truncate">{opt.campaign_name}</div>
                          <div className="sm:hidden text-[11px] text-gray-500 mt-0.5">
                            {opt.ad_count} ads
                          </div>
                        </div>
                        <div className="hidden sm:block text-right text-sm text-gray-400">
                          {opt.ad_count}
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {toggling && (
                            <Loader2
                              size={14}
                              className="animate-spin text-gray-400"
                            />
                          )}
                          <Switch
                            value={on}
                            onChange={() =>
                              !toggling && toggleWatched(opt)
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "activity" && (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                Last 100 actions taken by Autopilot.
              </p>
              {loadingActions ? (
                <SkeletonBlock />
              ) : actions.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No activity yet. Autopilot will log actions here after
                  each run.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {actions.map((a) => (
                    <ActivityRow key={a.id} row={a} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors ${
        active
          ? "text-blue-400 border-b-2 border-blue-400 bg-blue-900/10"
          : "text-gray-400 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Switch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!value);
      }}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer"
      style={{
        backgroundColor: value
          ? "rgb(59 130 246 / 0.7)"
          : "rgb(75 85 99 / 0.6)",
      }}
      aria-pressed={value}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          value ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

function RuleRow({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-gray-300 flex-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <span className="text-gray-500 text-xs min-w-[130px]">{suffix}</span>
    </div>
  );
}

function ActivityRow({ row }: { row: ActionRow }) {
  const iconFor = () => {
    if (row.status === "error")
      return <AlertTriangle size={14} className="text-red-400" />;
    if (row.action === "paused")
      return <PauseCircle size={14} className="text-yellow-400" />;
    if (row.action === "resumed")
      return <TrendingUp size={14} className="text-green-400" />;
    if (row.action === "skipped")
      return <CheckCircle size={14} className="text-gray-500" />;
    return <AlertTriangle size={14} className="text-red-400" />;
  };

  const reason = (() => {
    if (row.action === "resumed") return "Stats recovered — turned back ON";
    if (row.rule_matched === "no_purchase")
      return `Spent ${fmt(row.spend)} · 0 purchases`;
    if (row.rule_matched === "high_cpa")
      return `CPA ${fmt(row.cpa)} > threshold`;
    return row.error_message ?? "—";
  })();

  return (
    <div
      className={`flex items-start gap-3 p-2.5 rounded-lg border ${
        row.status === "error"
          ? "bg-red-900/10 border-red-700/30"
          : row.action === "resumed"
            ? "bg-green-900/10 border-green-700/30"
            : row.action === "paused"
              ? "bg-yellow-900/10 border-yellow-700/30"
              : "bg-gray-800/30 border-gray-700/40"
      }`}
    >
      <div className="pt-0.5">{iconFor()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-300">
            {row.action}
          </span>
          <span
            className="text-sm text-white truncate max-w-[320px]"
            title={row.ad_name ?? ""}
          >
            {row.ad_name ?? row.ad_id}
          </span>
          {row.status === "error" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 uppercase">
              error
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-0.5 truncate">
          {row.campaign_name && (
            <span className="text-gray-500">{row.campaign_name} · </span>
          )}
          {reason}
        </div>
      </div>
      <div className="text-xs text-gray-500 whitespace-nowrap pt-0.5">
        {relativeTime(row.created_at)}
      </div>
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-12 bg-gray-800/40 rounded-lg animate-pulse"
        />
      ))}
    </div>
  );
}
