"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Image as ImageIcon, RefreshCw, Search, Video, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Note } from "@/components/ui/note";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WINDOW_DAYS,
  REVIEW_STATE_LABEL,
  VERDICT_LABEL,
  WINDOW_OPTIONS,
  adsManagerUrl,
  verdictOf,
  type LaunchedAd,
  type LaunchedCreativesResponse,
  type ReviewState,
  type Verdict,
  type WindowTotals,
} from "@/lib/marketing/launched-creatives";

const LIST_URL = "/api/marketing/launched-creatives";
const CPP_BAR_KEY = "launched-creatives.cpp-bar";
const DEFAULT_CPP_BAR = 400;

type CampaignFilter = "all" | "testing" | "scaling";
type StatusFilter =
  | "all"
  | "rejected_ever"
  | "rejected_now"
  | "swapped"
  | "in_review"
  | "active"
  | "paused"
  | "scheduled";
type SortKey = "launch" | "d3" | "d7" | "lifetime" | "cpp" | "spend";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-PH");

function shortDate(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function shortStamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATE_TONE: Record<ReviewState, PillTone> = {
  scheduled: "info",
  active: "good",
  in_review: "info",
  rejected: "bad",
  issues: "warn",
  paused: "neutral",
  off: "neutral",
  unknown: "neutral",
};

const VERDICT_TONE: Record<Verdict, PillTone> = {
  winner: "good",
  promising: "info",
  mixed: "neutral",
  losing: "bad",
  too_early: "neutral",
  no_delivery: "neutral",
};

function wasRejected(ad: LaunchedAd): boolean {
  return Boolean(ad.rejection) || Boolean(ad.fix);
}

function matchesStatus(ad: LaunchedAd, f: StatusFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "rejected_ever":
      return wasRejected(ad);
    case "rejected_now":
      return ad.review_state === "rejected" || ad.review_state === "issues";
    case "swapped":
      return Boolean(ad.fix);
    case "in_review":
      return ad.review_state === "in_review";
    case "active":
      return ad.review_state === "active";
    case "paused":
      return ad.review_state === "paused" || ad.review_state === "off";
    case "scheduled":
      return ad.review_state === "scheduled";
  }
}

function sortValue(ad: LaunchedAd, key: SortKey): number | string {
  switch (key) {
    case "launch":
      return ad.launch_date ?? ad.created_time ?? "";
    case "d3":
      return ad.first_3_days.purchases;
    case "d7":
      return ad.first_7_days.purchases;
    case "lifetime":
      return ad.lifetime.purchases;
    case "cpp":
      // Cheapest first; nothing sold sorts last.
      return ad.lifetime.cpp > 0 ? -ad.lifetime.cpp : -Infinity;
    case "spend":
      return ad.lifetime.spend;
  }
}

/** Safe images are often stored under their upload id; only a real name is worth showing. */
function safeImageLabel(name: string | null): string {
  if (!name || /^hf_\d{6,}/i.test(name) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(name)) {
    return "the safe image";
  }
  return `the safe image “${name}”`;
}

/** Purchases (and CPP, spend) for one window, as a table cell. */
function WindowCell({ w, days }: { w: WindowTotals; days?: number }) {
  const empty = w.spend === 0 && w.purchases === 0;
  return (
    <div className="text-right">
      <div className={cn("font-num text-base", empty ? "text-dim" : "text-fg")}>
        {empty ? "—" : num.format(w.purchases)}
      </div>
      {!empty && (
        <div className="text-xs text-muted whitespace-nowrap">
          {w.purchases > 0 ? peso.format(w.cpp) : "no sale"} · {peso.format(w.spend)}
        </div>
      )}
      {days !== undefined && !empty && !w.complete && w.days_elapsed > 0 && (
        <div className="font-mono text-[11px] text-dim whitespace-nowrap">
          {w.days_elapsed}/{days} days
        </div>
      )}
    </div>
  );
}

/** Daily purchases as bars; spend as dim bars when nothing sold yet. */
function Sparkline({ ad }: { ad: LaunchedAd }) {
  const rows = ad.daily.slice(0, 14);
  if (rows.length === 0) return <span className="text-dim">—</span>;
  const sold = rows.some((r) => r.purchases > 0);
  const values = rows.map((r) => (sold ? r.purchases : r.spend));
  const max = Math.max(...values, 1);
  const w = 4;
  const gap = 2;
  const h = 22;
  return (
    <svg
      width={rows.length * (w + gap)}
      height={h}
      className={sold ? "text-accent" : "text-dim"}
      aria-label={sold ? "Daily purchases" : "Daily spend"}
    >
      {values.map((v, i) => {
        const bh = v > 0 ? Math.max(2, (v / max) * h) : 1;
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={1}
            fill="currentColor"
            opacity={v > 0 ? 1 : 0.35}
          />
        );
      })}
    </svg>
  );
}

