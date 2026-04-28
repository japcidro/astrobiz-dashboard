"use client";

import { useState } from "react";
import {
  CheckCircle,
  Copy,
  Sparkles,
  AlertCircle,
  Trophy,
} from "lucide-react";
import { parseScripts, type ParsedScript } from "@/lib/ai/script-parser";
import type {
  ApprovedScript,
  CreateApprovedScriptInput,
} from "@/lib/ai/approved-scripts-types";
import type {
  EmittedAngle,
  EmittedAnglesBatch,
  EmittedFormatsBatch,
  EmittedScript,
  EmittedScriptsBatch,
} from "@/lib/ai/tools/generators";

interface Props {
  content: string;
  toolType: "angles" | "scripts" | "formats";
  storeName: string;
  threadId: string | null;
  messageIndex: number;
  existingApprovals: Map<string, ApprovedScript>;
  onApproved: (script: ApprovedScript) => void;
  // Structured tool_use payload from /api/ai/generate. When present,
  // renderer prefers it over markdown parsing — gives typed badges,
  // variation shifts, winner provenance. Null on old threads.
  structured?: Record<string, unknown> | null;
}

export function AssistantMessageRenderer({
  content,
  toolType,
  storeName,
  threadId,
  messageIndex,
  existingApprovals,
  onApproved,
  structured,
}: Props) {
  // Structured path — preferred when available (new threads).
  if (structured) {
    if (toolType === "angles") {
      const batch = structured as unknown as EmittedAnglesBatch;
      const angles = batch.angles ?? [];
      if (angles.length > 0) {
        return (
          <div className="space-y-4">
            {batch.batch_intent && (
              <p className="text-xs italic text-gray-400">
                {batch.batch_intent}
              </p>
            )}
            {angles.map((angle, i) => (
              <AngleCard key={i} angle={angle} />
            ))}
          </div>
        );
      }
    }

    if (toolType === "scripts") {
      const batch = structured as unknown as EmittedScriptsBatch;
      const scripts = batch.scripts ?? [];
      if (scripts.length > 0) {
        return (
          <div className="space-y-4">
            {batch.batch_intent && (
              <p className="text-xs italic text-gray-400">
                {batch.batch_intent}
              </p>
            )}
            {scripts.map((s, i) => (
              <StructuredScriptCard
                key={`${s.script_number}-${i}`}
                script={s}
                storeName={storeName}
                threadId={threadId}
                messageIndex={messageIndex}
                existingApproval={
                  existingApprovals.get(scriptKey(s.script_number, s.angle_title)) ?? null
                }
                onApproved={onApproved}
              />
            ))}
          </div>
        );
      }
    }

    if (toolType === "formats") {
      const batch = structured as unknown as EmittedFormatsBatch;
      const expansions = batch.expansions ?? [];
      if (expansions.length > 0) {
        return (
          <div className="space-y-4">
            {batch.source_summary && (
              <p className="text-xs italic text-gray-400">
                {batch.source_summary}
              </p>
            )}
            {expansions.map((e, i) => (
              <FormatCard key={i} expansion={e} />
            ))}
          </div>
        );
      }
    }
  }

  // Legacy path — markdown parsing for old threads (pre-v2 tool_use).
  const scripts = toolType === "scripts" ? parseScripts(content) : [];
  if (scripts.length === 0) {
    return <RawMessage content={content} />;
  }

  return (
    <div className="space-y-4">
      {scripts.map((script, i) => (
        <ScriptCard
          key={`${script.script_number ?? "u"}-${i}`}
          script={script}
          storeName={storeName}
          threadId={threadId}
          messageIndex={messageIndex}
          existingApproval={
            existingApprovals.get(
              scriptKey(script.script_number, script.angle_title)
            ) ?? null
          }
          onApproved={onApproved}
        />
      ))}
    </div>
  );
}

export function scriptKey(num: number | null, title: string): string {
  return `${num ?? "null"}:${title.trim().toLowerCase()}`;
}

// ─── Shared badge components ───

