"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  X,
  Search,
  Archive,
  Film,
  Play,
  Wrench,
  AlertCircle,
  StickyNote,
  Trophy,
  Zap,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  APPROVED_SCRIPT_STATUSES,
  ANGLE_TYPE_LABELS,
  STATUS_LABELS,
  type ApprovedScript,
  type ApprovedScriptStatus,
  type ApprovedScriptAngleType,
} from "@/lib/ai/approved-scripts-types";
import type { ScriptPerformance, AdPerformanceSummary } from "@/lib/ai/script-performance";

interface Props {
  storeName: string;
}

const ANGLE_TYPE_COLORS: Record<string, string> = {
  D: "bg-pink-900/30 text-pink-300 border-pink-700/50",
  E: "bg-blue-900/30 text-blue-300 border-blue-700/50",
  M: "bg-purple-900/30 text-purple-300 border-purple-700/50",
  B: "bg-amber-900/30 text-amber-300 border-amber-700/50",
};

const STATUS_ICONS: Record<ApprovedScriptStatus, typeof CheckCircle> = {
  approved: CheckCircle,
  in_production: Wrench,
  shot: Film,
  live: Play,
  archived: Archive,
};

const STATUS_COLORS: Record<ApprovedScriptStatus, string> = {
  approved: "bg-emerald-900/30 text-emerald-300 border-emerald-700/50",
  in_production: "bg-yellow-900/30 text-yellow-300 border-yellow-700/50",
  shot: "bg-sky-900/30 text-sky-300 border-sky-700/50",
  live: "bg-green-900/30 text-green-300 border-green-700/50",
  archived: "bg-gray-800 text-gray-500 border-gray-700",
};

type StatusFilter = ApprovedScriptStatus | "all" | "active";
type TypeFilter = ApprovedScriptAngleType | "all";

