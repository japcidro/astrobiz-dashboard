import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo, type AdDeconstruction } from "@/lib/gemini/deconstruct";
import { matchAdToStore } from "@/lib/profit/store-matching";
import type { PageEvidence, WinnerAd } from "./types";

/**
 * What is working on a page right now, for the "create your own" planner:
 * the creatives that sold most at or under the page's cost per purchase in
 * the last 90 days, with their numbers, their copy (from Facebook) and, for
 * a video, what is in it (the stored deconstruction; the top winners that
 * have none are watched now with Gemini). Also the creatives that spent
 * without selling, so the plan does not repeat them.
 */

const FB_API_BASE = "https://graph.facebook.com/v21.0";
export const EVIDENCE_DAYS = 90;
const MAX_WINNERS = 6;
const MAX_LOSERS = 3;
/** Fewer sales than this and a cost per purchase is luck; relaxed for a page that has barely sold. */
const MIN_PURCHASES = 5;
const MAX_CPP_RATIO = 1.1;
/** Winning videos with no stored analysis that are watched during planning; each can take a minute or two. */
const MAX_WATCH = 2;
const WATCH_TIMEOUT_MS = 110_000;
const COPY_SUFFIX = /\s*-\s*copy(\s*\d+)?\s*$/i;

interface TotalsRow {
  ad_id: string;
  account_id: string | null;
  ad: string | null;
  campaign: string | null;
  adset: string | null;
  account: string | null;
  purchases: number | string;
  spend: number | string;
}

interface Group {
  ad: string;
  lead: string;
  leadSpend: number;
  account_id: string | null;
  ids: string[];
  purchases: number;
  spend: number;
}

type Creative = NonNullable<CreativeNode["creative"]>;

interface CreativeNode {
  creative?: {
    body?: string;
    title?: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
    object_type?: string;
    object_story_spec?: {
      link_data?: { message?: string; name?: string; picture?: string; video_id?: string; image_hash?: string };
      video_data?: { message?: string; title?: string; image_url?: string };
      photo_data?: { caption?: string; url?: string };
    };
    asset_feed_spec?: { bodies?: Array<{ text?: string }>; titles?: Array<{ text?: string }>; videos?: unknown[] };
  };
}

const first = (...xs: Array<string | undefined | null>) => xs.map((x) => x?.trim() ?? "").find(Boolean) ?? "";
const short = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** One creative = the test ad plus its scaled copies: summed, read from the ad that spent most. */
export function groupCreatives(rows: Array<TotalsRow & { purchases: number; spend: number }>): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const name = (r.ad ?? r.ad_id).replace(COPY_SUFFIX, "").trim();
    const key = name.toUpperCase();
    const g = groups.get(key) ?? { ad: name, lead: r.ad_id, leadSpend: -1, account_id: r.account_id, ids: [], purchases: 0, spend: 0 };
    g.ids.push(r.ad_id);
    g.purchases += r.purchases;
    g.spend += r.spend;
    if (r.spend > g.leadSpend) {
      g.lead = r.ad_id;
      g.leadSpend = r.spend;
      g.account_id = r.account_id;
    }
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** The creatives that sold most at an acceptable cost, and the ones that spent most without earning it. */
export function pickWinnersAndLosers(groups: Group[], storeCpp: number): { winners: Group[]; losers: Group[] } {
  const cpp = (g: Group) => (g.purchases > 0 ? g.spend / g.purchases : Infinity);
  const bySales = (a: Group, b: Group) => b.purchases - a.purchases || cpp(a) - cpp(b);
  let winners = groups.filter((g) => g.purchases >= MIN_PURCHASES && cpp(g) <= storeCpp * MAX_CPP_RATIO).sort(bySales);
  // A young page has few sales: its best sellers are still the best evidence there is.
  if (winners.length < 3) winners = groups.filter((g) => g.purchases > 0).sort(bySales);
  winners = winners.slice(0, MAX_WINNERS);
  const picked = new Set(winners.map((w) => w.ad));
  const losers = groups
    .filter((g) => !picked.has(g.ad) && g.spend >= Math.max(1500, storeCpp * 3) && cpp(g) >= storeCpp * 1.5)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, MAX_LOSERS);
  return { winners, losers };
}

