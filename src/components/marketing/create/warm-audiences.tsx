"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Warm (retargeting) audiences for an ad set: tick the custom audiences to
// include and exclude, or make a new one of the four standard kinds. The
// list and the create call go through /api/facebook/audiences.

interface Audience {
  id: string;
  name: string;
  subtype: string | null;
  approximate_count_lower_bound: number | null;
  approximate_count_upper_bound: number | null;
}

type AudienceRef = { id: string; name?: string };

interface WarmAudiencesProps {
  adAccountId: string;
  pixelId: string;
  pageId?: string;
  included: AudienceRef[];
  excluded: AudienceRef[];
  onChange: (included: AudienceRef[], excluded: AudienceRef[]) => void;
}

type Kind = "website_visitors" | "website_event" | "page_engaged" | "video_viewers";

const KINDS: { value: Kind; label: string; maxDays: number }[] = [
  { value: "website_visitors", label: "Website visitors (pixel)", maxDays: 180 },
  { value: "website_event", label: "Pixel event, e.g. Purchase", maxDays: 180 },
  { value: "page_engaged", label: "Page engagers", maxDays: 730 },
  { value: "video_viewers", label: "Video viewers (50%), by video IDs", maxDays: 365 },
];

function countLabel(a: Audience): string {
  const lo = a.approximate_count_lower_bound;
  const hi = a.approximate_count_upper_bound;
  if (lo == null && hi == null) return "";
  if (lo != null && hi != null && lo !== hi) return `${lo.toLocaleString()}–${hi.toLocaleString()}`;
  return (lo ?? hi ?? 0).toLocaleString();
}

export function WarmAudiences({
  adAccountId,
  pixelId,
  pageId,
  included,
  excluded,
  onChange,
}: WarmAudiencesProps) {
  const [list, setList] = useState<Audience[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    kind: "website_visitors" as Kind,
    days: 14,
    event: "Purchase",
    page_id: pageId || "",
    video_ids: "",
  });

  const load = useCallback(async () => {
    if (!adAccountId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/facebook/audiences?account_id=${adAccountId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setList(json.data as Audience[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load audiences");
    } finally {
      setLoading(false);
    }
  }, [adAccountId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (pageId) setForm((f) => (f.page_id ? f : { ...f, page_id: pageId }));
  }, [pageId]);

  const isIn = (refs: AudienceRef[], id: string) => refs.some((r) => r.id === id);

  const toggle = (a: Audience, side: "include" | "exclude") => {
    const ref = { id: a.id, name: a.name };
    let inc = included.filter((r) => r.id !== a.id);
    let exc = excluded.filter((r) => r.id !== a.id);
    if (side === "include" && !isIn(included, a.id)) inc = [...inc, ref];
    if (side === "exclude" && !isIn(excluded, a.id)) exc = [...exc, ref];
    onChange(inc, exc);
  };

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/facebook/audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_account_id: adAccountId,
          name: form.name,
          kind: form.kind,
          days: form.days,
          pixel_id: pixelId,
          event: form.event,
          page_id: form.page_id,
          video_ids: form.video_ids
            .split(/[\s,]+/)
            .map((v) => v.trim())
            .filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      await load();
      // A purchasers audience is almost always an exclusion; everything else
      // an inclusion. Either can be flipped in the list.
      const ref = { id: json.id as string, name: json.name as string };
      const purchasers = form.kind === "website_event" && /purchase/i.test(form.event);
      if (purchasers) onChange(included, [...excluded, ref]);
      else onChange([...included, ref], excluded);
      setForm((f) => ({ ...f, name: "", video_ids: "" }));
      setShowNew(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create the audience");
    } finally {
      setCreating(false);
    }
  };

  const kindMeta = KINDS.find((k) => k.value === form.kind) || KINDS[0];
  const q = filter.trim().toLowerCase();
  const visible = (q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list).slice(0, 40);
  const picked = included.length + excluded.length;

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5">
        Warm audiences{" "}
        <span className="text-gray-600">(retargeting, optional)</span>
      </label>
      <p className="text-xs text-gray-500 mb-2">
        Tick audiences to include or exclude. With any ticked, Advantage+
        audience is turned off so the ad set stays inside them.
        {picked > 0 && (
          <span className="text-gray-300">
            {" "}
            {included.length} included, {excluded.length} excluded.
          </span>
        )}
      </p>

      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-700 text-gray-300 hover:border-gray-500 cursor-pointer"
        >
          {showNew ? "Close" : "+ New audience"}
        </button>
      </div>

      {showNew && (
        <div className="mb-3 p-3 rounded-lg border border-gray-700 bg-gray-900/60 space-y-2">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Audience name, e.g. YUMO · site visitors 14d"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input
                type="number"
                min={1}
                max={kindMeta.maxDays}
                value={form.days}
                onChange={(e) => setForm({ ...form, days: parseInt(e.target.value) || 1 })}
                className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none"
              />
              days
            </label>
          </div>
          {form.kind === "website_event" && (
            <input
              type="text"
              value={form.event}
              onChange={(e) => setForm({ ...form, event: e.target.value })}
              placeholder="Pixel event name, e.g. Purchase"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none"
            />
          )}
          {form.kind === "page_engaged" && (
            <input
              type="text"
              value={form.page_id}
              onChange={(e) => setForm({ ...form, page_id: e.target.value })}
              placeholder="Facebook Page ID"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none"
            />
          )}
          {form.kind === "video_viewers" && (
            <textarea
              rows={2}
              value={form.video_ids}
              onChange={(e) => setForm({ ...form, video_ids: e.target.value })}
              placeholder="Video IDs, comma or newline separated"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none"
            />
          )}
          {(form.kind === "website_visitors" || form.kind === "website_event") && !pixelId && (
            <p className="text-xs text-amber-400">Pick a pixel below first.</p>
          )}
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <button
            type="button"
            disabled={creating || !form.name.trim()}
            onClick={create}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-gray-900 disabled:opacity-50 cursor-pointer"
          >
            {creating ? "Creating…" : "Create audience"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
          <Loader2 size={14} className="animate-spin" />
          Loading audiences...
        </div>
      ) : loadError ? (
        <p className="text-xs text-red-400">{loadError}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-gray-500">No custom audiences in this ad account yet.</p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-700 divide-y divide-gray-800">
          {visible.map((a) => {
            const inc = isIn(included, a.id);
            const exc = isIn(excluded, a.id);
            return (
              <div key={a.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <div className="flex-1 min-w-0">
                  <div className={`truncate ${inc || exc ? "text-white" : "text-gray-300"}`}>{a.name}</div>
                  <div className="text-xs text-gray-600">
                    {a.subtype || ""}
                    {countLabel(a) ? ` · ~${countLabel(a)}` : ""}
                  </div>
                </div>
                <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={inc} onChange={() => toggle(a, "include")} />
                  Include
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={exc} onChange={() => toggle(a, "exclude")} />
                  Exclude
                </label>
              </div>
            );
          })}
          {list.length > visible.length && (
            <div className="px-3 py-1.5 text-xs text-gray-600">
              Showing {visible.length} of {list.length}. Filter by name to find the rest.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