export function ApprovedLibrary({ storeName }: Props) {
  const [scripts, setScripts] = useState<ApprovedScript[]>([]);
  const [perf, setPerf] = useState<Record<string, ScriptPerformance>>({});
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfWarning, setPerfWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ApprovedScript | null>(null);

  const load = useCallback(async () => {
    if (!storeName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ai/approved-scripts?store=${encodeURIComponent(storeName)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setScripts(json.scripts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [storeName]);

  const loadPerf = useCallback(async () => {
    if (!storeName) return;
    setPerfLoading(true);
    setPerfWarning(null);
    try {
      const res = await fetch(
        `/api/ai/approved-scripts/performance?store=${encodeURIComponent(storeName)}`
      );
      const json = await res.json();
      if (res.ok) {
        setPerf(json.performance || {});
        if (json.warning) setPerfWarning(json.warning as string);
      }
    } catch {
      // Perf failures are non-blocking — the library still renders scripts.
    } finally {
      setPerfLoading(false);
    }
  }, [storeName]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPerf();
  }, [loadPerf]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scripts.filter((s) => {
      if (statusFilter === "active") {
        if (s.status === "archived") return false;
      } else if (statusFilter !== "all" && s.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== "all" && s.angle_type !== typeFilter) return false;
      if (q) {
        const hay = `${s.angle_title} ${s.hook} ${s.body_script} ${s.avatar ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scripts, statusFilter, typeFilter, search]);

  const handleUpdated = (updated: ApprovedScript) => {
    setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelected((prev) => (prev?.id === updated.id ? updated : prev));
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search angle, hook, body..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="active">Active (excl. archived)</option>
          <option value="all">All</option>
          {APPROVED_SCRIPT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="all">All types</option>
          <option value="D">D — Desire</option>
          <option value="E">E — Experience</option>
          <option value="M">M — Emotion</option>
          <option value="B">B — Behavior</option>
        </select>

        <button
          onClick={() => {
            load();
            loadPerf();
          }}
          disabled={loading || perfLoading}
          className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={loading || perfLoading ? "animate-spin" : ""}
          />
          Refresh
        </button>

        <span className="text-xs text-gray-500 ml-auto">
          {filtered.length} / {scripts.length}
        </span>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {perfWarning && (
        <div className="p-2 bg-yellow-900/20 border border-yellow-700/50 rounded-lg text-yellow-300 text-xs flex items-center gap-2">
          <AlertCircle size={12} />
          {perfWarning}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && scripts.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw size={20} className="animate-spin text-gray-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm">
            {scripts.length === 0
              ? "No approved scripts yet. Approve scripts from the Chat tab to see them here."
              : "No scripts match your filters."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((script) => (
              <ScriptCard
                key={script.id}
                script={script}
                perf={perf[script.id] ?? null}
                onClick={() => setSelected(script)}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <ScriptDetailModal
          script={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

function ScriptCard({
  script,
  perf,
  onClick,
}: {
  script: ApprovedScript;
  perf: ScriptPerformance | null;
  onClick: () => void;
}) {
  const StatusIcon = STATUS_ICONS[script.status];
  const typeColor = script.angle_type
    ? ANGLE_TYPE_COLORS[script.angle_type]
    : "bg-gray-800 text-gray-400 border-gray-700";

  return (
    <button
      onClick={onClick}
      className="text-left bg-gray-800/50 hover:bg-gray-800/80 border border-gray-700/50 rounded-xl p-4 transition-colors cursor-pointer flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <h3 className="text-sm font-semibold text-white truncate">
              {script.angle_title}
            </h3>
            {perf && <TierBadge tier={perf.tier} size="sm" />}
          </div>
          {script.avatar && (
            <p className="text-xs text-gray-400 truncate">{script.avatar}</p>
          )}
        </div>
        <span
          className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${STATUS_COLORS[script.status]}`}
        >
          <StatusIcon size={10} />
          {STATUS_LABELS[script.status]}
        </span>
      </div>

      <p className="text-sm text-gray-300 line-clamp-2">{script.hook}</p>

      {/* Performance strip — only if at least one ad has been launched. */}
      {perf && perf.submitted_count > 0 && (
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400 pt-2 border-t border-gray-700/50">
          <span>
            <span className="text-gray-500">Spend</span>{" "}
            <span className="text-gray-200 font-medium">
              ₱{formatCompact(perf.spend)}
            </span>
          </span>
          <span>
            <span className="text-gray-500">Purch</span>{" "}
            <span className="text-gray-200 font-medium">{perf.purchases}</span>
          </span>
          <span>
            <span className="text-gray-500">CPP</span>{" "}
            <span
              className={`font-medium ${cppColor(perf.cpp, perf.purchases)}`}
            >
              {perf.purchases > 0 ? `₱${formatCompact(perf.cpp)}` : "—"}
            </span>
          </span>
          <span>
            <span className="text-gray-500">ROAS</span>{" "}
            <span className="text-gray-200 font-medium">
              {perf.roas > 0 ? perf.roas.toFixed(1) : "—"}
            </span>
          </span>
          <span className="ml-auto text-gray-500">
            {perf.submitted_count} ad{perf.submitted_count === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-auto pt-2 border-t border-gray-700/50">
        {script.angle_type && (
          <span
            className={`px-1.5 py-0.5 rounded border ${typeColor} font-medium`}
          >
            {script.angle_type}
          </span>
        )}
        {script.intensity !== null && <span>Int {script.intensity}</span>}
        {script.capacity !== null && <span>Cap {script.capacity}</span>}
        <span className="ml-auto">
          {new Date(script.approved_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </button>
  );
}

function TierBadge({
  tier,
  size = "sm",
}: {
  tier: ScriptPerformance["tier"];
  size?: "sm" | "md";
}) {
  if (tier === "no_data") return null;

  const config: Record<
    Exclude<ScriptPerformance["tier"], "no_data">,
    { label: string; icon: typeof Trophy; className: string }
  > = {
    stable_winner: {
      label: "Winner",
      icon: Trophy,
      className: "bg-yellow-500/20 text-yellow-300 border-yellow-500/50",
    },
    spike: {
      label: "Spike",
      icon: Zap,
      className: "bg-sky-500/20 text-sky-300 border-sky-500/50",
    },
    stable_loser: {
      label: "Losing",
      icon: TrendingDown,
      className: "bg-red-900/30 text-red-300 border-red-700/50",
    },
    dead: {
      label: "Dead",
      icon: Minus,
      className: "bg-gray-800 text-gray-500 border-gray-700",
    },
  };

  const c = config[tier];
  const Icon = c.icon;
  const sizing =
    size === "sm"
      ? "text-[10px] px-1.5 py-0.5 gap-0.5"
      : "text-xs px-2 py-0.5 gap-1";
  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${c.className} ${sizing}`}
    >
      <Icon size={size === "sm" ? 10 : 12} />
      {c.label}
    </span>
  );
}

function formatCompact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(0);
}

function cppColor(cpp: number, purchases: number): string {
  if (purchases === 0) return "text-gray-500";
  if (cpp > 0 && cpp <= 200) return "text-emerald-400";
  if (cpp <= 300) return "text-yellow-300";
  return "text-red-300";
}

function ScriptDetailModal({
  script,
  onClose,
  onUpdated,
}: {
  script: ApprovedScript;
  onClose: () => void;
  onUpdated: (updated: ApprovedScript) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(script.production_notes ?? "");
  const [videoUrl, setVideoUrl] = useState(script.final_video_url ?? "");
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);
  const [videoDirty, setVideoDirty] = useState(false);

  const [detailPerf, setDetailPerf] = useState<ScriptPerformance | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfWarning, setPerfWarning] = useState<string | null>(null);

  const loadDetailPerf = useCallback(async () => {
    setPerfLoading(true);
    setPerfWarning(null);
    try {
      const res = await fetch(
        `/api/ai/approved-scripts/${script.id}/performance`
      );
      const json = await res.json();
      if (res.ok) {
        setDetailPerf(json.performance || null);
        if (json.warning) setPerfWarning(json.warning as string);
      }
    } catch {
      // Non-blocking
    } finally {
      setPerfLoading(false);
    }
  }, [script.id]);

  useEffect(() => {
    loadDetailPerf();
  }, [loadDetailPerf]);

  const updateStatus = async (status: ApprovedScriptStatus) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/approved-scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
      onUpdated(json.script);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const saveFields = async () => {
    if (!notesDirty && !videoDirty) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (notesDirty) body.production_notes = notes || null;
      if (videoDirty) body.final_video_url = videoUrl || null;
      const res = await fetch(`/api/ai/approved-scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      onUpdated(json.script);
      setNotesDirty(false);
      setVideoDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const copySection = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(label);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white">{script.angle_title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              {script.avatar && <span>{script.avatar}</span>}
              {script.angle_type && (
                <span className="text-gray-300">
                  {ANGLE_TYPE_LABELS[script.angle_type]}
                </span>
              )}
              {script.intensity !== null && <span>Int {script.intensity}</span>}
              {script.capacity !== null && <span>Cap {script.capacity}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status switcher */}
        <div className="px-6 py-3 border-b border-gray-800 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-gray-500 mr-1">Status:</span>
          {APPROVED_SCRIPT_STATUSES.map((s) => {
            const Icon = STATUS_ICONS[s];
            return (
              <button
                key={s}
                onClick={() => updateStatus(s)}
                disabled={saving || script.status === s}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors cursor-pointer disabled:cursor-default ${
                  script.status === s
                    ? STATUS_COLORS[s]
                    : "bg-gray-800 text-gray-500 border-gray-700 hover:text-white hover:border-gray-600"
                }`}
              >
                <Icon size={11} />
                {STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-5">
          <PerformanceSection
            perf={detailPerf}
            loading={perfLoading}
            warning={perfWarning}
          />

          <DetailSection
            label="HOOK"
            text={script.hook}
            copiedLabel={copiedSection}
            onCopy={() => copySection(script.hook, "hook")}
            copyKey="hook"
          />

          <DetailSection
            label="BODY SCRIPT"
            text={script.body_script}
            copiedLabel={copiedSection}
            onCopy={() => copySection(script.body_script, "body")}
            copyKey="body"
          />

          {script.variant_hooks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  Variant Hooks
                </p>
                <button
                  onClick={() =>
                    copySection(
                      script.variant_hooks
                        .map((v, i) => `${i + 1}. ${v}`)
                        .join("\n"),
                      "variants"
                    )
                  }
                  className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedSection === "variants" ? (
                    <>
                      <CheckCircle size={10} className="text-green-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy size={10} />
                      Copy all
                    </>
                  )}
                </button>
              </div>
              <ul className="space-y-1.5 text-sm text-gray-300">
                {script.variant_hooks.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gray-600 flex-shrink-0">{i + 1}.</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Production notes */}
          <div>
            <label className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
              <StickyNote size={10} />
              Production Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
              rows={3}
              placeholder="Notes for the videographer / editor..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
          </div>

          {/* Final video URL */}
          <div>
            <label className="block mb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
              Final Video URL
            </label>
            <input
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value);
                setVideoDirty(true);
              }}
              placeholder="https://drive.google.com/... or Meta Ads link"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {script.final_video_url && (
              <a
                href={script.final_video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <ExternalLink size={11} />
                Open current video
              </a>
            )}
          </div>

          {(notesDirty || videoDirty) && (
            <div className="flex items-center gap-2">
              <button
                onClick={saveFields}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button
                onClick={() => {
                  setNotes(script.production_notes ?? "");
                  setVideoUrl(script.final_video_url ?? "");
                  setNotesDirty(false);
                  setVideoDirty(false);
                }}
                className="text-sm text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          {error && (
            <div className="p-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs flex items-center gap-2">
              <AlertCircle size={12} />
              {error}
            </div>
          )}

          <p className="text-[10px] text-gray-600">
            Approved {new Date(script.approved_at).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  label,
  text,
  onCopy,
  copiedLabel,
  copyKey,
}: {
  label: string;
  text: string;
  onCopy: () => void;
  copiedLabel: string | null;
  copyKey: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
          {label}
        </p>
        <button
          onClick={onCopy}
          className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
        >
          {copiedLabel === copyKey ? (
            <>
              <CheckCircle size={10} className="text-green-400" />
              Copied
            </>
          ) : (
            <>
              <Copy size={10} />
              Copy
            </>
          )}
        </button>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2">
        {text}
      </div>
    </div>
  );
}

function PerformanceSection({
  perf,
  loading,
  warning,
}: {
  perf: ScriptPerformance | null;
  loading: boolean;
  warning: string | null;
}) {
  if (loading) {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-gray-400">
        <RefreshCw size={12} className="animate-spin" />
        Loading performance...
      </div>
    );
  }

  if (warning) {
    return (
      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-4 py-3 text-xs text-yellow-300 flex items-center gap-2">
        <AlertCircle size={12} />
        {warning}
      </div>
    );
  }

  if (!perf || perf.submitted_count === 0) {
    return (
      <div className="bg-gray-800/30 border border-dashed border-gray-700/50 rounded-lg px-4 py-3 text-xs text-gray-500">
        Not launched yet. Pick this script in Create Ad to start tracking
        performance.
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            Performance (last 14d)
          </p>
          <TierBadge tier={perf.tier} size="md" />
        </div>
        <span className="text-[10px] text-gray-500">
          {perf.submitted_count} ad{perf.submitted_count === 1 ? "" : "s"}
          {perf.live_count > 0 && ` · ${perf.live_count} live`}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3 text-center">
        <Stat label="Spend" value={`₱${formatCompact(perf.spend)}`} />
        <Stat label="Purchases" value={String(perf.purchases)} />
        <Stat
          label="CPP"
          value={perf.purchases > 0 ? `₱${formatCompact(perf.cpp)}` : "—"}
          className={cppColor(perf.cpp, perf.purchases)}
        />
        <Stat
          label="ROAS"
          value={perf.roas > 0 ? perf.roas.toFixed(2) : "—"}
        />
      </div>

      {perf.ads && perf.ads.length > 0 && (
        <div className="pt-3 border-t border-gray-700/50">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Per-ad breakdown
          </p>
          <div className="space-y-1.5">
            {perf.ads.map((ad) => (
              <AdRow key={ad.fb_ad_id} ad={ad} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-sm font-semibold text-white ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function AdRow({ ad }: { ad: AdPerformanceSummary }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-md px-3 py-2 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-white truncate">{ad.draft_name}</p>
          {ad.tier !== "no_data" && (
            <TierBadge
              tier={ad.tier as ScriptPerformance["tier"]}
              size="sm"
            />
          )}
        </div>
        <p className="text-[10px] text-gray-500 font-mono truncate">
          {ad.fb_ad_id}
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-3 text-[10px]">
        <span className="text-gray-400">
          ₱{formatCompact(ad.spend)}
        </span>
        <span className="text-gray-400">
          {ad.purchases} purch
        </span>
        <span className={`font-medium ${cppColor(ad.cpp, ad.purchases)}`}>
          {ad.purchases > 0 ? `₱${formatCompact(ad.cpp)}` : "—"}
        </span>
      </div>
    </div>
  );
}