/** What a stored deconstruction says about a video, in the few fields a static can borrow from. */
export function videoSummary(a: Partial<AdDeconstruction> | null | undefined): WinnerAd["video"] {
  if (!a) return null;
  const transcript = short(a.transcript, 700).replace(/\b\d{1,2}:\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  const out = {
    avatar: short(a.classification?.avatar, 200),
    angle: short(a.classification?.angle, 240),
    hook: short(a.hook?.description, 300) || short(a.beat_map?.hook?.content, 300),
    promise: short(a.uvp?.core_promise, 240) || short(a.hook_anatomy?.implied_promise, 240),
    mechanism: short(a.uvp?.mechanism, 240),
    proof: short(a.uvp?.proof_element, 240),
    format: first(short(a.classification?.video_format, 120), short(a.classification?.strategic_format, 120)),
    look: [short(a.visual_style, 240), short(a.tone, 120)].filter(Boolean).join(" Tone: "),
    scenes: (Array.isArray(a.scenes) ? a.scenes : []).slice(0, 4).map((s) => short(s?.description, 160)).filter(Boolean),
    opening: transcript,
  };
  return Object.values(out).some((v) => (Array.isArray(v) ? v.length : v)) ? out : null;
}

const setting = async (db: SupabaseClient, key: string) => {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? null;
};

/** The copy, the thumbnail and the kind of each winning creative, in one Graph call. Empty on any failure. */
async function fetchCreatives(ids: string[], token: string): Promise<Record<string, CreativeNode>> {
  if (ids.length === 0) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const params = new URLSearchParams({ access_token: token, ids: ids.join(","), fields: "creative{body,title,thumbnail_url,image_url,video_id,object_type,object_story_spec,asset_feed_spec}" });
    const res = await fetch(`${FB_API_BASE}/?${params}`, { cache: "no-store", signal: controller.signal });
    return res.ok ? ((await res.json()) as Record<string, CreativeNode>) : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ads that Fix Rejection swapped to the safe animal picture now carry that picture and its caption on
 * Facebook; what sold was the creative they had before. This reads those originals, keyed by ad id.
 */
async function originalCreatives(db: SupabaseClient, adIds: string[], token: string): Promise<Map<string, Creative>> {
  const out = new Map<string, Creative>();
  if (adIds.length === 0) return out;
  const { data } = await db.from("fix_rejection_actions").select("ad_id, old_creative_id, created_at").in("ad_id", adIds);
  const first = new Map<string, { id: string; at: string }>();
  for (const r of (data ?? []) as Array<{ ad_id: string; old_creative_id: string | null; created_at: string }>) {
    const at = String(r.created_at);
    if (r.old_creative_id && (!first.has(r.ad_id) || at < first.get(r.ad_id)!.at)) first.set(r.ad_id, { id: r.old_creative_id, at });
  }
  if (first.size === 0) return out;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const params = new URLSearchParams({ access_token: token, ids: [...new Set([...first.values()].map((v) => v.id))].join(","), fields: "body,title,thumbnail_url,image_url,video_id,object_type,object_story_spec,asset_feed_spec" });
    const res = await fetch(`${FB_API_BASE}/?${params}`, { cache: "no-store", signal: controller.signal });
    const byId = res.ok ? ((await res.json()) as Record<string, Creative>) : {};
    // A swapped ad whose original cannot be read still must not be described by the animal picture.
    for (const [adId, v] of first) out.set(adId, byId[v.id] ?? {});
  } catch {
    for (const adId of first.keys()) out.set(adId, {});
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/** Watch one winning video with Gemini and keep the analysis where the daily cron keeps its own. Null when it cannot be watched in time. */
async function watchVideo(db: SupabaseClient, adId: string, accountId: string, token: string, geminiKey: string): Promise<Partial<AdDeconstruction> | null> {
  const work = (async () => {
    const video = await resolveAdVideo(adId, token, accountId);
    if (!video.video_url) return null;
    const out = await deconstructAdVideo(video.video_url, geminiKey);
    await db.from("ad_creative_analyses").upsert(
      { ad_id: adId, account_id: accountId, creative_id: video.creative_id, video_id: video.video_id, video_url: null, thumbnail_url: video.thumbnail_url, analysis: out.analysis as unknown as Record<string, unknown>, analyzed_by: null, trigger_source: "on_demand", model: out.model, tokens_used: out.tokens_used, cost_usd: null },
      { onConflict: "ad_id" }
    );
    return out.analysis;
  })().catch(() => null);
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), WATCH_TIMEOUT_MS))]);
}

