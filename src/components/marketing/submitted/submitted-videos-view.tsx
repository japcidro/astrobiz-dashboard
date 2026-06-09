"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  Video,
  Image as ImageIcon,
  Play,
  CheckCircle,
  Calendar,
  Search,
  Clapperboard,
} from "lucide-react";
import { cachedFetch } from "@/lib/client-cache";
import type { SubmittedAd } from "@/lib/marketing/submitted-videos";
import { VideoReviewModal } from "./video-review-modal";

type TypeFilter = "all" | "video" | "image";
type ReviewedFilter = "all" | "unreviewed" | "reviewed";

const LIST_URL = "/api/marketing/submitted-videos";

function isScheduled(startTime: string | null): boolean {
  return startTime != null && new Date(startTime).getTime() > Date.now();
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
  const [active, setActive] = useState<SubmittedAd | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [reviewedFilter, setReviewedFilter] = useState<ReviewedFilter>("all");
  const [marketerFilter, setMarketerFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const { data } = await cachedFetch<{ data: SubmittedAd[] }>(LIST_URL, {
        ttl: 3 * 60 * 1000,
        forceRefresh,
      });
      setAds(data.data || []);
    } catch {
      setAds([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const marketers = useMemo(() => {
    const map = new Map<string, string>();
    ads.forEach((a) => map.set(a.marketer_id, a.marketer_name));
    return Array.from(map.entries());
  }, [ads]);

  const stores = useMemo(() => {
    const set = new Set<string>();
    ads.forEach((a) => a.store_name && set.add(a.store_name));
    return Array.from(set);
  }, [ads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads.filter((a) => {
      if (typeFilter !== "all" && a.creative_type !== typeFilter) return false;
      if (isAdmin && marketerFilter !== "all" && a.marketer_id !== marketerFilter)
        return false;
      if (isAdmin && storeFilter !== "all" && a.store_name !== storeFilter)
        return false;
      if (reviewedFilter === "unreviewed" && a.reviewed_at) return false;
      if (reviewedFilter === "reviewed" && !a.reviewed_at) return false;
      if (q) {
        const hay = `${a.ad_name} ${a.marketer_name} ${a.headline ?? ""} ${
          a.file_name ?? ""
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
    isAdmin,
  ]);

  const unreviewedCount = useMemo(
    () => ads.filter((a) => !a.reviewed_at).length,
    [ads]
  );

  const onReviewedChange = useCallback(
    (id: string, reviewedAt: string | null, reviewedByName: string | null) => {
      setAds((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, reviewed_at: reviewedAt, reviewed_by_name: reviewedByName }
            : a
        )
      );
    },
    []
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Submitted Ad Videos</h1>
          <p className="text-gray-400 mt-1 text-sm">
            {isAdmin
              ? "Review every ad your marketers submit — watchable here even while scheduled (before they appear in Ad Performance)."
              : "Your submitted ads. Watchable here even while scheduled."}
            {isAdmin && unreviewedCount > 0 && (
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
            placeholder="Search ad, marketer, file…"
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
                  ...marketers.map(([id, name]) => [id, name] as [string, string]),
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
      ) : filtered.length === 0 ? (
        <div className="text-center py-24">
          <Clapperboard size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-500">No submitted ads to show</p>
          <p className="text-gray-600 text-sm mt-1">
            {ads.length === 0
              ? "Ads submitted by marketers will appear here."
              : "Try adjusting the filters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((ad) => (
            <AdCard key={ad.id} ad={ad} onOpen={() => setActive(ad)} />
          ))}
        </div>
      )}

      {active && (
        <VideoReviewModal
          ad={active}
          role={role}
          onClose={() => setActive(null)}
          onReviewedChange={onReviewedChange}
        />
      )}
    </div>
  );
}

function AdCard({ ad, onOpen }: { ad: SubmittedAd; onOpen: () => void }) {
  const scheduled = isScheduled(ad.start_time);

  return (
    <button
      onClick={onOpen}
      className="group text-left bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-gray-500 transition-colors cursor-pointer"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
        <Thumbnail ad={ad} />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
          <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center">
            <Play size={18} className="text-gray-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
        {/* Type badge */}
        <span className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
          {ad.creative_type === "video" ? (
            <Video size={11} />
          ) : (
            <ImageIcon size={11} />
          )}
          {ad.creative_type === "video" ? "Video" : "Image"}
        </span>
        {/* Reviewed badge */}
        {ad.reviewed_at && (
          <span className="absolute top-2 right-2 text-green-400 bg-black/60 rounded-full p-0.5">
            <CheckCircle size={15} />
          </span>
        )}
        {/* Schedule badge */}
        {scheduled && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 bg-amber-500/90 text-black text-[10px] font-medium px-1.5 py-0.5 rounded">
            <Calendar size={10} />
            Scheduled
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="p-3">
        <p className="text-white text-sm font-medium truncate">{ad.ad_name}</p>
        <p className="text-gray-400 text-xs truncate mt-0.5">
          {ad.marketer_name}
          {ad.store_name ? ` · ${ad.store_name}` : ""}
        </p>
        <p className="text-gray-600 text-[11px] mt-1">{timeAgo(ad.submitted_at)}</p>
      </div>
    </button>
  );
}

// Lazily fetches the FB thumbnail only once the card scrolls into view, so the
// list itself makes zero Facebook calls until needed.
function Thumbnail({ ad }: { ad: SubmittedAd }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !done) {
          done = true;
          io.disconnect();
          fetch(`/api/marketing/submitted-videos/source?id=${ad.id}`)
            .then((r) => r.json())
            .then((j) => {
              if (j?.data?.thumbnail) setUrl(j.data.thumbnail as string);
              else setFailed(true);
            })
            .catch(() => setFailed(true));
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ad.id]);

  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          onError={() => {
            setUrl(null);
            setFailed(true);
          }}
        />
      ) : (
        <div className="text-gray-700">
          {failed || ad.creative_type === "image" ? (
            <ImageIcon size={28} />
          ) : (
            <Video size={28} />
          )}
        </div>
      )}
    </div>
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
