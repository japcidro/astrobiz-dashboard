"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Video,
  Image as ImageIcon,
  Play,
  CheckCircle,
  Calendar,
  Search,
  Clapperboard,
  MessageSquare,
  Star,
} from "lucide-react";
import { cachedFetch } from "@/lib/client-cache";
import type { SubmittedAd } from "@/lib/marketing/submitted-videos";
import { VideoReviewModal } from "./video-review-modal";

type TypeFilter = "all" | "video" | "image";
type ReviewedFilter = "all" | "unreviewed" | "reviewed";
type DateRangePreset =
  | "all"
  | "today"
  | "yesterday"
  | "last_3d"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "custom";

const LIST_URL = "/api/marketing/submitted-videos";

// How many days of FB history to pull for a given filter. The fetch window
// must cover the filter's range; the client then refines to exact bounds.
function fetchDaysFor(
  preset: DateRangePreset,
  customFrom: string
): number {
  switch (preset) {
    case "today":
      return 1;
    case "yesterday":
      return 2;
    case "last_3d":
      return 3;
    case "last_7d":
      return 7;
    case "last_30d":
      return 30;
    case "this_month":
      return new Date().getDate() + 1;
    case "custom": {
      if (!customFrom) return 90;
      const from = new Date(`${customFrom}T00:00:00`).getTime();
      const days = Math.ceil((Date.now() - from) / 86400000) + 1;
      return Math.min(120, Math.max(1, days));
    }
    case "all":
    default:
      return 90;
  }
}

// Resolves a [start, end] timestamp window (ms) for the date filter. Defined
// at module scope so the Date.now() call isn't treated as impure during render.
function getDateBounds(
  preset: DateRangePreset,
  customFrom: string,
  customTo: string
): { start: number | null; end: number | null } {
  if (preset === "all") return { start: null, end: null };
  if (preset === "custom") {
    const start = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null;
    const end = customTo ? new Date(`${customTo}T23:59:59.999`).getTime() : null;
    return { start, end };
  }
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  switch (preset) {
    case "today":
      return { start: startOfToday.getTime(), end: endOfToday.getTime() };
    case "yesterday": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 1);
      const e = new Date(endOfToday);
      e.setDate(e.getDate() - 1);
      return { start: s.getTime(), end: e.getTime() };
    }
    case "last_3d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 2);
      return { start: s.getTime(), end: endOfToday.getTime() };
    }
    case "last_7d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 6);
      return { start: s.getTime(), end: endOfToday.getTime() };
    }
    case "last_30d": {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 29);
      return { start: s.getTime(), end: endOfToday.getTime() };
    }
    case "this_month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start: s.getTime(), end: endOfToday.getTime() };
    }
    default:
      return { start: null, end: null };
  }
}