/** The page's winners and losers of the last 90 days. Null when the page has no ad data to learn from. */
export async function loadPageEvidence(db: SupabaseClient, storeName: string): Promise<PageEvidence | null> {
  const [{ data, error }, token, geminiKey] = await Promise.all([db.rpc("ad_totals_last_days", { p_days: EVIDENCE_DAYS }), setting(db, "fb_access_token"), setting(db, "gemini_api_key")]);
  if (error) return null;
  const store = storeName.trim().toUpperCase();
  const rows = ((data ?? []) as TotalsRow[])
    .filter((r) => matchAdToStore(r.campaign ?? "", r.adset ?? "", r.account ?? "") === store)
    .map((r) => ({ ...r, purchases: Number(r.purchases) || 0, spend: Number(r.spend) || 0 }));
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const purchases = rows.reduce((s, r) => s + r.purchases, 0);
  if (rows.length === 0 || spend === 0) return null;
  const storeCpp = purchases > 0 ? spend / purchases : spend;
  const { winners, losers } = pickWinnersAndLosers(groupCreatives(rows), storeCpp);

  const [nodes, { data: analysisRows }] = await Promise.all([
    token ? fetchCreatives([...winners, ...losers].map((g) => g.lead), token) : Promise.resolve({} as Record<string, CreativeNode>),
    winners.length ? db.from("ad_creative_analyses").select("ad_id, analysis").in("ad_id", winners.flatMap((g) => g.ids)) : Promise.resolve({ data: [] }),
  ]);
  const originals = token ? await originalCreatives(db, [...winners, ...losers].map((g) => g.lead), token).catch(() => new Map<string, Creative>()) : new Map<string, Creative>();
  const analyses = new Map(((analysisRows ?? []) as Array<{ ad_id: string; analysis: Partial<AdDeconstruction> | null }>).map((a) => [a.ad_id, a.analysis]));

  const describe = (g: Group) => {
    const swapped = originals.has(g.lead);
    const c = swapped ? originals.get(g.lead) : nodes[g.lead]?.creative;
    const spec = c?.object_story_spec;
    const isVideo = !!(c?.video_id || spec?.video_data || spec?.link_data?.video_id || c?.object_type === "VIDEO" || c?.asset_feed_spec?.videos?.length);
    const isImage = !isVideo && !!(spec?.photo_data || spec?.link_data?.image_hash || c?.object_type === "PHOTO" || c?.image_url);
    return {
      swapped,
      kind: (isVideo ? "video" : isImage ? "image" : null) as WinnerAd["kind"],
      primary_text: short(first(c?.body, spec?.link_data?.message, spec?.video_data?.message, spec?.photo_data?.caption, c?.asset_feed_spec?.bodies?.[0]?.text), 600),
      headline: short(first(c?.title, spec?.link_data?.name, spec?.video_data?.title, c?.asset_feed_spec?.titles?.[0]?.text), 160),
      thumbnail_url: first(c?.thumbnail_url, spec?.video_data?.image_url) || null,
      image_url: isImage ? first(c?.image_url, spec?.photo_data?.url, spec?.link_data?.picture) || null : null,
    };
  };

  const stored = (g: Group) => g.ids.map((id) => analyses.get(id)).find((a) => a && (a.transcript || a.classification || a.hook)) ?? null;
  const drafts = winners.map((g) => ({ g, ...describe(g), analysis: stored(g) }));
  // A deconstructed ad is a video even when Facebook's answer was unreadable.
  for (const d of drafts) if (d.analysis && !d.kind) d.kind = "video";

  // The best-selling videos nobody has watched yet: watch them now, so the plan knows what is in them.
  let watched = 0;
  if (token && geminiKey) {
    // A swapped ad no longer carries its video, so it cannot be watched from the ad.
    const unseen = drafts.filter((d) => d.kind === "video" && !d.analysis && !d.swapped).slice(0, MAX_WATCH);
    const results = await Promise.all(unseen.map((d) => watchVideo(db, d.g.lead, d.g.account_id ?? "", token, geminiKey)));
    unseen.forEach((d, i) => {
      if (results[i]) {
        d.analysis = results[i];
        watched += 1;
      }
    });
  }

  const money = (g: Group) => ({ ad: g.ad, purchases: g.purchases, spend: Math.round(g.spend), cpp: g.purchases > 0 ? Math.round(g.spend / g.purchases) : null });
  return {
    days: EVIDENCE_DAYS,
    store_cpp: purchases > 0 ? Math.round(storeCpp) : null,
    purchases,
    spend: Math.round(spend),
    ads: rows.length,
    winners: drafts.map((d): WinnerAd => ({ ...money(d.g), ad_id: d.g.lead, kind: d.kind, swapped: d.swapped, primary_text: d.primary_text, headline: d.headline, thumbnail_url: d.thumbnail_url, image_url: d.image_url, video: d.kind === "image" ? null : videoSummary(d.analysis) })),
    losers: losers.map((g) => ({ ...money(g), kind: describe(g).kind, primary_text: describe(g).primary_text.slice(0, 200) })),
    watched,
    copy_read: Object.keys(nodes).length > 0,
  };
}