function ClassificationBadges({
  awareness_level,
  funnel_stage,
  hook_framework,
  strategic_format,
  video_format,
}: {
  awareness_level?: string | null;
  funnel_stage?: string | null;
  hook_framework?: string | null;
  strategic_format?: string | null;
  video_format?: string | null;
}) {
  const badges: { label: string; value: string; color: string }[] = [];
  if (awareness_level)
    badges.push({
      label: "AWR",
      value: awareness_level,
      color: "bg-indigo-900/30 text-indigo-300 border-indigo-700/50",
    });
  if (funnel_stage)
    badges.push({
      label: "STG",
      value: funnel_stage,
      color: "bg-cyan-900/30 text-cyan-300 border-cyan-700/50",
    });
  if (hook_framework)
    badges.push({
      label: "HOOK",
      value: hook_framework,
      color: "bg-rose-900/30 text-rose-300 border-rose-700/50",
    });
  if (strategic_format)
    badges.push({
      label: "STR",
      value: strategic_format,
      color: "bg-amber-900/30 text-amber-300 border-amber-700/50",
    });
  if (video_format)
    badges.push({
      label: "VID",
      value: video_format,
      color: "bg-emerald-900/30 text-emerald-300 border-emerald-700/50",
    });
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {badges.map((b, i) => (
        <span
          key={i}
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${b.color}`}
          title={b.label}
        >
          {b.value}
        </span>
      ))}
    </div>
  );
}

function VariableShiftChips({ shifts }: { shifts: string[] }) {
  if (!shifts || shifts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      <span className="text-[10px] text-gray-500">shifts:</span>
      {shifts.map((s, i) => (
        <span
          key={i}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function WinnerPill({ winner }: { winner?: string }) {
  if (!winner) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-300 border border-yellow-700/50">
      <Trophy size={10} />
      Inspired by: {winner}
    </span>
  );
}

// ─── Structured AngleCard ───

function AngleCard({ angle }: { angle: EmittedAngle }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const text = `${angle.title}\n\n${angle.big_idea}\n\nHook: ${angle.copy_hook}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">{angle.title}</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {angle.avatar}
            </p>
            <ClassificationBadges
              awareness_level={angle.awareness_level}
              funnel_stage={angle.funnel_stage}
              hook_framework={angle.hook_framework}
              strategic_format={angle.strategic_format}
              video_format={angle.video_format_candidates?.join(" / ")}
            />
            <VariableShiftChips shifts={angle.variable_shift_vs_batch} />
            {angle.inspired_by_winner && (
              <div className="mt-1.5">
                <WinnerPill winner={angle.inspired_by_winner} />
              </div>
            )}
          </div>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 text-xs text-gray-500 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            {copied ? (
              <>
                <CheckCircle size={12} className="text-green-400" />
                Copied
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Big Idea
          </p>
          <p className="text-sm text-gray-200">{angle.big_idea}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Copy Hook (0-3s)
          </p>
          <p className="text-sm text-gray-200 italic">
            &ldquo;{angle.copy_hook}&rdquo;
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Reasoning
          </p>
          <p className="text-sm text-gray-300">{angle.reasoning}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Structured ScriptCard (uses EmittedScript directly) ───

function StructuredScriptCard({
  script,
  storeName,
  threadId,
  messageIndex,
  existingApproval,
  onApproved,
}: {
  script: EmittedScript;
  storeName: string;
  threadId: string | null;
  messageIndex: number;
  existingApproval: ApprovedScript | null;
  onApproved: (script: ApprovedScript) => void;
}) {
  const [approving, setApproving] = useState(false);
  const [approvedId, setApprovedId] = useState<string | null>(
    existingApproval?.id ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const isApproved = approvedId !== null;

  const handleApprove = async () => {
    if (approving || isApproved) return;
    setApproving(true);
    setError(null);

    const payload: CreateApprovedScriptInput = {
      store_name: storeName,
      source_thread_id: threadId,
      source_message_index: messageIndex,
      script_number: script.script_number,
      angle_title: script.angle_title,
      avatar: script.avatar,
      angle_type: script.angle_type,
      intensity: script.intensity,
      capacity: script.capacity,
      hook: script.hook,
      body_script: script.body_script,
      variant_hooks: script.variant_hooks,
      // v2 fields — populated only when structured payload was available
      awareness_level: script.awareness_level,
      funnel_stage: script.funnel_stage,
      hook_framework: script.hook_framework,
      strategic_format: script.strategic_format,
      video_format: script.video_format,
      variable_shifts: script.variable_shift_vs_batch,
    };

    try {
      const res = await fetch("/api/ai/approved-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to approve");
      setApprovedId(json.script.id);
      onApproved(json.script);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const copySection = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(label);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const typeColor = ANGLE_TYPE_COLORS[script.angle_type] ?? "bg-gray-800 text-gray-400 border-gray-700";

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        isApproved
          ? "border-emerald-700/50 bg-emerald-900/10"
          : "border-gray-700/50 bg-gray-900/30"
      }`}
    >
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-gray-500">
              #{script.script_number}
            </span>
            <h3 className="text-sm font-semibold text-white truncate">
              {script.angle_title}
            </h3>
          </div>
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-gray-400">
            <span>{script.avatar}</span>
            <span
              className={`px-1.5 py-0.5 rounded border ${typeColor} font-medium`}
            >
              {script.angle_type}
            </span>
            <span className="text-gray-500">Int {script.intensity}</span>
            <span className="text-gray-500">Cap {script.capacity}</span>
          </div>
          <ClassificationBadges
            awareness_level={script.awareness_level}
            funnel_stage={script.funnel_stage}
            hook_framework={script.hook_framework}
            strategic_format={script.strategic_format}
            video_format={script.video_format}
          />
          <VariableShiftChips shifts={script.variable_shift_vs_batch} />
          {script.inspired_by_winner && (
            <div className="mt-1.5">
              <WinnerPill winner={script.inspired_by_winner} />
            </div>
          )}
        </div>
        <button
          onClick={handleApprove}
          disabled={approving || isApproved}
          className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-default ${
            isApproved
              ? "bg-emerald-600/30 text-emerald-300"
              : "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          }`}
        >
          {isApproved ? (
            <>
              <CheckCircle size={12} />
              Approved
            </>
          ) : approving ? (
            <>
              <Sparkles size={12} className="animate-pulse" />
              Approving...
            </>
          ) : (
            <>
              <CheckCircle size={12} />
              Approve
            </>
          )}
        </button>
      </div>
      <div className="px-4 py-3 space-y-3">
        <Section
          label="HOOK"
          text={script.hook}
          copiedLabel={copiedSection}
          onCopy={() => copySection(script.hook, "hook")}
          copyKey="hook"
        />
        <Section
          label="BODY SCRIPT"
          text={script.body_script}
          copiedLabel={copiedSection}
          onCopy={() => copySection(script.body_script, "body")}
          copyKey="body"
        />
        {script.variant_hooks.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                Variant Hooks
              </p>
            </div>
            <ul className="space-y-1 text-sm text-gray-300">
              {script.variant_hooks.map((v, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-gray-600 flex-shrink-0">{i + 1}.</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={12} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Structured FormatCard ───

function FormatCard({ expansion }: { expansion: EmittedFormatsBatch["expansions"][number] }) {
  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50">
        <h3 className="text-sm font-semibold text-white">
          {expansion.target_video_format}
        </h3>
        <VariableShiftChips shifts={expansion.variable_shift_vs_batch} />
      </div>
      <div className="px-4 py-3 space-y-2 text-sm">
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Why this fits
          </p>
          <p className="text-gray-200">{expansion.fit_reason}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Script shift
          </p>
          <p className="text-gray-200">{expansion.script_shift}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Risk
          </p>
          <p className="text-gray-300">{expansion.risk}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Legacy components (markdown path) ───

function RawMessage({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
      <button
        onClick={handleCopy}
        className="mt-2 text-xs text-gray-500 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
      >
        {copied ? (
          <CheckCircle size={12} className="text-green-400" />
        ) : (
          <Copy size={12} />
        )}
        Copy
      </button>
    </>
  );
}

interface ScriptCardProps {
  script: ParsedScript;
  storeName: string;
  threadId: string | null;
  messageIndex: number;
  existingApproval: ApprovedScript | null;
  onApproved: (script: ApprovedScript) => void;
}

const ANGLE_TYPE_COLORS: Record<string, string> = {
  D: "bg-pink-900/30 text-pink-300 border-pink-700/50",
  E: "bg-blue-900/30 text-blue-300 border-blue-700/50",
  M: "bg-purple-900/30 text-purple-300 border-purple-700/50",
  B: "bg-amber-900/30 text-amber-300 border-amber-700/50",
};

function ScriptCard({
  script,
  storeName,
  threadId,
  messageIndex,
  existingApproval,
  onApproved,
}: ScriptCardProps) {
  const [approving, setApproving] = useState(false);
  const [approvedId, setApprovedId] = useState<string | null>(
    existingApproval?.id ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const isApproved = approvedId !== null;

  const handleApprove = async () => {
    if (approving || isApproved) return;
    setApproving(true);
    setError(null);

    const payload: CreateApprovedScriptInput = {
      store_name: storeName,
      source_thread_id: threadId,
      source_message_index: messageIndex,
      script_number: script.script_number,
      angle_title: script.angle_title,
      avatar: script.avatar,
      angle_type: script.angle_type,
      intensity: script.intensity,
      capacity: script.capacity,
      hook: script.hook,
      body_script: script.body_script,
      variant_hooks: script.variant_hooks,
    };

    try {
      const res = await fetch("/api/ai/approved-scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to approve");
      setApprovedId(json.script.id);
      onApproved(json.script);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const copySection = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(label);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const typeColor = script.angle_type
    ? ANGLE_TYPE_COLORS[script.angle_type]
    : "bg-gray-800 text-gray-400 border-gray-700";

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        isApproved
          ? "border-emerald-700/50 bg-emerald-900/10"
          : "border-gray-700/50 bg-gray-900/30"
      }`}
    >
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {script.script_number !== null && (
              <span className="text-xs font-mono text-gray-500">
                #{script.script_number}
              </span>
            )}
            <h3 className="text-sm font-semibold text-white truncate">
              {script.angle_title}
            </h3>
          </div>
          <div className="flex items-center flex-wrap gap-1.5 text-xs text-gray-400">
            {script.avatar && <span>{script.avatar}</span>}
            {script.angle_type && (
              <span
                className={`px-1.5 py-0.5 rounded border ${typeColor} font-medium`}
              >
                {script.angle_type}
              </span>
            )}
            {script.intensity !== null && (
              <span className="text-gray-500">Int {script.intensity}</span>
            )}
            {script.capacity !== null && (
              <span className="text-gray-500">Cap {script.capacity}</span>
            )}
          </div>
        </div>

        <button
          onClick={handleApprove}
          disabled={approving || isApproved}
          className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-default ${
            isApproved
              ? "bg-emerald-600/30 text-emerald-300"
              : "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          }`}
        >
          {isApproved ? (
            <>
              <CheckCircle size={12} />
              Approved
            </>
          ) : approving ? (
            <>
              <Sparkles size={12} className="animate-pulse" />
              Approving...
            </>
          ) : (
            <>
              <CheckCircle size={12} />
              Approve
            </>
          )}
        </button>
      </div>
      <div className="px-4 py-3 space-y-3">
        <Section
          label="HOOK"
          text={script.hook}
          copiedLabel={copiedSection}
          onCopy={() => copySection(script.hook, "hook")}
          copyKey="hook"
        />
        <Section
          label="BODY SCRIPT"
          text={script.body_script}
          copiedLabel={copiedSection}
          onCopy={() => copySection(script.body_script, "body")}
          copyKey="body"
        />
        {script.variant_hooks.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                Variant Hooks
              </p>
            </div>
            <ul className="space-y-1 text-sm text-gray-300">
              {script.variant_hooks.map((v, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-gray-600 flex-shrink-0">{i + 1}.</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={12} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
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
      <div className="flex items-center justify-between mb-1">
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
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
        {text}
      </div>
    </div>
  );
}