function Thumb({ ad, size = 44 }: { ad: LaunchedAd; size?: number }) {
  const src = ad.thumbnail_url ?? ad.image_url;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-control border border-line bg-raised"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-dim">
          {ad.creative_type === "video" ? <Video size={16} /> : <ImageIcon size={16} />}
        </div>
      )}
    </div>
  );
}

function StatusCell({ ad }: { ad: LaunchedAd }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone={STATE_TONE[ad.review_state]}>{REVIEW_STATE_LABEL[ad.review_state]}</Pill>
      {ad.fix && <Tag tone="warn">Swapped</Tag>}
      {!ad.fix && ad.rejection?.cleared_at && <Tag tone="warn">Was rejected</Tag>}
    </div>
  );
}

export function LaunchedCreativesView() {
  const [days, setDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  const [resp, setResp] = useState<LaunchedCreativesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [marketerFilter, setMarketerFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("launch");
  const [cppBar, setCppBar] = useState<number>(DEFAULT_CPP_BAR);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(CPP_BAR_KEY));
      if (saved > 0) setCppBar(saved);
    } catch {
      /* no storage */
    }
  }, []);

  const saveCppBar = (n: number) => {
    setCppBar(n);
    try {
      localStorage.setItem(CPP_BAR_KEY, String(n));
    } catch {
      /* no storage */
    }
  };

  const load = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${LIST_URL}?days=${days}${forceRefresh ? "&refresh=1" : ""}`);
        const json = (await res.json()) as LaunchedCreativesResponse & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error || "Couldn't load launched creatives");
        setResp(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load launched creatives");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [days]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const ads = useMemo(() => resp?.data ?? [], [resp]);

  const stores = useMemo(
    () => Array.from(new Set(ads.map((a) => a.store_name).filter((s): s is string => Boolean(s)))).sort(),
    [ads]
  );
  const marketers = useMemo(
    () => Array.from(new Set(ads.map((a) => a.marketer_name))).sort(),
    [ads]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ads.filter((a) => {
      if (storeFilter !== "all" && a.store_name !== storeFilter) return false;
      if (marketerFilter !== "all" && a.marketer_name !== marketerFilter) return false;
      if (campaignFilter === "testing" && !a.is_nursery) return false;
      if (campaignFilter === "scaling" && a.is_nursery) return false;
      if (!matchesStatus(a, statusFilter)) return false;
      if (q) {
        const hay = `${a.ad_name} ${a.campaign_name ?? ""} ${a.adset_name ?? ""} ${a.store_name ?? ""} ${a.marketer_name} ${a.account_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va === vb) return (b.launch_date ?? "").localeCompare(a.launch_date ?? "");
      return va < vb ? 1 : -1;
    });
    return list;
  }, [ads, search, storeFilter, marketerFilter, campaignFilter, statusFilter, sortKey]);

  const stats = useMemo(() => {
    const rejectedEver = filtered.filter(wasRejected).length;
    const rejectedNow = filtered.filter(
      (a) => a.review_state === "rejected" || a.review_state === "issues"
    ).length;
    const swapped = filtered.filter((a) => a.fix).length;
    const winners = filtered.filter((a) => verdictOf(a.lifetime, cppBar) === "winner").length;
    const spend = filtered.reduce((s, a) => s + a.lifetime.spend, 0);
    const purchases = filtered.reduce((s, a) => s + a.lifetime.purchases, 0);
    return { rejectedEver, rejectedNow, swapped, winners, spend, purchases };
  }, [filtered, cppBar]);

  const selected = useMemo(
    () => (selectedId ? ads.find((a) => a.ad_id === selectedId) ?? null : null),
    [ads, selectedId]
  );

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Launched creatives"
        subtitle={
          <>
            Every ad launched in the last {resp?.window_days ?? days} days, at ad level: when it went live,
            its first 3 and 7 days, and whether Meta rejected it.
            {resp?.refreshed_at && (
              <span className="ml-2 font-mono text-xs text-dim">updated {timeAgo(resp.refreshed_at)}</span>
            )}
          </>
        }
        actions={
          <Button variant="secondary" onClick={() => load(true)} disabled={refreshing || loading}>
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      />

      {error && (
        <Note tone="bad" className="mb-4">
          {error}
        </Note>
      )}
      {!error && resp && resp.warnings.length > 0 && (
        <Note tone="warn" className="mb-4">
          {resp.warnings.join(" · ")}
        </Note>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ad, campaign, store…"
            className="pl-9"
          />
        </div>
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-40">
          {WINDOW_OPTIONS.map((d) => (
            <option key={d} value={d}>
              Launched last {d} days
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-44">
          <option value="all">Any status</option>
          <option value="rejected_now">Rejected or issues now</option>
          <option value="rejected_ever">Ever rejected</option>
          <option value="swapped">Swapped to safe image</option>
          <option value="in_review">In review</option>
          <option value="active">Active</option>
          <option value="paused">Paused or off</option>
          <option value="scheduled">Scheduled</option>
        </Select>
        <Select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value as CampaignFilter)}
          className="w-36"
        >
          <option value="all">All campaigns</option>
          <option value="testing">Testing only</option>
          <option value="scaling">Scaling only</option>
        </Select>
        {stores.length > 0 && (
          <Select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="w-40">
            <option value="all">All stores</option>
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        {marketers.length > 1 && (
          <Select value={marketerFilter} onChange={(e) => setMarketerFilter(e.target.value)} className="w-36">
            <option value="all">All marketers</option>
            {marketers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        )}
        <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="w-44">
          <option value="launch">Newest launch first</option>
          <option value="d3">Most sales, first 3 days</option>
          <option value="d7">Most sales, first 7 days</option>
          <option value="lifetime">Most sales, lifetime</option>
          <option value="cpp">Cheapest purchase</option>
          <option value="spend">Most spend</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted">
          CPP bar
          <Input
            type="number"
            min={50}
            step={10}
            value={cppBar}
            onChange={(e) => saveCppBar(Math.max(50, Number(e.target.value) || DEFAULT_CPP_BAR))}
            className="w-24"
          />
        </label>
      </div>

      {/* Tiles */}
      <div className="mb-5 grid grid-cols-2 gap-sys sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Launched" value={num.format(filtered.length)} loading={loading} />
        <Tile
          label="Ever rejected"
          value={num.format(stats.rejectedEver)}
          delta={stats.rejectedNow > 0 ? `${stats.rejectedNow} still rejected` : "none rejected now"}
          tone={stats.rejectedNow > 0 ? "bad" : "neutral"}
          loading={loading}
        />
        <Tile label="Swapped to safe image" value={num.format(stats.swapped)} loading={loading} />
        <Tile
          label="Winners"
          value={num.format(stats.winners)}
          delta={`5+ sales at ≤ ${peso.format(cppBar)}`}
          tone="good"
          loading={loading}
        />
        <Tile label="Spend" value={peso.format(stats.spend)} loading={loading} />
        <Tile
          label="Purchases"
          value={num.format(stats.purchases)}
          delta={stats.purchases > 0 ? `${peso.format(stats.spend / stats.purchases)} each` : undefined}
          loading={loading}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-control bg-raised" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No launched creatives match">
          Widen the window or clear a filter. Scheduled ads show once their start time passes.
        </EmptyState>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Creative</TableHeader>
              <TableHeader>Launched</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader num>First 3 days</TableHeader>
              <TableHeader num>First 7 days</TableHeader>
              <TableHeader num>Lifetime</TableHeader>
              <TableHeader>Trend</TableHeader>
              <TableHeader>Verdict</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((ad) => {
              const verdict = verdictOf(ad.lifetime, cppBar);
              return (
                <TableRow
                  key={ad.ad_id}
                  interactive
                  selected={ad.ad_id === selectedId}
                  onClick={() => setSelectedId(ad.ad_id)}
                >
                  <TableCell className="max-w-[360px]">
                    <div className="flex items-center gap-3">
                      <Thumb ad={ad} />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-fg">{ad.ad_name}</div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                          {ad.store_name && <Tag>{ad.store_name}</Tag>}
                          <span className="truncate">{ad.campaign_name ?? ad.account_name}</span>
                          <span className="shrink-0 text-dim">· {ad.marketer_name}</span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-num text-sm text-fg">
                      {ad.review_state === "scheduled" ? "Scheduled" : shortDate(ad.first_delivery_date ?? ad.launch_date)}
                    </div>
                    <div className="text-xs text-muted">
                      {ad.review_state === "scheduled"
                        ? shortStamp(ad.start_time)
                        : ad.first_delivery_date
                          ? `Day ${ad.lifetime.days_elapsed} · ${ad.days_delivered} delivered`
                          : "No delivery yet"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusCell ad={ad} />
                  </TableCell>
                  <TableCell num>
                    <WindowCell w={ad.first_3_days} days={3} />
                  </TableCell>
                  <TableCell num>
                    <WindowCell w={ad.first_7_days} days={7} />
                  </TableCell>
                  <TableCell num>
                    <WindowCell w={ad.lifetime} />
                  </TableCell>
                  <TableCell>
                    <Sparkline ad={ad} />
                  </TableCell>
                  <TableCell>
                    <Pill tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Pill>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {selected && (
        <DetailDrawer ad={selected} cppBar={cppBar} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-label text-muted">{label}</div>
      <div className="mt-0.5 min-w-0 text-sm text-fg">{children}</div>
    </div>
  );
}

function WindowRow({ label, w }: { label: string; w: WindowTotals }) {
  return (
    <TableRow>
      <TableCell className="text-muted">{label}</TableCell>
      <TableCell num>{num.format(w.purchases)}</TableCell>
      <TableCell num>{w.purchases > 0 ? peso.format(w.cpp) : "—"}</TableCell>
      <TableCell num>{peso.format(w.spend)}</TableCell>
      <TableCell num>{w.spend > 0 ? `${w.roas.toFixed(2)}×` : "—"}</TableCell>
      <TableCell num>{num.format(w.add_to_cart)}</TableCell>
    </TableRow>
  );
}

function DetailDrawer({ ad, cppBar, onClose }: { ad: LaunchedAd; cppBar: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const verdict = verdictOf(ad.lifetime, cppBar);
  const src = ad.image_url ?? ad.thumbnail_url;
  const rejectedNow = ad.review_state === "rejected" || ad.review_state === "issues";
  const afterFix =
    ad.fix && ad.before_fix
      ? {
          purchases: ad.lifetime.purchases - ad.before_fix.purchases,
          spend: ad.lifetime.spend - ad.before_fix.spend,
        }
      : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-canvas/60" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={ad.ad_name}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col overflow-y-auto border-l border-line bg-panel shadow-float"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm text-fg">{ad.ad_name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {ad.store_name && <Tag>{ad.store_name}</Tag>}
              <span>{ad.marketer_name}</span>
              <span className="text-dim">· {ad.account_name}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>

        <div className="grid gap-5 px-5 py-4">
          <div className="flex gap-4">
            <div className="h-32 w-32 shrink-0 overflow-hidden rounded-control border border-line bg-raised">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-dim">
                  {ad.creative_type === "video" ? <Video size={20} /> : <ImageIcon size={20} />}
                </div>
              )}
            </div>
            <div className="grid min-w-0 flex-1 content-start gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusCell ad={ad} />
                <Pill tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Pill>
              </div>
              <Fact label="Launched">
                {ad.review_state === "scheduled"
                  ? `Scheduled for ${shortStamp(ad.start_time)}`
                  : `${shortDate(ad.first_delivery_date ?? ad.launch_date)}${
                      ad.first_delivery_date ? ` · day ${ad.lifetime.days_elapsed}` : " · no delivery yet"
                    }`}
              </Fact>
              <Fact label="Created on Meta">{shortStamp(ad.created_time)}</Fact>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <a
                  href={adsManagerUrl(ad.account_id, ad.ad_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Ads Manager <ExternalLink size={11} />
                </a>
                {ad.preview_url && (
                  <a
                    href={ad.preview_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    View post <ExternalLink size={11} />
                  </a>
                )}
                {rejectedNow && ad.is_nursery && (
                  <a href="/marketing/fix-rejections" className="text-accent hover:underline">
                    Fix rejections
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Campaign">
              <span className="break-words">{ad.campaign_name ?? "—"}</span>
            </Fact>
            <Fact label="Ad set">
              <span className="break-words">{ad.adset_name ?? "—"}</span>
            </Fact>
          </div>

          {(ad.rejection || ad.fix) && (
            <Panel
              title={rejectedNow ? "Why Meta rejected it" : "Rejection history"}
              className={cn(rejectedNow ? "border-bad" : "border-warn")}
            >
              <div className="grid gap-3 text-sm">
                {ad.rejection && (
                  <>
                    <div className="text-xs text-muted">
                      {ad.rejection.status === "WITH_ISSUES" ? "Flagged with issues" : "Rejected"} ·
                      first seen {shortStamp(ad.rejection.first_seen_at)}
                      {ad.rejection.cleared_at && ` · cleared ${shortStamp(ad.rejection.cleared_at)}`}
                    </div>
                    {ad.rejection.policies.length === 0 && ad.rejection.issues.length === 0 && (
                      <p className="text-muted">
                        Meta gave no policy detail for this ad. Open it in Ads Manager for the notice.
                      </p>
                    )}
                    {ad.rejection.policies.map((p, i) => (
                      <div key={`p${i}`} className="grid gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-fg">{p.policy.replace(/_/g, " ")}</span>
                          {p.scope !== "global" && <Tag>{p.scope}</Tag>}
                        </div>
                        <p className="text-muted">{p.description}</p>
                      </div>
                    ))}
                    {ad.rejection.issues.map((it, i) => (
                      <div key={`i${i}`} className="grid gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-fg">{it.summary ?? it.type ?? "Issue"}</span>
                          {it.level && <Tag>{it.level}</Tag>}
                        </div>
                        {it.message && <p className="text-muted">{it.message}</p>}
                      </div>
                    ))}
                  </>
                )}
                {ad.fix && (
                  <div className="border-t border-line pt-3">
                    <div className="text-fg">
                      Swapped to {safeImageLabel(ad.fix.safe_image_name)} on {shortStamp(ad.fix.fixed_at)}
                      {ad.fix.by_name ? ` by ${ad.fix.by_name}` : ""}.
                    </div>
                    {!ad.rejection && (
                      <div className="mt-1 text-xs text-muted">
                        Meta&apos;s reason was not kept at the time; it is now recorded before every swap.
                      </div>
                    )}
                    {ad.before_fix && afterFix && (
                      <div className="mt-1 text-xs text-muted">
                        Original creative: {num.format(ad.before_fix.purchases)} sales on{" "}
                        {peso.format(ad.before_fix.spend)}. Since the swap: {num.format(afterFix.purchases)} sales on{" "}
                        {peso.format(afterFix.spend)}.
                      </div>
                    )}
                    {ad.fix.status === "partial" && (
                      <div className="mt-1 text-xs text-warn">The engagement burst could not be applied.</div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Results" flush>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Window</TableHeader>
                  <TableHeader num>Sales</TableHeader>
                  <TableHeader num>CPP</TableHeader>
                  <TableHeader num>Spend</TableHeader>
                  <TableHeader num>ROAS</TableHeader>
                  <TableHeader num>ATC</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <WindowRow label={ad.first_3_days.complete ? "First 3 days" : `First 3 days (${ad.first_3_days.days_elapsed}/3)`} w={ad.first_3_days} />
                <WindowRow label={ad.first_7_days.complete ? "First 7 days" : `First 7 days (${ad.first_7_days.days_elapsed}/7)`} w={ad.first_7_days} />
                <WindowRow label="Lifetime" w={ad.lifetime} />
              </TableBody>
            </Table>
          </Panel>

          <Panel title="Day by day" flush>
            {ad.daily.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">Nothing delivered yet.</p>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Day</TableHeader>
                    <TableHeader num>Sales</TableHeader>
                    <TableHeader num>CPP</TableHeader>
                    <TableHeader num>Spend</TableHeader>
                    <TableHeader num>ATC</TableHeader>
                    <TableHeader num>LPV</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ad.daily.map((d, i) => (
                    <TableRow key={d.date}>
                      <TableCell>
                        <span className="font-num">{shortDate(d.date)}</span>
                        <span className="ml-1.5 text-xs text-dim">d{i + 1}</span>
                      </TableCell>
                      <TableCell num>{d.purchases > 0 ? num.format(d.purchases) : <span className="text-dim">0</span>}</TableCell>
                      <TableCell num>{d.purchases > 0 ? peso.format(d.spend / d.purchases) : "—"}</TableCell>
                      <TableCell num>{peso.format(d.spend)}</TableCell>
                      <TableCell num>{num.format(d.add_to_cart)}</TableCell>
                      <TableCell num>{num.format(d.landing_page_views)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      </aside>
    </>
  );
}
