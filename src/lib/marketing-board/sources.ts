import type { SourceType } from "./types";

/**
 * What the board knows about a pasted link before the Mac worker has saved
 * a copy: where it comes from, and (for TikTok and YouTube, which answer
 * oEmbed without a token) its title, creator and thumbnail. Everything
 * else is filled in by the worker from yt-dlp's metadata.
 */
export interface SourceInfo {
  source_url: string;
  source_type: SourceType;
  title: string | null;
  author: string | null;
  external_thumbnail_url: string | null;
  embed_id: string | null;
}

export function normalizeUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u;
  } catch {
    return null;
  }
}

export function detectSource(u: URL): SourceType {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch" || host === "fb.com") {
    return u.pathname.startsWith("/ads/library") ? "fb_ads_library" : "facebook";
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  return "other";
}

/** The Ads Library id, so the card has a name before the copy is saved. */
function adsLibraryId(u: URL): string | null {
  return u.searchParams.get("id");
}

function youtubeId(u: URL): string | null {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
  return u.searchParams.get("v");
}

async function fetchJson(url: string, ms = 6000): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (astrobiz-dashboard)" } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function describeSource(u: URL): Promise<SourceInfo> {
  const source_type = detectSource(u);
  const info: SourceInfo = {
    source_url: u.toString(),
    source_type,
    title: null,
    author: null,
    external_thumbnail_url: null,
    embed_id: null,
  };

  if (source_type === "tiktok") {
    const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.toString())}`);
    if (o) {
      info.title = str(o.title);
      info.author = str(o.author_name, 120);
      info.external_thumbnail_url = str(o.thumbnail_url, 1000);
      info.embed_id = str(o.embed_product_id, 40);
    }
    if (!info.embed_id) {
      const m = u.pathname.match(/\/video\/(\d+)/);
      info.embed_id = m?.[1] ?? null;
    }
  } else if (source_type === "youtube") {
    const o = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(u.toString())}&format=json`);
    if (o) {
      info.title = str(o.title);
      info.author = str(o.author_name, 120);
      info.external_thumbnail_url = str(o.thumbnail_url, 1000);
    }
    info.embed_id = youtubeId(u);
  } else if (source_type === "fb_ads_library") {
    const id = adsLibraryId(u);
    info.title = id ? `Ads Library ad ${id}` : "Ads Library ad";
  }

  return info;
}