const peso = (n: number | null) => (n === null ? "no sale" : `₱${n.toLocaleString("en-US")}`);

/** The evidence as the planner reads it. */
export function evidenceFacts(e: PageEvidence): string {
  const winner = (w: WinnerAd, i: number) => {
    const v = w.video;
    const lines = [
      `WINNER ${i + 1}: "${w.ad}" · ${w.kind === "video" ? "video ad" : w.kind === "image" ? "static image ad" : "ad"} · ${w.purchases} purchases at ${peso(w.cpp)} each, ${peso(w.spend)} spent.`,
      w.headline ? `  Headline under the ad: "${w.headline}"` : "",
      w.primary_text ? `  Primary text opens: "${w.primary_text.slice(0, 450)}"` : "",
      v?.avatar ? `  Who the video speaks to: ${v.avatar}` : "",
      v?.angle ? `  Angle: ${v.angle}` : "",
      v?.hook ? `  Hook (first seconds): ${v.hook}` : "",
      v?.promise ? `  Promise: ${v.promise}` : "",
      v?.mechanism ? `  Mechanism it explains: ${v.mechanism}` : "",
      v?.proof ? `  Proof it shows: ${v.proof}` : "",
      v?.format ? `  Format: ${v.format}` : "",
      v?.look ? `  Look: ${v.look}` : "",
      v?.scenes.length ? `  What is on screen: ${v.scenes.join(" | ")}` : "",
      v?.opening ? `  Spoken, from the start: "${v.opening}"` : "",
      w.kind === "video" && !v ? "  (The video has not been watched; only its numbers and copy are known.)" : "",
      w.kind === "image" && w.image_url ? "  (Its image is attached below.)" : "",
      w.swapped ? "  (Meta rejected this creative after it sold, and it was swapped for a safe picture: its angle sells, but its claims or imagery crossed Meta's rules, so carry the angle with safer words and pictures.)" : "",
    ];
    return lines.filter(Boolean).join("\n");
  };
  return [
    `WHAT IS WORKING ON THIS PAGE NOW (its own ads, last ${e.days} days: ${e.purchases} purchases, ${peso(e.spend)} spent, average cost per purchase ${peso(e.store_cpp)}):`,
    e.winners.length ? e.winners.map(winner).join("\n") : "No creative has sold yet.",
    e.losers.length ? `WHAT SPENT WITHOUT EARNING IT:\n${e.losers.map((l) => `- "${l.ad}"${l.kind ? ` (${l.kind})` : ""}: ${peso(l.spend)} spent, ${l.purchases} purchases${l.cpp ? ` at ${peso(l.cpp)}` : ""}.${l.primary_text ? ` Opens: "${l.primary_text}"` : ""}`).join("\n")}` : "",
    `HOW TO USE THIS: these numbers are the strongest facts you have. The winners show which person, pain, angle, promise, proof and words this page's buyers already pay for; say so in the diagnosis. Most concepts carry a proven winner's angle into a static: a static cannot tell a 60-second story, so take the winner's hook, its key moment or its proof and put that in one frame, in new words. At least one concept tries an angle the winners have not used. Never rebuild an angle from the list that spent without earning it. A winner's claims are still checked against the brand profile and rules. In each concept's "evidence", name the winner it builds on with its numbers and what exactly it takes from it, or write "New angle, not tested on this page yet" and why it is worth a test.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
