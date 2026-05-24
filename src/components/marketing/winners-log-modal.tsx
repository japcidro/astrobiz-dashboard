"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  Loader2,
  Copy,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Trophy,
  AlertTriangle,
  Minus,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  FileText,
} from "lucide-react";
import {
  parseWinnersLog,
  type LogEntry,
  type LogResult,
  type ParsedLog,
} from "@/lib/ai/winners-log-parser";

interface Props {
  storeFilter: string;
  onClose: () => void;
}

interface GenerateResponse {
  markdown: string;
  model: string;
  ad_count: number;
  store: string | null;
  tokens_used: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
}

type View = "cards" | "raw";

export function WinnersLogModal({ storeFilter, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>("cards");

  const parsed = useMemo<ParsedLog | null>(
    () => (result ? parseWinnersLog(result.markdown) : null),
    [result]
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs =
        storeFilter && storeFilter !== "ALL"
          ? `?store=${encodeURIComponent(storeFilter)}`
          : "";
      const res = await fetch(
        `/api/marketing/winners-pool/generate-log${qs}`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      setResult(json as GenerateResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);

  useEffect(() => {
    run();
  }, [run]);

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    // Fixed filename per request — the file always overwrites the prior
    // version in the user's Claude Project knowledge base, so a single
    // canonical name keeps the upload step zero-friction. Date / brand
    // context is already in the document body.
    const filename = "ILP_Winning_Ad_Log.md";
    const blob = new Blob([result.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const winnerCount =
    parsed?.entries.filter((e) => e.result === "WINNER").length ?? 0;
  const loserCount =
    parsed?.entries.filter((e) => e.result === "LOSER").length ?? 0;
  const flaggedCount =
    parsed?.entries.filter((e) => e.compliance_flags_count > 0).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-5xl bg-gray-900 border border-gray-700 rounded-xl shadow-xl my-6 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0 gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Sparkles size={18} className="text-amber-400" />
            <h2 className="text-lg font-semibold text-white truncate">
              Winning &amp; Losing Ads Log
            </h2>
            {result && parsed && (
              <span className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                <span>
                  {result.ad_count} ad{result.ad_count === 1 ? "" : "s"}
                  {result.store && result.store !== "ALL"
                    ? ` · ${result.store}`
                    : ""}
                </span>
                <span className="inline-flex items-center gap-1 text-green-400">
                  <Trophy size={11} /> {winnerCount}
                </span>
                <span className="inline-flex items-center gap-1 text-red-300">
                  <AlertTriangle size={11} /> {loserCount}
                </span>
                {flaggedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <ShieldAlert size={11} /> {flaggedCount} flagged
                  </span>
                )}
              </span>
            )}
          </div>
          {result && (
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => setView("cards")}
                className={`text-[11px] px-2 py-1 rounded cursor-pointer ${
                  view === "cards"
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setView("raw")}
                className={`text-[11px] px-2 py-1 rounded cursor-pointer ${
                  view === "raw"
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Raw .md
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-[300px] space-y-3">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-12">
              <Loader2 size={28} className="animate-spin text-amber-400" />
              <p className="text-sm">Generating the v2.0 Log document…</p>
              <p className="text-xs text-gray-500 text-center max-w-md">
                Claude Opus 4.7 is reading every tagged ad&apos;s transcript,
                metrics, deconstruction, and hook rate, then producing the
                7-block Log entry for each. Typically 60-180 seconds.
              </p>
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Generation failed</p>
                <p className="text-xs mt-1 break-words">{error}</p>
              </div>
              <button
                onClick={run}
                className="text-xs bg-red-700/30 hover:bg-red-700/50 border border-red-700/50 rounded px-2 py-1 cursor-pointer flex items-center gap-1"
              >
                <RefreshCw size={11} />
                Retry
              </button>
            </div>
          )}
          {result && view === "raw" && (
            <pre className="whitespace-pre-wrap text-xs text-gray-200 font-mono leading-relaxed bg-gray-950 border border-gray-800 rounded-lg p-4">
              {result.markdown}
            </pre>
          )}
          {result && view === "cards" && parsed && (
            <>
              {/* Synthesis at the top — Patterns Observed + Anti-Collapse +
                  Untested Territory — matches the .md file's top-down order.
                  The Script Creator reads this file from the top, so the
                  takeaways and the Untested Territory menu must appear
                  before the per-ad entries. */}
              {parsed.patterns_markdown && (
                <ClosingSection
                  icon={<FileText size={14} className="text-gray-400" />}
                  title="Patterns Observed"
                  markdown={parsed.patterns_markdown}
                  defaultOpen
                />
              )}
              {parsed.anti_collapse_markdown && (
                <ClosingSection
                  icon={<AlertTriangle size={14} className="text-amber-400" />}
                  title="Anti-Collapse Rule + Untested Territory"
                  markdown={parsed.anti_collapse_markdown}
                  defaultOpen
                />
              )}
              {parsed.entries.length === 0 && (
                <div className="text-xs text-gray-500">
                  No entries parsed from the model output — switch to Raw .md
                  to see the unstructured response.
                </div>
              )}
              {parsed.entries.map((entry, i) => (
                <LogEntryCard key={i} entry={entry} />
              ))}
            </>
          )}
        </div>

        {result && (
          <div className="flex items-center justify-between p-3 border-t border-gray-700 flex-shrink-0 gap-2 flex-wrap">
            <div className="text-[11px] text-gray-500">
              {result.model}
              {result.tokens_used && (
                <>
                  {" · "}
                  {(result.tokens_used.input_tokens ?? 0).toLocaleString()} in ·{" "}
                  {(result.tokens_used.output_tokens ?? 0).toLocaleString()} out
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={run}
                className="text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
              <button
                onClick={handleCopy}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? (
                  <>
                    <CheckCircle2 size={12} className="text-green-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={handleDownload}
                className="text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={12} />
                Download .md
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBadge({ result }: { result: LogResult }) {
  if (result === "WINNER") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-900/40 text-green-300 border border-green-700/50 rounded px-1.5 py-0.5">
        <Trophy size={10} />
        WINNER
      </span>
    );
  }
  if (result === "LOSER") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-900/40 text-red-300 border border-red-700/50 rounded px-1.5 py-0.5">
        <AlertTriangle size={10} />
        LOSER
      </span>
    );
  }
  if (result === "INCONCLUSIVE") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-gray-800 text-gray-300 border border-gray-700 rounded px-1.5 py-0.5">
        <Minus size={10} />
        INCONCLUSIVE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-gray-800 text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">
      —
    </span>
  );
}

function ComplianceBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium bg-green-900/30 text-green-300 border border-green-700/50 rounded px-1.5 py-0.5"
        title="No compliance flags raised — see BLOCK 6"
      >
        <ShieldCheck size={10} />
        compliant
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium bg-red-900/40 text-red-300 border border-red-700/50 rounded px-1.5 py-0.5"
      title={`${count} compliance flag${count === 1 ? "" : "s"} in BLOCK 6 — even on a winner, fix before re-cut or scaling`}
    >
      <ShieldAlert size={10} />
      {count} flag{count === 1 ? "" : "s"}
    </span>
  );
}

function LogEntryCard({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(true);
  const accent =
    entry.result === "WINNER"
      ? "border-green-700/50 bg-green-900/10"
      : entry.result === "LOSER"
        ? "border-red-700/50 bg-red-900/10"
        : "border-gray-700 bg-gray-900/30";

  return (
    <div className={`border rounded-xl overflow-hidden ${accent}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 cursor-pointer text-left"
      >
        {open ? (
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
        )}
        <span className="text-sm font-semibold text-white flex-1 truncate">
          {entry.title}
        </span>
        <ResultBadge result={entry.result} />
        <ComplianceBadge count={entry.compliance_flags_count} />
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-white/10 text-sm text-gray-200 leading-relaxed">
          <MarkdownBody markdown={entry.markdown} />
        </div>
      )}
    </div>
  );
}

function ClosingSection({
  icon,
  title,
  markdown,
  defaultOpen,
}: {
  icon: React.ReactNode;
  title: string;
  markdown: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border border-gray-700 rounded-xl overflow-hidden bg-gray-900/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 cursor-pointer text-left"
      >
        {open ? (
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
        )}
        {icon}
        <span className="text-sm font-semibold text-white flex-1 truncate">
          {title}
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-white/10 text-sm text-gray-200 leading-relaxed">
          <MarkdownBody markdown={markdown} />
        </div>
      )}
    </div>
  );
}

function MarkdownBody({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1: ({ children }) => (
          <h3 className="text-sm font-bold text-white mt-2 mb-1">{children}</h3>
        ),
        h2: ({ children }) => (
          <h3 className="text-sm font-bold text-white mt-2 mb-1">{children}</h3>
        ),
        h3: ({ children }) => (
          <h4 className="text-xs font-semibold text-white mt-1.5 mb-1">
            {children}
          </h4>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
        ),
        strong: ({ children }) => (
          <strong className="text-white font-semibold">{children}</strong>
        ),
        code: ({ children }) => (
          <code className="bg-gray-900/70 px-1.5 py-0.5 rounded text-emerald-300 text-[12px] font-mono">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="bg-gray-900/70 p-3 rounded-lg overflow-x-auto text-[12px] font-mono my-2 whitespace-pre-wrap">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs border border-gray-700 w-full">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-gray-700 px-2 py-1 bg-gray-900/40 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-700 px-2 py-1">{children}</td>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-amber-500/50 pl-3 my-2 text-gray-300 italic">
            {children}
          </blockquote>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
