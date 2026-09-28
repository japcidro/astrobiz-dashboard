"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-xl p-4 ${className}`}>{children}</div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mt-4 mb-2 first:mt-0">
      {children}
    </p>
  );
}

export function Chip({
  on,
  onClick,
  children,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
        on
          ? "border-purple-500 bg-purple-500/15 text-white"
          : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
      }`}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  primary,
  ghost,
  busy,
  disabled,
  title,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  ghost?: boolean;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
  const look = primary
    ? "bg-purple-600 hover:bg-purple-500 text-white"
    : ghost
      ? "text-gray-300 hover:text-white hover:bg-white/5"
      : "bg-gray-700/70 hover:bg-gray-700 text-white border border-gray-600";
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} title={title} className={`${base} ${look} ${className}`}>
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export const TONE: Record<"ok" | "warn" | "bad" | "muted" | "run", string> = {
  ok: "text-green-400 bg-green-900/40 border-green-800/60",
  warn: "text-orange-300 bg-orange-900/40 border-orange-800/60",
  bad: "text-red-300 bg-red-900/40 border-red-800/60",
  muted: "text-gray-400 bg-gray-700/40 border-gray-600/60",
  run: "text-amber-300 bg-amber-900/30 border-amber-800/60",
};

export function Pill({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export const credits = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} cr`;

export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
