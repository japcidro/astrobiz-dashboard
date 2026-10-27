"use client";

// Bulk Create: copy suggested from each uploaded image.
//
// The bar above the table (on/off, language, where the tone comes from, a
// "suggest for all empty rows" button), the tags under each copy field
// ("Suggested" / "Edited by you" / Undo), and the popover that shows what
// Claude saw next to the three fields and the headline alternatives. The
// table owns the per-row state and calls `requestSuggestion`.

import { useEffect } from "react";
import { Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type { SuggestCopyLanguage } from "@/lib/marketing/store-defaults";
import {
  COPY_FIELDS,
  suggestedState,
  type BulkAdRow,
  type CopyField,
  type CopySuggestion,
} from "./types";

// ── Settings ────────────────────────────────────────────────────────────────

export interface SuggestSettings {
  enabled: boolean;
  language: SuggestCopyLanguage;
  use_winners: boolean;
}

export const DEFAULT_SUGGEST_SETTINGS: SuggestSettings = {
  enabled: true,
  language: "taglish",
  use_winners: true,
};

export interface SuggestProps {
  settings: SuggestSettings;
  onChange: (next: SuggestSettings) => void;
  storeId: string | null;
}

const LANGUAGE_LABELS: Record<SuggestCopyLanguage, string> = {
  taglish: "Taglish (75% English)",
  english: "English",
  tagalog: "Tagalog-heavy",
};

// ── The API call ────────────────────────────────────────────────────────────

/** What the server used for the last suggestion, shown on the bar. */
export interface SuggestContextInfo {
  store: string | null;
  brand_profile: boolean;
  winners: number;
}

export interface SuggestRequest {
  storeId: string | null;
  language: SuggestCopyLanguage;
  useWinners: boolean;
  instruction?: string;
  previous?: { primary_text: string; headline: string; description: string } | null;
}

export async function requestSuggestion(
  file: File,
  opts: SuggestRequest
): Promise<{ suggestion: CopySuggestion; context: SuggestContextInfo }> {
  const fd = new FormData();
  fd.append("image", file);
  if (opts.storeId) fd.append("store_id", opts.storeId);
  fd.append("language", opts.language);
  fd.append("use_winners", opts.useWinners ? "1" : "0");
  if (opts.instruction) fd.append("instruction", opts.instruction);
  if (opts.previous) fd.append("previous", JSON.stringify(opts.previous));
  const res = await fetch("/api/marketing/suggest-ad-copy", { method: "POST", body: fd });
  const json = (await res.json().catch(() => ({}))) as {
    suggestion?: CopySuggestion;
    context?: SuggestContextInfo;
    error?: string;
  };
  if (!res.ok || !json.suggestion) throw new Error(json.error || `Suggestion failed (${res.status})`);
  return {
    suggestion: json.suggestion,
    context: json.context ?? { store: null, brand_profile: false, winners: 0 },
  };
}

// Four images at a time, whatever the upload concurrency is doing.
const MAX_PARALLEL = 4;
let running = 0;
const waiting: Array<() => void> = [];

export function limitSuggest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          waiting.shift()?.();
        });
    };
    if (running < MAX_PARALLEL) start();
    else waiting.push(start);
  });
}

/**
 * The row patch for a suggestion: fills fields that are empty, and with
 * `replace` also fields that still hold an earlier suggestion. A field the
 * marketer typed or edited is never touched.
 */
export function applySuggestion(
  row: BulkAdRow,
  suggestion: CopySuggestion,
  replace: boolean
): Partial<BulkAdRow> {
  const suggested = { ...row.suggested };
  const patch: Partial<BulkAdRow> = {
    suggestion,
    suggest_status: "done",
    suggest_error: null,
  };
  for (const field of COPY_FIELDS) {
    const state = suggestedState(row, field);
    if (!row[field].trim() || (replace && state === "suggested")) {
      patch[field] = suggestion[field];
      suggested[field] = suggestion[field];
    }
  }
  patch.suggested = suggested;
  return patch;
}

/** Accept the suggestion as the marketer's own copy: the tags go away. */
export function keepSuggestions(): Partial<BulkAdRow> {
  return { suggested: { primary_text: null, headline: null, description: null } };
}

/** The border of a copy field: purple while it holds a suggestion, blue once edited. */
export function copyBorderClass(row: BulkAdRow, field: CopyField): string {
  const state = suggestedState(row, field);
  if (state === "suggested") return "border-violet-500 focus:border-violet-400";
  if (state === "edited") return "border-blue-500 focus:border-blue-400";
  if (row.suggest_status === "writing" && !row[field].trim()) return "border-gray-600 animate-pulse";
  return !row[field].trim()
    ? "border-red-500/50 focus:border-red-500"
    : "border-gray-600 focus:border-blue-500";
}

