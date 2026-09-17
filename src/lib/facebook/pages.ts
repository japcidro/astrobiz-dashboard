const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Meta hands the same Page back from several edges depending on how it was
// attached to the business, and a Page can legitimately appear in only one of
// them. Anything that needs "every Page we could run an ad from" has to read
// all of these and merge, never just the first one that answers.
export const PAGE_SOURCES = {
  ME_ACCOUNTS: "/me/accounts",
  OWNED: "business owned_pages",
  CLIENT: "business client_pages",
} as const;

export interface FbPage {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
  /** Which Graph edges returned this Page. Useful when one of them is empty. */
  sources: string[];
}

export interface PageLookupResult {
  pages: FbPage[];
  /** Per-edge failures, in plain words. Never thrown — a dead edge must not
   *  hide the Pages the other edges did return. */
  warnings: string[];
  counts: Record<string, number>;
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
  error?: { message?: string; code?: number };
}

// Guard against a runaway cursor loop on an account with many pages.
const MAX_PAGES_OF_RESULTS = 10;
const PER_PAGE = 100;

/**
 * Drain a paginated Graph edge. Returns whatever it managed to read plus an
 * error string — a partial read is still better than none.
 */
async function graphList<T>(
  path: string,
  token: string
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  let url: string =
    `${FB_API_BASE}${path}${sep}limit=${PER_PAGE}&access_token=${encodeURIComponent(token)}`;

  for (let i = 0; i < MAX_PAGES_OF_RESULTS && url; i++) {
    let json: GraphPage<T>;
    try {
      const res = await fetch(url, { cache: "no-store" });
      json = (await res.json()) as GraphPage<T>;
      if (!res.ok || json.error) {
        return {
          data: out,
          error: json.error?.message || `Graph error ${res.status}`,
        };
      }
    } catch (err) {
      return {
        data: out,
        error: err instanceof Error ? err.message : "request failed",
      };
    }
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? "";
  }

  return { data: out, error: null };
}

type RawPage = { id?: string; name?: string; picture?: { data?: { url?: string } } };

/**
 * Every Facebook Page this token can see, merged across all three edges.
 *
 * The previous version asked `/me/accounts` and only fell back to the business
 * edges when that returned *zero* Pages. That works right up until the day a
 * new brand's Page is added to Business Manager without giving the token's
 * user a Page role: `/me/accounts` still returns the older Pages, so the
 * fallback never fires and the new Page is invisible forever.
 */
export async function fetchAllFbPages(token: string): Promise<PageLookupResult> {
  const byId = new Map<string, FbPage>();
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  const absorb = (rows: RawPage[], source: string) => {
    let added = 0;
    for (const row of rows) {
      if (!row.id) continue;
      added++;
      const existing = byId.get(row.id);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        // Keep whichever copy carries a picture.
        if (!existing.picture?.data?.url && row.picture?.data?.url) {
          existing.picture = row.picture;
        }
      } else {
        byId.set(row.id, {
          id: row.id,
          name: row.name || "(unnamed page)",
          picture: row.picture,
          sources: [source],
        });
      }
    }
    counts[source] = added;
  };

  // 1. Pages the token's user personally has a role on.
  const mine = await graphList<RawPage>(
    "/me/accounts?fields=id,name,picture{url}",
    token
  );
  absorb(mine.data, PAGE_SOURCES.ME_ACCOUNTS);
  if (mine.error) {
    warnings.push(`${PAGE_SOURCES.ME_ACCOUNTS}: ${mine.error}`);
  }

  // 2. Pages held by every business the token can see — owned and client.
  //    Needs business_management; without it this whole branch is skipped and
  //    the warning says so rather than failing quietly.
  const businesses = await graphList<{ id?: string; name?: string }>(
    "/me/businesses?fields=id,name",
    token
  );
  if (businesses.error) {
    warnings.push(`/me/businesses: ${businesses.error}`);
  }

  for (const biz of businesses.data) {
    if (!biz.id) continue;
    for (const [edge, source] of [
      ["owned_pages", PAGE_SOURCES.OWNED],
      ["client_pages", PAGE_SOURCES.CLIENT],
    ] as const) {
      const res = await graphList<RawPage>(
        `/${biz.id}/${edge}?fields=id,name,picture{url}`,
        token
      );
      absorb(res.data, source);
      if (res.error) {
        warnings.push(`${biz.name || biz.id} ${edge}: ${res.error}`);
      }
    }
  }

  const pages = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return { pages, warnings, counts };
}

/**
 * Can Meta mint a Page access token for this Page?
 *
 * This is the question that decides whether a dark-post video will ever play:
 * `/{video_id}?fields=source` returns null for everyone except a Page token,
 * so a Page that is listed but can't produce one shows ads fine and plays no
 * video. Requires pages_read_engagement plus a real role on the Page.
 */
export async function canMintPageToken(
  pageId: string,
  token: string
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const res = await fetch(
      `${FB_API_BASE}/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const json = (await res.json()) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (json.access_token) return { ok: true, reason: null };
    return {
      ok: false,
      reason: json.error?.message || "Graph returned no access_token",
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "request failed",
    };
  }
}
