const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Meta hands the same Page back from several edges depending on how it was
// attached to the business, and a Page can legitimately appear in only one of
// them. Anything that needs "every Page we could run an ad from" has to read
// all of these and merge, never just the first one that answers.
export const PAGE_SOURCES = {
  ME_ACCOUNTS: "/me/accounts",
  ASSIGNED: "system user assigned_pages",
  OWNED: "business owned_pages",
  CLIENT: "business client_pages",
  PROMOTE: "ad account promote_pages",
} as const;

export interface FbPage {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
  /** Which Graph edges returned this Page. Useful when one of them is empty. */
  sources: string[];
  /** Page-level tasks granted to the token, when the edge reports them.
   *  Without ADVERTISE/MANAGE an ad cannot actually be created on the Page. */
  tasks?: string[];
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

type RawPage = {
  id?: string;
  name?: string;
  picture?: { data?: { url?: string } };
  tasks?: string[];
};

const PAGE_FIELDS = "id,name,picture{url},tasks";

/**
 * Every business this token belongs to or can administer.
 *
 * Three discovery paths, because which one answers depends on what kind of
 * token is connected — and picking only one is how a whole business goes
 * missing:
 *
 *  - `/me/businesses` is a **User** edge. A System User token gets an empty
 *    list back, with no error, so nothing downstream ever runs.
 *  - `/me?fields=business` is the System User's own owning business.
 *  - Ad accounts carry a `business` too, which catches anything the first two
 *    miss and costs nothing — the accounts are already being listed.
 */
async function discoverBusinesses(
  token: string
): Promise<{ businesses: Map<string, string>; warnings: string[] }> {
  const businesses = new Map<string, string>();
  const warnings: string[] = [];

  const add = (id?: string | null, name?: string | null) => {
    if (!id) return;
    if (!businesses.has(id) || (name && businesses.get(id) === id)) {
      businesses.set(id, name || id);
    }
  };

  // User tokens.
  const viaUser = await graphList<{ id?: string; name?: string }>(
    "/me/businesses?fields=id,name",
    token
  );
  for (const b of viaUser.data) add(b.id, b.name);
  if (viaUser.error) warnings.push(`/me/businesses: ${viaUser.error}`);

  // System User tokens — the node carries its owning business directly.
  try {
    const res = await fetch(
      `${FB_API_BASE}/me?fields=business&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const json = (await res.json()) as {
      business?: { id?: string; name?: string };
      error?: { message?: string };
    };
    if (json.error) warnings.push(`/me?fields=business: ${json.error.message}`);
    add(json.business?.id, json.business?.name);
  } catch (err) {
    warnings.push(
      `/me?fields=business: ${err instanceof Error ? err.message : "request failed"}`
    );
  }

  // Whatever the ad accounts belong to — belt and braces.
  const viaAccounts = await graphList<{
    id?: string;
    business?: { id?: string; name?: string };
  }>("/me/adaccounts?fields=business", token);
  for (const a of viaAccounts.data) add(a.business?.id, a.business?.name);
  if (viaAccounts.error) {
    warnings.push(`/me/adaccounts: ${viaAccounts.error}`);
  }

  return { businesses, warnings };
}

/**
 * Every Facebook Page this token can see, merged across every edge Meta
 * exposes.
 *
 * Two earlier versions each missed Pages for a different reason. The first
 * asked `/me/accounts` and only fell back to the business edges when that
 * returned *zero* Pages — so a new brand's Page stayed invisible as long as
 * any older Page answered. The second always asked the business edges, but
 * discovered businesses through `/me/businesses`, which a System User token
 * answers with an empty list. Both failed silently, which is why this now
 * reads every edge and reports what each one returned.
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
        if (!existing.picture?.data?.url && row.picture?.data?.url) {
          existing.picture = row.picture;
        }
        // Tasks are only reported by some edges — keep the fullest answer.
        if (row.tasks?.length && (row.tasks.length > (existing.tasks?.length ?? 0))) {
          existing.tasks = row.tasks;
        }
      } else {
        byId.set(row.id, {
          id: row.id,
          name: row.name || "(unnamed page)",
          picture: row.picture,
          sources: [source],
          tasks: row.tasks,
        });
      }
    }
    counts[source] = (counts[source] ?? 0) + added;
  };

  // 1. Pages the token's identity has a direct role on.
  //    /me/accounts answers for User tokens; assigned_pages for System Users.
  const [mine, assigned] = await Promise.all([
    graphList<RawPage>(`/me/accounts?fields=${PAGE_FIELDS}`, token),
    graphList<RawPage>(`/me/assigned_pages?fields=${PAGE_FIELDS}`, token),
  ]);
  absorb(mine.data, PAGE_SOURCES.ME_ACCOUNTS);
  if (mine.error) warnings.push(`${PAGE_SOURCES.ME_ACCOUNTS}: ${mine.error}`);
  absorb(assigned.data, PAGE_SOURCES.ASSIGNED);
  if (assigned.error) {
    warnings.push(`${PAGE_SOURCES.ASSIGNED}: ${assigned.error}`);
  }

  // 2. Everything the businesses hold, owned and client.
  const { businesses, warnings: bizWarnings } = await discoverBusinesses(token);
  warnings.push(...bizWarnings);

  await Promise.all(
    Array.from(businesses.entries()).flatMap(([bizId, bizName]) =>
      (
        [
          ["owned_pages", PAGE_SOURCES.OWNED],
          ["client_pages", PAGE_SOURCES.CLIENT],
        ] as const
      ).map(async ([edge, source]) => {
        const res = await graphList<RawPage>(
          `/${bizId}/${edge}?fields=${PAGE_FIELDS}`,
          token
        );
        absorb(res.data, source);
        if (res.error) warnings.push(`${bizName} ${edge}: ${res.error}`);
      })
    )
  );

  // 3. Pages each ad account is allowed to promote. This is the closest edge
  //    to the question Create Ad actually asks, and it catches Pages shared
  //    into an account without being owned by a business the token can read.
  const accounts = await graphList<{ id?: string; name?: string }>(
    "/me/adaccounts?fields=id,name",
    token
  );
  if (accounts.error) warnings.push(`/me/adaccounts: ${accounts.error}`);

  await Promise.all(
    accounts.data.map(async (acct) => {
      if (!acct.id) return;
      const res = await graphList<RawPage>(
        `/${acct.id}/promote_pages?fields=${PAGE_FIELDS}`,
        token
      );
      absorb(res.data, PAGE_SOURCES.PROMOTE);
      // A single account refusing this edge is normal and not worth shouting
      // about — only report it when nothing else found any Page at all.
      if (res.error && byId.size === 0) {
        warnings.push(`${acct.name || acct.id} promote_pages: ${res.error}`);
      }
    })
  );

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