function timeAgo(s: string | null): string {
  if (!s) return "";
  const seconds = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SubmittedVideosView({ role }: { role: "admin" | "marketing" }) {
  const isAdmin = role === "admin";
  const [ads, setAds] = useState<SubmittedAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SubmittedAd | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [reviewedFilter, setReviewedFilter] = useState<ReviewedFilter>("all");
  const [marketerFilter, setMarketerFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DateRangePreset>("last_7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);

  const fetchDays = useMemo(
    () => fetchDaysFor(datePreset, customFrom),
    [datePreset, customFrom]
  );

  const load = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const { data } = await cachedFetch<{ data: SubmittedAd[]; error?: string }>(
          `${LIST_URL}?days=${fetchDays}`,
          { ttl: 5 * 60 * 1000, forceRefresh }
        );
        if (data.error) setError(data.error);
        setAds(data.data || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load ads");
        setAds([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchDays]
  );

  useEffect(() => {
    load();
  }, [load]);

  const marketers = useMemo(() => {
    const set = new Set<string>();
    ads.forEach((a) => set.add(a.marketer_name));
    return Array.from(set).sort();
  }, [ads]);

  const stores = useMemo(() => {
    const set = new Set<string>();
    ads.forEach((a) => a.store_name && set.add(a.store_name));
    return Array.from(set).sort();
  }, [ads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const { start, end } = getDateBounds(datePreset, customFrom, customTo);
    return ads.filter((a) => {
      if (typeFilter !== "all" && a.creative_type !== typeFilter) return false;
      if (isAdmin && marketerFilter !== "all" && a.marketer_name !== marketerFilter)
        return false;
      if (isAdmin && storeFilter !== "all" && a.store_name !== storeFilter)
        return false;
      if (reviewedFilter === "unreviewed" && a.reviewed_at) return false;
      if (reviewedFilter === "reviewed" && !a.reviewed_at) return false;
      if (starredOnly && !a.is_starred) return false;
      if (start != null || end != null) {
        const t = a.created_time ? new Date(a.created_time).getTime() : 0;
        if (start != null && t < start) return false;
        if (end != null && t > end) return false;
      }
      if (q) {
        const hay = `${a.ad_name} ${a.marketer_name} ${a.campaign_name ?? ""} ${
          a.store_name ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    ads,
    search,
    typeFilter,
    reviewedFilter,
    marketerFilter,
    storeFilter,
    datePreset,
    customFrom,
    customTo,
    starredOnly,
    isAdmin,
  ]);

  const unreviewedCount = useMemo(
    () => filtered.filter((a) => !a.reviewed_at).length,
    [filtered]
  );

  const onReviewedChange = useCallback(
    (id: string, reviewedAt: string | null, reviewedByName: string | null) => {
      setAds((prev) =>
        prev.map((a) =>
          a.fb_ad_id === id
            ? { ...a, reviewed_at: reviewedAt, reviewed_by_name: reviewedByName }
            : a
        )
      );
    },
    []
  );

  const onNoteChange = useCallback(
    (id: string, note: string | null, noteByName: string | null) => {
      setAds((prev) =>
        prev.map((a) =>
          a.fb_ad_id === id ? { ...a, note, note_by_name: noteByName } : a
        )
      );
    },
    []
  );

  const toggleStar = useCallback(async (id: string, next: boolean) => {
    // Optimistic — revert on failure.
    setAds((prev) =>
      prev.map((a) => (a.fb_ad_id === id ? { ...a, is_starred: next } : a))
    );
    try {
      const res = await fetch("/api/marketing/submitted-videos/star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fb_ad_id: id, starred: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAds((prev) =>
        prev.map((a) => (a.fb_ad_id === id ? { ...a, is_starred: !next } : a))
      );
    }
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Submitted Ad Videos</h1>
          <p className="text-gray-400 mt-1 text-sm">
            {isAdmin
              ? "Every ad submitted to Facebook — watchable here even while scheduled (before they appear in Ad Performance)."
              : "Your submitted ads — watchable here even while scheduled."}
            {isAdmin && filtered.length > 0 && unreviewedCount > 0 && (
              <span className="ml-2 text-amber-400">
                {unreviewedCount} not yet reviewed
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ad, marketer, store…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
          />
        </div>

        <Select
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
          options={[
            ["all", "All types"],
            ["video", "Videos"],
            ["image", "Images"],
          ]}
        />

        <button
          onClick={() => setStarredOnly((v) => !v)}
          title="Show starred ads only"
          className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
            starredOnly
              ? "bg-amber-400/15 border-amber-400/60 text-amber-300"
              : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
          }`}
        >
          <Star
            size={15}
            fill={starredOnly ? "currentColor" : "none"}
          />
          Starred
        </button>

        <Select
          value={datePreset}
          onChange={(v) => setDatePreset(v as DateRangePreset)}
          options={[
            ["all", "All dates"],
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["last_3d", "Last 3 days"],
            ["last_7d", "Last 7 days"],
            ["last_30d", "Last 30 days"],
            ["this_month", "This month"],
            ["custom", "Custom range"],
          ]}
        />

        {datePreset === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:border-gray-500 cursor-pointer"
            />
            <span className="text-gray-500 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:border-gray-500 cursor-pointer"
            />
          </div>
        )}

        {isAdmin && (
          <>
            <Select
              value={reviewedFilter}
              onChange={(v) => setReviewedFilter(v as ReviewedFilter)}
              options={[
                ["all", "All"],
                ["unreviewed", "Not reviewed"],
                ["reviewed", "Reviewed"],
              ]}
            />
            {marketers.length > 1 && (
              <Select
                value={marketerFilter}
                onChange={setMarketerFilter}
                options={[
                  ["all", "All marketers"],
                  ...marketers.map((m) => [m, m] as [string, string]),
                ]}
              />
            )}
            {stores.length > 0 && (
              <Select
                value={storeFilter}
                onChange={setStoreFilter}
                options={[
                  ["all", "All stores"],
                  ...stores.map((s) => [s, s] as [string, string]),
                ]}
              />
            )}
          </>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-24">
          <Clapperboard size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24">
          <Clapperboard size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-500">No submitted ads in this range</p>
          <p className="text-gray-600 text-sm mt-1">
            Try a wider date range or different filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((ad) => (
            <AdCard
              key={ad.fb_ad_id}
              ad={ad}
              onOpen={() => setActive(ad)}
              onToggleStar={toggleStar}
            />
          ))}
        </div>
      )}

      {active && (
        <VideoReviewModal
          ad={active}
          role={role}
          onClose={() => setActive(null)}
          onReviewedChange={onReviewedChange}
          onNoteChange={onNoteChange}
          onStarChange={toggleStar}
        />
      )}
    </div>
  );
}

function AdCard({
  ad,
  onOpen,
  onToggleStar,
}: {
  ad: SubmittedAd;
  onOpen: () => void;
  onToggleStar: (id: string, next: boolean) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumb = ad.thumbnail_url || ad.image_url;

  return (
    <button
      onClick={onOpen}
      className={`group text-left rounded-xl overflow-hidden transition-colors cursor-pointer ${
        ad.reviewed_at
          ? "bg-green-500/10 border-2 border-green-500/70 ring-1 ring-green-500/40"
          : "bg-gray-800/50 border border-gray-700/50 hover:border-gray-500"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
        {thumb && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="text-gray-700">
            {ad.creative_type === "video" ? (
              <Video size={28} />
            ) : (
              <ImageIcon size={28} />
            )}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
          <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center">
            <Play size={18} className="text-gray-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
        <span className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          {ad.creative_type === "video" ? (
            <Video size={11} />
          ) : (
            <ImageIcon size={11} />
          )}
          {ad.creative_type === "video" ? "Video" : "Image"}
        </span>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {ad.note && (
            <span
              className="text-sky-300 bg-black/60 rounded-full p-1"
              title="Has a note"
            >
              <MessageSquare size={13} />
            </span>
          )}
          {ad.reviewed_at && (
            <span className="text-green-400 bg-black/60 rounded-full p-0.5">
              <CheckCircle size={15} />
            </span>
          )}
        </div>
        {ad.is_scheduled && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 bg-amber-500/90 text-black text-[10px] font-medium px-1.5 py-0.5 rounded">
            <Calendar size={10} />
            Scheduled
          </span>
        )}
        {/* Star toggle — stops propagation so it doesn't open the modal */}
        <span
          role="button"
          tabIndex={0}
          title={ad.is_starred ? "Starred — click to unstar" : "Star this ad"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(ad.fb_ad_id, !ad.is_starred);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onToggleStar(ad.fb_ad_id, !ad.is_starred);
            }
          }}
          className={`absolute bottom-2 right-2 rounded-full p-1.5 cursor-pointer transition-colors ${
            ad.is_starred
              ? "bg-black/50 text-amber-400"
              : "bg-black/50 text-gray-300 hover:text-amber-300 opacity-80 hover:opacity-100"
          }`}
        >
          <Star size={16} fill={ad.is_starred ? "currentColor" : "none"} />
        </span>
      </div>

      {/* Meta */}
      <div className="p-3">
        <p className="text-white text-sm font-medium truncate">{ad.ad_name}</p>
        <p className="text-gray-400 text-xs truncate mt-0.5">
          {ad.marketer_name}
          {ad.store_name ? ` · ${ad.store_name}` : ""}
        </p>
        <p className="text-gray-600 text-[11px] mt-1">{timeAgo(ad.created_time)}</p>
      </div>
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500 cursor-pointer"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
