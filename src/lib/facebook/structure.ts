const FB_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Campaign and ad set *structure*, read straight from Graph.
 *
 * "Add to Existing" used to build its pickers out of `/api/facebook/all-ads`,
 * which returns one row per ad **with insights attached**. Three consequences,
 * all of which read to a user as "my campaign is missing":
 *
 *  - A campaign or ad set with no spend in the window is trimmed out entirely.
 *    A brand new campaign — exactly the thing you most want to add an ad to —
 *    is the least likely to appear.
 *  - Structure was inferred from ads, so an ad set with no ads in it could
 *    never be listed, making it impossible to put the first ad into one.
 *  - It rode the heaviest, most rate-limited endpoint in the app for data that
 *    costs one cheap call to fetch directly.
 *
 * These read the campaigns and adsets edges instead. No insights, no spend
 * filter, no dependency on the ads cache.
 */

// Never offer these — they cannot take a new ad.
const DEAD_STATUSES = new Set(["DELETED", "ARCHIVED"]);

// Generous, but bounded: a runaway cursor must not hang the wizard.
const MAX_RESULT_PAGES = 10;
const PER_PAGE = 200;

export interface FbCampaignRef {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string | null;
}

export interface FbAdsetRef {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string | null;
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string };
  error?: { message?: string };
}

async function graphPaged<T>(
  path: string,
  token: string
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  let url: string =
    `${FB_API_BASE}${path}${sep}limit=${PER_PAGE}&access_token=${encodeURIComponent(token)}`;

  for (let i = 0; i < MAX_RESULT_PAGES && url; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as GraphPage<T>;
      if (!res.ok || json.error) {
        return {
          data: out,
          error: json.error?.message || `Facebook error ${res.status}`,
        };
      }
      out.push(...(json.data ?? []));
      url = json.paging?.next ?? "";
    } catch (err) {
      return {
        data: out,
        error: err instanceof Error ? err.message : "request failed",
      };
    }
  }
  return { data: out, error: null };
}

function isLive(row: { status?: string; effective_status?: string }): boolean {
  return (
    !DEAD_STATUSES.has(row.status ?? "") &&
    !DEAD_STATUSES.has(row.effective_status ?? "")
  );
}

/** Every campaign in an ad account that could accept a new ad. */
export async function fetchCampaigns(
  accountId: string,
  token: string
): Promise<{ campaigns: FbCampaignRef[]; error: string | null }> {
  const { data, error } = await graphPaged<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    objective?: string;
  }>(
    `/${accountId}/campaigns?fields=id,name,status,effective_status,objective`,
    token
  );

  const campaigns = data
    .filter((c): c is { id: string } & typeof c => Boolean(c.id) && isLive(c))
    .map((c) => ({
      id: c.id,
      name: c.name || "(unnamed campaign)",
      status: c.status || "UNKNOWN",
      effective_status: c.effective_status || c.status || "UNKNOWN",
      objective: c.objective ?? null,
    }));

  // Active first, then alphabetical — the running ones are what you want.
  campaigns.sort((a, b) => {
    const aActive = a.effective_status === "ACTIVE" ? 0 : 1;
    const bActive = b.effective_status === "ACTIVE" ? 0 : 1;
    return aActive - bActive || a.name.localeCompare(b.name);
  });

  return { campaigns, error };
}

/** Every ad set under a campaign that could accept a new ad. */
export async function fetchAdsets(
  campaignId: string,
  token: string
): Promise<{ adsets: FbAdsetRef[]; error: string | null }> {
  const { data, error } = await graphPaged<{
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    campaign_id?: string;
  }>(
    `/${campaignId}/adsets?fields=id,name,status,effective_status,campaign_id`,
    token
  );

  const adsets = data
    .filter((a): a is { id: string } & typeof a => Boolean(a.id) && isLive(a))
    .map((a) => ({
      id: a.id,
      name: a.name || "(unnamed ad set)",
      status: a.status || "UNKNOWN",
      effective_status: a.effective_status || a.status || "UNKNOWN",
      campaign_id: a.campaign_id ?? null,
    }));

  adsets.sort((a, b) => {
    const aActive = a.effective_status === "ACTIVE" ? 0 : 1;
    const bActive = b.effective_status === "ACTIVE" ? 0 : 1;
    return aActive - bActive || a.name.localeCompare(b.name);
  });

  return { adsets, error };
}
