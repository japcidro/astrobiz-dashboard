import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";
import { matchAdToStore } from "@/lib/profit/store-matching";
import type { Winner, WinnersView } from "./types";

/**
 * The brand's winners, from the cached ad metrics joined to the
 * deconstructions: newest launch first, with a thumbnail from Facebook and
 * the transcript when the ad has been deconstructed. Cached per brand;
 * refreshed on demand and when a day old.
 */

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_WINNERS = 24;
const MIN_PURCHASES = 5;
/** Thumbnail lookups per refresh, to spare the Graph budget; the rest come on later refreshes. */
const MAX_THUMB_LOOKUPS = 12;

interface MetricRow {
  ad_id: string;
  account_id: string | null;
  ad: string;
  campaign: string | null;
  adset: string | null;
  account: string | null;
  purchases: number | string;
  spend: number | string;
  created_time: string | null;
}

interface AnalysisRow {
  ad_id: string;
  thumbnail_url: string | null;
  analysis: { transcript?: string; duration_seconds?: number } | null;
}

export const cleanTranscript = (t: string) => t.replace(/\b\d{1,2}:\d{2}\b/g, "").replace(/\s+/g, " ").trim();
export const hookOf = (t: string) => cleanTranscript(t).replace(/\[ON-SCREEN:[^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

async function fbToken(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "fb_access_token").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

/** One Graph call: the creative's thumbnail. Null on any failure. */
async function fetchThumbnail(adId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${FB_API_BASE}/${adId}?fields=creative{thumbnail_url}&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { creative?: { thumbnail_url?: string } };
    return json.creative?.thumbnail_url ?? null;
  } catch {
    return null;
  }
}

/** Every ad of the brand with metrics, from the cached payloads. */
export async function storeMetrics(db: SupabaseClient, store: string): Promise<MetricRow[] | { error: string }> {
  const { data, error } = await db.rpc("script_studio_ad_metrics");
  if (error) return { error: `Could not read the ad metrics: ${error.message}` };
  const upper = store.trim().toUpperCase();
  return ((data ?? []) as MetricRow[]).filter((r) => matchAdToStore(r.campaign ?? "", r.adset ?? "", r.account ?? "") === upper);
}

export async function loadWinners(db: SupabaseClient, store: string): Promise<WinnersView | null> {
  const { data } = await db.from("script_brand_winners").select("store, winners, refreshed_at").eq("store", store).maybeSingle();
  return data ? { store, winners: (data.winners as Winner[]) ?? [], refreshed_at: data.refreshed_at as string } : null;
}

/** The list, rebuilt from the data when missing, stale or forced. */
export async function refreshWinners(db: SupabaseClient, store: string, force = false): Promise<WinnersView | { error: string }> {
  const cached = await loadWinners(db, store);
  if (cached && !force && Date.now() - new Date(cached.refreshed_at).getTime() < STALE_MS) return cached;

  const metrics = await storeMetrics(db, store);
  if ("error" in metrics) return cached ?? metrics;
  const rows = metrics.map((r) => ({ ...r, purchases: Number(r.purchases) || 0, spend: Number(r.spend) || 0 }));
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const buys = rows.reduce((s, r) => s + r.purchases, 0);
  const blended = buys > 0 ? spend / buys : null;
  const verdict = (purchases: number, spendOf: number): Winner["verdict"] => {
    const cpa = purchases > 0 ? spendOf / purchases : null;
    if (!blended || cpa === null) return spendOf >= 1500 ? "loser" : "middle";
    if (cpa <= blended * 0.95 && purchases >= 10) return "winner";
    if (cpa >= blended * 1.2 && spendOf >= 1500) return "loser";
    return "middle";
  };
  // The ads that sold: newest launch first, so the current winners lead the list.
  const picked = rows
    .filter((r) => r.purchases >= MIN_PURCHASES)
    .sort((a, b) => (b.created_time ?? "").localeCompare(a.created_time ?? "") || b.purchases - a.purchases)
    .slice(0, MAX_WINNERS);
  const { data: analysisRows } = picked.length ? await db.from("ad_creative_analyses").select("ad_id, thumbnail_url, analysis").in("ad_id", picked.map((r) => r.ad_id)) : { data: [] };
  const analyses = new Map(((analysisRows ?? []) as AnalysisRow[]).map((a) => [a.ad_id, a]));
  const previous = new Map((cached?.winners ?? []).map((w) => [w.ad_id, w]));
  const token = await fbToken(db);
  let lookups = 0;
  const winners: Winner[] = [];
  for (const r of picked) {
    const a = analyses.get(r.ad_id);
    const transcript = cleanTranscript(a?.analysis?.transcript ?? "").slice(0, 8000);
    let thumbnail = a?.thumbnail_url ?? previous.get(r.ad_id)?.thumbnail_url ?? null;
    if (!thumbnail && token && lookups < MAX_THUMB_LOOKUPS) {
      lookups += 1;
      thumbnail = await fetchThumbnail(r.ad_id, token);
    }
    winners.push({
      ad_id: r.ad_id,
      account_id: r.account_id,
      ad: r.ad,
      created_time: r.created_time,
      purchases: r.purchases,
      spend: Math.round(r.spend),
      cpa: r.purchases > 0 ? Math.round(r.spend / r.purchases) : null,
      verdict: verdict(r.purchases, r.spend),
      thumbnail_url: thumbnail,
      transcript,
      hook: hookOf(transcript),
      seconds: typeof a?.analysis?.duration_seconds === "number" ? a.analysis.duration_seconds : null,
    });
  }
  const refreshed_at = new Date().toISOString();
  const { error } = await db.from("script_brand_winners").upsert({ store, winners, refreshed_at }, { onConflict: "store" });
  if (error) return { error: error.message };
  return { store, winners, refreshed_at };
}

/** Deconstruct one of our ads on demand (Gemini, from the Facebook video) and keep it where the cron keeps its own. */
export async function transcribeWinner(db: SupabaseClient, store: string, adId: string): Promise<WinnersView | { error: string }> {
  const view = await refreshWinners(db, store);
  if ("error" in view) return view;
  const w = view.winners.find((x) => x.ad_id === adId);
  if (!w) return { error: "That ad is not in the winners list" };
  if (w.transcript) return view;
  const [token, { data: geminiRow }] = await Promise.all([fbToken(db), db.from("app_settings").select("value").eq("key", "gemini_api_key").maybeSingle()]);
  const geminiKey = (geminiRow?.value as string | undefined) ?? null;
  if (!token) return { error: "No Facebook token in Settings" };
  if (!geminiKey) return { error: "No Gemini API key in Settings" };
  let transcript = "";
  let seconds: number | null = null;
  let thumbnail = w.thumbnail_url;
  try {
    const video = await resolveAdVideo(adId, token, w.account_id ?? "");
    if (!video.video_url) return { error: `Facebook gave no video for this ad (${video.source_note})` };
    thumbnail = thumbnail ?? video.thumbnail_url;
    const out = await deconstructAdVideo(video.video_url, geminiKey);
    transcript = cleanTranscript(out.analysis.transcript ?? "").slice(0, 8000);
    seconds = typeof out.analysis.duration_seconds === "number" ? out.analysis.duration_seconds : null;
    if (!transcript) return { error: "Gemini heard no speech in this ad" };
    await db.from("ad_creative_analyses").upsert(
      {
        ad_id: adId,
        account_id: w.account_id ?? "",
        creative_id: video.creative_id,
        video_id: video.video_id,
        video_url: null,
        thumbnail_url: video.thumbnail_url,
        analysis: out.analysis as unknown as Record<string, unknown>,
        analyzed_by: null,
        trigger_source: "on_demand",
        model: out.model,
        tokens_used: out.tokens_used,
        cost_usd: null,
      },
      { onConflict: "ad_id" }
    );
  } catch (e) {
    return { error: e instanceof Error ? `Transcription failed: ${e.message.slice(0, 200)}` : "Transcription failed" };
  }
  const winners = view.winners.map((x) => (x.ad_id === adId ? { ...x, transcript, hook: hookOf(transcript), seconds, thumbnail_url: thumbnail } : x));
  const { error } = await db.from("script_brand_winners").update({ winners }).eq("store", store);
  if (error) return { error: error.message };
  return { ...view, winners };
}
