"use client";

import { useState } from "react";
import { CheckCircle, Copy, Sparkles, AlertCircle } from "lucide-react";
import { parseScripts, type ParsedScript } from "@/lib/ai/script-parser";
import type {
  ApprovedScript,
  CreateApprovedScriptInput,
} from "@/lib/ai/approved-scripts-types";

interface Props {
  content: string;
  toolType: "angles" | "scripts" | "formats";
  storeName: string;
  threadId: string | null;
  messageIndex: number;
  existingApprovals: Map<string, ApprovedScript>; // key: `${script_number ?? "null"}:${angle_title}`
  onApproved: (script: ApprovedScript) => void;
}

export function AssistantMessageRenderer({
  content,
  toolType,
  storeName,
  threadId,
  messageIndex,
  existingApprovals,
  onApproved,
}: Props) {
  const scripts = toolType === "scripts" ? parseScripts(content) : [];

  // Fallback: render raw markdown if not a script response or parsing yields nothing.
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
            existingApprovals.get(scriptKey(script.script_number, script.angle_title)) ?? null
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
      {/* Header */}
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

      {/* Body */}
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
