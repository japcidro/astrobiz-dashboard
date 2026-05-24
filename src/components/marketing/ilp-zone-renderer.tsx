"use client";

// Shared 8-zone renderer for the ILP Ad Deconstruction Engine output.
// Used by both the standalone /marketing/deconstructor page (paste-text
// workflow) and the IlpDeconstructionModal opened from the Creatives
// page (ad-row-click workflow).

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ZoneId } from "@/lib/ai/ilp-deconstruct-parser";

export const ZONE_COLORS: Record<ZoneId, string> = {
  A: "border-blue-700/50 bg-blue-900/10",
  B: "border-gray-700 bg-gray-900/30",
  C: "border-purple-700/50 bg-purple-900/10",
  D: "border-amber-700/50 bg-amber-900/10",
  E: "border-emerald-700/50 bg-emerald-900/10",
  F: "border-red-700/50 bg-red-900/10",
  G: "border-teal-700/50 bg-teal-900/10",
  H: "border-emerald-600 bg-emerald-900/15",
};

export const ZONE_ORDER: ZoneId[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

export interface DeconstructionLike {
  ad_origin: string | null;
  ad_title: string | null;
  compliance_flags_count: number;
  model: string;
  tokens_used: {
    input_tokens?: number;
    output_tokens?: number;
  } | null;
}

export function ComplianceFlagsBadge({ count }: { count: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border ${
        count > 0
          ? "bg-red-900/40 text-red-300 border-red-700/50"
          : "bg-green-900/30 text-green-300 border-green-700/50"
      }`}
      title={
        count > 0
          ? `${count} compliance/mechanism flag${count === 1 ? "" : "s"} — see Zone E & F`
          : "No flags raised in Mechanism Fidelity or Compliance Audit"
      }
    >
      {count > 0 ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
      {count} flag{count === 1 ? "" : "s"}
    </span>
  );
}

export function ZoneCard({
  id,
  title,
  markdown,
  open,
  onToggle,
}: {
  id: ZoneId;
  title: string;
  markdown: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(
      `## ZONE ${id} — ${title}\n\n${markdown}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${ZONE_COLORS[id]}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 cursor-pointer text-left"
      >
        {open ? (
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
        )}
        <span className="text-[10px] font-bold text-gray-500 w-4">{id}</span>
        <span className="text-sm font-semibold text-white flex-1 truncate">
          {title}
        </span>
        <span
          onClick={handleCopy}
          className="text-[11px] text-gray-500 hover:text-white px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-1"
        >
          {copied ? (
            <>
              <CheckCircle2 size={11} className="text-green-400" />
              Copied
            </>
          ) : (
            <>
              <Copy size={11} />
              Copy
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-white/10 text-sm text-gray-200 leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="mb-2 last:mb-0">{children}</p>
              ),
              h1: ({ children }) => (
                <h3 className="text-sm font-bold text-white mt-2 mb-1">
                  {children}
                </h3>
              ),
              h2: ({ children }) => (
                <h3 className="text-sm font-bold text-white mt-2 mb-1">
                  {children}
                </h3>
              ),
              h3: ({ children }) => (
                <h4 className="text-xs font-semibold text-white mt-1.5 mb-1">
                  {children}
                </h4>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-5 mb-2 space-y-0.5">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-5 mb-2 space-y-0.5">
                  {children}
                </ol>
              ),
              strong: ({ children }) => (
                <strong className="text-white font-semibold">{children}</strong>
              ),
              code: ({ children }) => (
                <code className="bg-gray-900/70 px-1.5 py-0.5 rounded text-emerald-300 text-[12px] font-mono">
                  {children}
                </code>
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
            }}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export type ZonesRecord = {
  A: { id: "A"; title: string; markdown: string };
  B: { id: "B"; title: string; markdown: string };
  C: { id: "C"; title: string; markdown: string };
  D: { id: "D"; title: string; markdown: string };
  E: { id: "E"; title: string; markdown: string };
  F: { id: "F"; title: string; markdown: string };
  G: { id: "G"; title: string; markdown: string };
  H: { id: "H"; title: string; markdown: string };
};

// Convenience: render all 8 zones with collapsible cards. The container
// component owns the open/closed state set.
export function ZoneList({
  zones,
  openZones,
  onToggle,
}: {
  zones: ZonesRecord;
  openZones: Set<ZoneId>;
  onToggle: (id: ZoneId) => void;
}) {
  return (
    <>
      {ZONE_ORDER.map((id) => {
        const zone = zones[id];
        if (!zone || !zone.markdown.trim()) return null;
        return (
          <ZoneCard
            key={id}
            id={id}
            title={zone.title}
            markdown={zone.markdown}
            open={openZones.has(id)}
            onToggle={() => onToggle(id)}
          />
        );
      })}
    </>
  );
}