// ── The bar ─────────────────────────────────────────────────────────────────

interface SuggestBarProps extends SuggestProps {
  counts: { writing: number; done: number; error: number; suggestible: number };
  lastContext: SuggestContextInfo | null;
  onSuggestAll: () => void;
}

export function SuggestBar({ settings, onChange, storeId, counts, lastContext, onSuggestAll }: SuggestBarProps) {
  const status =
    counts.writing > 0
      ? `${counts.done} of ${counts.done + counts.writing} images done · ${counts.writing} writing`
      : counts.error > 0
        ? `${counts.done} done · ${counts.error} could not be suggested`
        : counts.done > 0
          ? `${counts.done} ${counts.done === 1 ? "image" : "images"} done`
          : null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 ${
        settings.enabled ? "border-violet-400/40 bg-violet-500/5" : "border-gray-700 bg-gray-800/40"
      }`}
      data-guide="bulk-create.suggest"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Sparkles size={16} className={settings.enabled ? "text-violet-300" : "text-gray-500"} />
          <span className={`text-sm font-medium ${settings.enabled ? "text-violet-100" : "text-gray-400"}`}>
            Suggest copy from each image
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
            className={`relative h-5 w-9 rounded-full transition-colors ${settings.enabled ? "bg-violet-600" : "bg-gray-600"}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                settings.enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-xs text-gray-400">{settings.enabled ? "On" : "Off"}</span>
        </label>

        <span className="hidden h-5 w-px bg-gray-700 sm:block" />

        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          Language
          <select
            value={settings.language}
            onChange={(e) => onChange({ ...settings, language: e.target.value as SuggestCopyLanguage })}
            className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200 focus:border-violet-500 focus:outline-none"
          >
            {(Object.keys(LANGUAGE_LABELS) as SuggestCopyLanguage[]).map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={settings.use_winners}
            onChange={(e) => onChange({ ...settings, use_winners: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 accent-violet-500"
          />
          Tone from winners, last 14d
        </label>

        <span className="text-xs text-gray-500">
          {!storeId
            ? "Pick a store so it knows the product"
            : lastContext
              ? lastContext.brand_profile
                ? `Product facts: Brand Kit · ${lastContext.store ?? "store"} ✓`
                : `No Brand Kit profile for ${lastContext.store ?? "this store"}: using default copy only`
              : "Product facts from the store's Brand Kit profile"}
          {lastContext && settings.use_winners && lastContext.winners > 0 && ` · ${lastContext.winners} winner ads read`}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {status && (
          <span className="flex items-center gap-1.5 text-xs text-violet-200">
            {counts.writing > 0 && <Loader2 size={12} className="animate-spin" />}
            {status}
          </span>
        )}
        <button
          type="button"
          onClick={onSuggestAll}
          disabled={counts.suggestible === 0}
          title={
            counts.suggestible === 0
              ? "Every uploaded image already has copy in all three fields"
              : `Write copy for ${counts.suggestible} ${counts.suggestible === 1 ? "image" : "images"} that still have an empty field`
          }
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suggest for all empty rows
        </button>
      </div>
    </div>
  );
}

// ── Tags under a copy field ─────────────────────────────────────────────────

interface FieldTagsProps {
  row: BulkAdRow;
  field: CopyField;
  onUndo: () => void;
  // Primary text only: the quick actions live under the widest field.
  onRegenerate?: () => void;
  onMoreEnglish?: () => void;
  onOpen?: () => void;
}

export function SuggestFieldTags({ row, field, onUndo, onRegenerate, onMoreEnglish, onOpen }: FieldTagsProps) {
  const state = suggestedState(row, field);
  if (!state) return null;
  const busy = row.suggest_status === "writing";
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      {state === "suggested" ? (
        <button
          type="button"
          onClick={onOpen}
          title={onOpen ? "See what Claude saw and the alternatives" : undefined}
          className={`flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-violet-200 ${
            onOpen ? "hover:bg-violet-500/25" : "cursor-default"
          }`}
        >
          <Sparkles size={10} />
          Suggested
        </button>
      ) : (
        <>
          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-gray-200">Edited by you</span>
          <button
            type="button"
            onClick={onUndo}
            className="flex items-center gap-1 rounded-full border border-gray-600 px-2 py-0.5 text-gray-300 hover:bg-gray-700"
            title="Back to the suggested text"
          >
            <RotateCcw size={10} />
            Undo
          </button>
        </>
      )}
      {state === "suggested" && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          className="rounded-full border border-gray-600 px-2 py-0.5 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          title="Write a different take for this image"
        >
          ↻ Regenerate
        </button>
      )}
      {state === "suggested" && onMoreEnglish && (
        <button
          type="button"
          onClick={onMoreEnglish}
          disabled={busy}
          className="rounded-full border border-gray-600 px-2 py-0.5 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          More English
        </button>
      )}
    </div>
  );
}

// ── Popover: one row up close ───────────────────────────────────────────────

interface PopoverProps {
  row: BulkAdRow;
  onClose: () => void;
  onPick: (field: CopyField, value: string) => void;
  onRegenerate: (instruction?: string) => void;
  onKeepAll: () => void;
}

export function SuggestionPopover({ row, onClose, onPick, onRegenerate, onKeepAll }: PopoverProps) {
  const s = row.suggestion;
  const busy = row.suggest_status === "writing";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!s) return null;
  const readRows: Array<[string, string]> = [
    ["Person", s.read.person || "—"],
    ["Setting", s.read.setting || "—"],
    ["Text on image", s.read.text_on_image ? `“${s.read.text_on_image}”` : "None"],
    ["Product", s.read.product_visible ? "Visible" : "Not visible"],
    ["Promo", s.read.promo || "None"],
  ];
  const anySuggested = COPY_FIELDS.some((f) => suggestedState(row, f) === "suggested");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Suggested copy for this image"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-300" />
            <span className="font-medium text-white">Suggested copy · {row.file_name ?? "this image"}</span>
            {busy && <Loader2 size={14} className="animate-spin text-violet-300" />}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[300px_1fr]">
          {/* What Claude saw */}
          <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/60 p-3">
            {row.preview_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.preview_url} alt="" className="h-44 w-full rounded object-contain bg-gray-900" />
            )}
            <p className="text-[11px] uppercase tracking-wide text-gray-400">What Claude saw</p>
            <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-1.5 text-xs">
              {readRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className="text-gray-200">{v}</dd>
                </div>
              ))}
              <dt className="text-gray-400">Angle</dt>
              <dd className="text-violet-200">{s.read.angle || "—"}</dd>
            </dl>
            <p className="border-t border-gray-700 pt-2 text-[11px] leading-relaxed text-gray-400">
              Wrong read? Regenerate with a note below.
            </p>
          </div>

          {/* The three fields */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
              <button type="button" disabled={busy} onClick={() => onRegenerate()} className="rounded border border-gray-600 px-2.5 py-1 text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                ↻ Regenerate all
              </button>
              <button type="button" disabled={busy} onClick={() => onRegenerate("Use more English and less Filipino than before.")} className="rounded border border-gray-600 px-2.5 py-1 text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                More English
              </button>
              <button type="button" disabled={busy} onClick={() => onRegenerate("Make everything shorter: two sentences of primary text at most.")} className="rounded border border-gray-600 px-2.5 py-1 text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                Shorter
              </button>
              <button type="button" disabled={busy} onClick={() => onRegenerate("Lead with the promo or offer shown on the image.")} className="rounded border border-gray-600 px-2.5 py-1 text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                Lead with promo
              </button>
              <button
                type="button"
                disabled={!anySuggested}
                onClick={onKeepAll}
                className="rounded bg-violet-600 px-3 py-1 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                title="Accept the suggested fields as your own copy"
              >
                Keep all
              </button>
            </div>

            {(
              [
                ["primary_text", "Primary text", 300],
                ["headline", "Headline", 40],
                ["description", "Description", 30],
              ] as Array<[CopyField, string, number]>
            ).map(([field, label, max]) => {
              const state = suggestedState(row, field);
              const value = row[field];
              return (
                <div key={field} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      {label}
                      {state === "edited" && <span className="ml-2 rounded-full bg-gray-700 px-2 py-0.5 text-[11px] text-gray-200">Edited by you</span>}
                    </span>
                    <span className={value.length > max ? "text-yellow-400" : "text-gray-500"}>
                      {value.length} / {max}
                    </span>
                  </div>
                  <div
                    className={`whitespace-pre-wrap rounded border bg-gray-950 px-3 py-2 text-sm text-gray-100 ${
                      state === "suggested" ? "border-violet-500" : state === "edited" ? "border-blue-500" : "border-gray-700"
                    }`}
                  >
                    {value || <span className="text-gray-500">Empty</span>}
                  </div>
                  {field === "headline" && s.headline_alternatives.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-gray-400">Or pick:</span>
                      {[s.headline, ...s.headline_alternatives]
                        .filter((h, i, arr) => h && arr.indexOf(h) === i && h !== value)
                        .map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => onPick("headline", h)}
                            className="rounded-full border border-gray-600 bg-gray-900 px-2.5 py-0.5 text-gray-200 hover:border-violet-400 hover:text-white"
                          >
                            {h}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="border-t border-gray-700 pt-2 text-[11px] leading-relaxed text-gray-400">
              Edit any field in the table itself. Picking an alternative headline costs nothing; Regenerate asks Claude again.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
