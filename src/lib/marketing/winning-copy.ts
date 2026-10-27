// The copy of a store's best-selling ads: the bar Bulk Create's copy
// suggestions are written to. Purchases and spend per ad come from the cached
// one-day ads payloads (ad_totals_last_days); the words come from Facebook, in
// one batch call. Ads that ran the same text are counted together, so each
// primary text, headline and description is ranked by everything it sold.

import type { SupabaseClient } from "@supabase/supabase-js";
import { matchAdToStore } from "@/lib/profit/store-matching";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
export const WINNING_COPY_DAYS = 90;
/** Creatives whose copy is read: the ones that sold most. Facebook takes up to 50 ids per call. */
const MAX_CREATIVES = 40;
/** Fewer sales than this and a text's cost per purchase is luck. */
const MIN_PURCHASES = 5;
/** A text that sells at more than this times the store's average cost per purchase is not a winner. */
const MAX_CPP_RATIO = 1.1;
/** The scaled copies of an ad: "NVP-082526LIN1 - Copy", "… - Copy 2". */
const COPY_SUFFIX = /\s*-\s*copy(\s*\d+)?\s*$/i;

export interface SoldCopy {
  text: string;
  purchases: number;
  /** Cost per purchase, pesos. */
  cpp: number;
}

export interface WinningCopy {
  days: number;
  /** Spend over purchases across every ad of the store in the window. */
  store_cpp: number | null;
  primary_texts: SoldCopy[];
  headlines: SoldCopy[];
  descriptions: SoldCopy[];
  /** Ads whose sales stand behind the texts above. */
  ads: number;
}

interface TotalsRow {
  ad_id: string;
  ad: string | null;
  campaign: string | null;
  adset: string | null;
  account: string | null;
  purchases: number | string;
  spend: number | string;
}

interface CreativeNode {
  creative?: {
    body?: string;
    title?: string;
    object_story_spec?: {
      link_data?: { message?: string; name?: string; description?: string };
      video_data?: { message?: string; title?: string; link_description?: string };
    };
    asset_feed_spec?: {
      bodies?: Array<{ text?: string }>;
      titles?: Array<{ text?: string }>;
      descriptions?: Array<{ text?: string }>;
    };
  };
}

const texts = (...xs: Array<string | undefined>) => [...new Set(xs.map((x) => x?.trim() ?? "").filter(Boolean))];
const normal = (t: string) => t.replace(/\s+/g, " ").replace(/ ([.,!?])/g, "$1").trim().toLowerCase();
/** A primary text edited after launch ("siya ." fixed to "siya.", a line added) is still the same text: same opening, same family. */
const PRIMARY_KEY_CHARS = 100;

interface Tally {
  text: string;
  /** Sales of the creative that ran this exact wording: the family shows its best-selling version. */
  textPurchases: number;
  purchases: number;
  spend: number;
  ads: Set<string>;
}

function rank(tally: Map<string, Tally>, storeCpp: number, take: number) {
  return [...tally.values()]
    .filter((t) => t.purchases >= MIN_PURCHASES && t.spend / t.purchases <= storeCpp * MAX_CPP_RATIO)
    .sort((a, b) => b.purchases - a.purchases || a.spend / a.purchases - b.spend / b.purchases)
    .slice(0, take);
}

/** Null when the store has no sales in the window or Facebook cannot be read. */
export async function loadWinningCopy(db: SupabaseClient, storeName: string): Promise<WinningCopy | null> {
  const [{ data, error }, { data: tokenRow }] = await Promise.all([
    db.rpc("ad_totals_last_days", { p_days: WINNING_COPY_DAYS }),
    db.from("app_settings").select("value").eq("key", "fb_access_token").maybeSingle(),
  ]);
  const token = tokenRow?.value as string | undefined;
  if (error || !token) return null;
  const store = storeName.trim().toUpperCase();
  const rows = ((data ?? []) as TotalsRow[])
    .filter((r) => matchAdToStore(r.campaign ?? "", r.adset ?? "", r.account ?? "") === store)
    .map((r) => ({ ...r, purchases: Number(r.purchases) || 0, spend: Number(r.spend) || 0 }));
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const purchases = rows.reduce((s, r) => s + r.purchases, 0);
  if (purchases === 0) return null;
  const storeCpp = spend / purchases;

  // One creative = the test ad plus its scaled copies, which run the same words: summed, read from the ad that spent most.
  const creatives = new Map<string, { lead: string; leadSpend: number; ids: string[]; purchases: number; spend: number }>();
  for (const r of rows) {
    const key = (r.ad ?? r.ad_id).replace(COPY_SUFFIX, "").trim().toUpperCase();
    const c = creatives.get(key) ?? { lead: r.ad_id, leadSpend: -1, ids: [], purchases: 0, spend: 0 };
    c.ids.push(r.ad_id);
    c.purchases += r.purchases;
    c.spend += r.spend;
    if (r.spend > c.leadSpend) {
      c.lead = r.ad_id;
      c.leadSpend = r.spend;
    }
    creatives.set(key, c);
  }
  const sold = [...creatives.values()]
    .filter((c) => c.purchases > 0)
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, MAX_CREATIVES);
  if (sold.length === 0) return null;

  let nodes: Record<string, CreativeNode>;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({
      access_token: token,
      ids: sold.map((c) => c.lead).join(","),
      fields: "creative{body,title,object_story_spec,asset_feed_spec}",
    });
    const res = await fetch(`${FB_API_BASE}/?${params}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    nodes = (await res.json()) as Record<string, CreativeNode>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const primary = new Map<string, Tally>();
  const headline = new Map<string, Tally>();
  const description = new Map<string, Tally>();
  const add = (tally: Map<string, Tally>, list: string[], c: (typeof sold)[number], keyChars?: number) => {
    for (const text of list) {
      const key = normal(text).slice(0, keyChars);
      const t = tally.get(key) ?? { text, textPurchases: 0, purchases: 0, spend: 0, ads: new Set<string>() };
      if (c.purchases > t.textPurchases) {
        t.text = text;
        t.textPurchases = c.purchases;
      }
      t.purchases += c.purchases;
      t.spend += c.spend;
      for (const id of c.ids) t.ads.add(id);
      tally.set(key, t);
    }
  };
  for (const c of sold) {
    const cr = nodes[c.lead]?.creative;
    if (!cr) continue;
    const spec = cr.object_story_spec;
    const feed = cr.asset_feed_spec;
    add(primary, texts(cr.body, spec?.link_data?.message, spec?.video_data?.message, ...(feed?.bodies ?? []).map((b) => b.text)), c, PRIMARY_KEY_CHARS);
    add(headline, texts(cr.title, spec?.link_data?.name, spec?.video_data?.title, ...(feed?.titles ?? []).map((b) => b.text)), c);
    add(description, texts(spec?.link_data?.description, spec?.video_data?.link_description, ...(feed?.descriptions ?? []).map((b) => b.text)), c);
  }

  const out = (list: ReturnType<typeof rank>): SoldCopy[] =>
    list.map((t) => ({ text: t.text, purchases: t.purchases, cpp: Math.round(t.spend / t.purchases) }));
  const top = { primary: rank(primary, storeCpp, 3), headline: rank(headline, storeCpp, 5), description: rank(description, storeCpp, 5) };
  const ads = new Set([...top.primary, ...top.headline, ...top.description].flatMap((t) => [...t.ads]));
  return {
    days: WINNING_COPY_DAYS,
    store_cpp: Math.round(storeCpp),
    primary_texts: out(top.primary),
    headlines: out(top.headline),
    descriptions: out(top.description),
    ads: ads.size,
  };
}
