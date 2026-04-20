import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// In-memory cache of "scaling campaign → set of creative_ids". Keyed by
// campaign_id. Refreshes every 5 minutes so promoting an ad is visible
// in the detection output quickly but we're not spamming FB per request.
const creativeCache = new Map<
  string,
  { creative_ids: Map<string, string>; fetched_at: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadScalingCreatives(
  campaignId: string,
  token: string
): Promise<Map<string, string>> {
  const cached = creativeCache.get(campaignId);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return cached.creative_ids;
  }

  // Walk all ads in the campaign and map creative_id → ad_id in scaling.
  const creativeIds = new Map<string, string>();
  let next:
    | string
    | null = `${FB_API_BASE}/${campaignId}/ads?fields=id,creative{id}&limit=200&access_token=${encodeURIComponent(token)}`;
  while (next) {
    const res: Response = await fetch(next, { cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json()) as {
      data?: Array<{ id: string; creative?: { id?: string } }>;
      paging?: { next?: string };
    };
    for (const ad of json.data ?? []) {
      const cid = ad.creative?.id;
      if (cid && !creativeIds.has(cid)) {
        creativeIds.set(cid, ad.id);
      }
    }
    next = json.paging?.next ?? null;
  }

  creativeCache.set(campaignId, {
    creative_ids: creativeIds,
    fetched_at: Date.now(),
  });
  return creativeIds;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { ad_ids?: string[] };
  const adIds = Array.isArray(body.ad_ids)
    ? body.ad_ids.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  if (adIds.length === 0) {
    return Response.json({ results: {} });
  }
  if (adIds.length > 500) {
    return Response.json(
      { error: "Too many ad_ids — max 500 per call" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const [{ data: tokenRow }, { data: scalingRows }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase.from("store_scaling_campaigns").select("*"),
  ]);
  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  const scalingCampaigns =
    (scalingRows as
      | Array<{
          store_name: string;
          account_id: string;
          campaign_id: string;
          campaign_name: string;
        }>
      | null) ?? [];

  if (scalingCampaigns.length === 0) {
    return Response.json({
      results: {},
      note: "No scaling campaigns configured. Go to Admin → Settings → Scaling Campaigns.",
    });
  }

  // 1. Resolve creative_id for each testing ad_id.
  //    Batch via /?ids=a,b,c&fields=creative{id},campaign{id}
  const creativeByAd = new Map<
    string,
    { creative_id: string | null; campaign_id: string | null }
  >();
  const CHUNK = 50;
  for (let i = 0; i < adIds.length; i += CHUNK) {
    const chunk = adIds.slice(i, i + CHUNK);
    const url = `${FB_API_BASE}/?ids=${chunk.join(",")}&fields=creative{id},campaign{id}&access_token=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<
        string,
        { creative?: { id?: string }; campaign?: { id?: string } }
      >;
      for (const [id, node] of Object.entries(json)) {
        creativeByAd.set(id, {
          creative_id: node?.creative?.id ?? null,
          campaign_id: node?.campaign?.id ?? null,
        });
      }
    } catch {
      // skip chunk on error
    }
  }

  // 2. Load scaling creative maps (one per configured scaling campaign).
  //    We load every configured campaign once per request to handle the
  //    case where an ad's own campaign is in one store but it's visible
  //    cross-store. Usually 1-3 campaigns so volume is low.
  const scalingMaps = new Map<string, Map<string, string>>();
  await Promise.all(
    scalingCampaigns.map(async (sc) => {
      const m = await loadScalingCreatives(sc.campaign_id, token);
      scalingMaps.set(sc.campaign_id, m);
    })
  );

  // 3. For each ad, check if its creative_id appears in any scaling map.
  //    Result shape: { ad_id: { in_scaling, scaled_ad_id, scaled_in_campaign } | null }
  const results: Record<
    string,
    {
      in_scaling: boolean;
      scaled_ad_id: string | null;
      scaled_in_campaign: string | null;
      scaled_in_store: string | null;
      self_is_scaling: boolean;
    }
  > = {};
  for (const adId of adIds) {
    const info = creativeByAd.get(adId) ?? {
      creative_id: null,
      campaign_id: null,
    };
    const selfScaling = scalingCampaigns.some(
      (sc) => sc.campaign_id === info.campaign_id
    );

    if (!info.creative_id) {
      results[adId] = {
        in_scaling: false,
        scaled_ad_id: null,
        scaled_in_campaign: null,
        scaled_in_store: null,
        self_is_scaling: selfScaling,
      };
      continue;
    }

    let match: { sc_campaign: string; scaled_ad_id: string } | null = null;
    for (const sc of scalingCampaigns) {
      const map = scalingMaps.get(sc.campaign_id);
      if (!map) continue;
      const scaledAdId = map.get(info.creative_id);
      if (scaledAdId && sc.campaign_id !== info.campaign_id) {
        // Match found in a scaling campaign that isn't the ad's own
        // campaign (that would be self-match for scaling ads themselves).
        match = { sc_campaign: sc.campaign_id, scaled_ad_id: scaledAdId };
        break;
      }
    }

    const scMatch = match
      ? scalingCampaigns.find((s) => s.campaign_id === match!.sc_campaign) ??
        null
      : null;

    results[adId] = {
      in_scaling: !!match,
      scaled_ad_id: match?.scaled_ad_id ?? null,
      scaled_in_campaign: match?.sc_campaign ?? null,
      scaled_in_store: scMatch?.store_name ?? null,
      self_is_scaling: selfScaling,
    };
  }

  return Response.json({ results });
}
