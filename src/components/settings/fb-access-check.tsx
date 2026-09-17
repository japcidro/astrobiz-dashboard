"use client";

import { useState } from "react";
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Video,
} from "lucide-react";
import type { FbAccessReport } from "@/app/api/admin/fb-access-check/route";

export function FbAccessCheck() {
  const [report, setReport] = useState<FbAccessReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/fb-access-check");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Check failed");
      setReport(json.data as FbAccessReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-white font-medium flex items-center gap-2">
            <ShieldCheck size={16} className="text-blue-400" />
            Access Check
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            What the connected token can actually reach. Run this when a Page is
            missing from Create Ad, or an ad video won&apos;t play — both usually
            mean the same thing.
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {report ? "Re-check" : "Run check"}
        </button>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {report && (
        <div className="mt-4 space-y-4">
          {/* Findings */}
          <div className="space-y-2">
            {report.findings.map((f, i) => {
              const good = f.startsWith("No problems found");
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                    good
                      ? "bg-green-900/20 border border-green-700/40 text-green-300"
                      : "bg-yellow-900/20 border border-yellow-700/40 text-yellow-200"
                  }`}
                >
                  {good ? (
                    <CheckCircle size={15} className="shrink-0 mt-0.5 text-green-400" />
                  ) : (
                    <AlertTriangle size={15} className="shrink-0 mt-0.5 text-yellow-400" />
                  )}
                  <span>{f}</span>
                </div>
              );
            })}
          </div>

          {/* Token */}
          <div className="text-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Token
            </p>
            <div className="flex items-center gap-2 flex-wrap text-gray-300">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  report.token_valid
                    ? "bg-green-900/30 text-green-400"
                    : "bg-red-900/30 text-red-400"
                }`}
              >
                {report.token_valid ? "Valid" : "Invalid"}
              </span>
              {report.token_type && (
                <span className="text-xs text-gray-500">{report.token_type}</span>
              )}
              {report.app_name && (
                <span className="text-xs text-gray-500">· {report.app_name}</span>
              )}
              <span className="text-xs text-gray-500">
                ·{" "}
                {report.expires_at
                  ? `expires ${new Date(report.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : "never expires"}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap mt-2">
              {report.scopes.map((s) => (
                <span
                  key={s}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-700/50 text-gray-400"
                >
                  {s}
                </span>
              ))}
              {report.missing_scopes.map((m) => (
                <span
                  key={m.scope}
                  title={`Missing — needed for ${m.needed_for}`}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-900/30 text-red-400"
                >
                  {m.scope} ✕
                </span>
              ))}
            </div>
          </div>

          {/* Pages */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Pages ({report.pages.length})
            </p>
            {report.pages.length === 0 ? (
              <p className="text-sm text-gray-500">
                No Pages visible to this token at all.
              </p>
            ) : (
              <div className="space-y-1">
                {report.pages.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-gray-800/60 border border-gray-700/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white">{p.name}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        via {p.sources.join(", ")}
                      </p>
                      {p.tasks.length > 0 && (
                        <p className="text-[10px] text-gray-600 mt-0.5">
                          tasks: {p.tasks.join(", ").toLowerCase()}
                        </p>
                      )}
                      {p.can_advertise === false && (
                        <p className="text-xs text-yellow-400/80 mt-1">
                          No ADVERTISE task — creating an ad on this Page will
                          fail.
                        </p>
                      )}
                      {!p.can_play_video && p.reason && (
                        <p className="text-xs text-yellow-400/80 mt-1">{p.reason}</p>
                      )}
                    </div>
                    <span
                      title={
                        p.can_play_video
                          ? "Can mint a Page token — ad videos will play"
                          : "No Page token — ad videos on this Page will not play"
                      }
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                        p.can_play_video
                          ? "bg-green-900/30 text-green-400"
                          : "bg-red-900/30 text-red-400"
                      }`}
                    >
                      {p.can_play_video ? <Video size={10} /> : <XCircle size={10} />}
                      {p.can_play_video ? "Video OK" : "No video"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(report.page_source_counts).length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mt-2">
                {Object.entries(report.page_source_counts).map(([src, n]) => (
                  <span
                    key={src}
                    title={`${src} returned ${n} Page${n === 1 ? "" : "s"}`}
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      n > 0
                        ? "bg-gray-700/50 text-gray-400"
                        : "bg-gray-800 text-gray-600"
                    }`}
                  >
                    {src}: {n}
                  </span>
                ))}
              </div>
            )}

            {report.page_warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {report.page_warnings.map((w, i) => (
                  <li key={i} className="text-xs text-gray-500">
                    · {w}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Ad accounts */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Ad accounts ({report.ad_accounts.length})
            </p>
            <div className="flex items-center gap-1 flex-wrap">
              {report.ad_accounts.map((a) => (
                <span
                  key={a.id}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-gray-700/50 text-gray-300"
                >
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
