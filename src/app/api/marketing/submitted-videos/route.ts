import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { matchAdToStore } from "@/lib/profit/store-matching";
import type { SubmittedAd } from "@/lib/marketing/submitted-videos";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;
const MAX_PAGES_PER_ACCOUNT = 15; // safety cap (~1500 ads/account)
const PAGE_SIZE = 100;

// Ad-name prefix → marketer. Names look like "ILP-060726JO1", "CAP-043026LIN1".
const MARKETERS: { code: string; name: string; match: RegExp }[] = [
  { code: "LIN", name: "Linette", match: /linette/i },
  { code: "JO", name: "Jhoanna", match: /jhoanna|^jo\b/i },
];

function attributeMarketer(adName: string): {
  code: string | null;
  name: string;
} {
  const found: string[] = [];
  const re = /(LIN|JO)\d*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(adName)) !== null) found.push(m[1].toUpperCase());
  const code = found[0] ?? null;
  const marketer = code ? MARKETERS.find((x) => x.code === code) : null;
  return { code, name: marketer?.name ?? (code ? code : "Unknown") };
}

// Which marketer code (if any) does this employee map to?
function codeForEmployee(fullName: string): string | null {
  return MARKETERS.find((m) => m.match.test(fullName))?.code ?? null;
}

// In-memory cache per (accounts+days) scope. Serverless instances are
// ephemeral, but this still spares the FB API on repeated loads within an
// instance. The client also caches (client-cache), so FB is hit rarely.
const adsCache = new Map<string, { data: SubmittedAd[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

interface RawCreative {
  id?: string;
  video_id?: string;
  thumbnail_url?: string;
  image_url?: string;
  object_story_spec?: {
    video_data?: { video_id?: string };
    link_data?: { picture?: string; image_hash?: string };
  };
}
interface RawAd {
  id: string;
  name: string;
  created_time?: string;
  effective_status?: string;
  creative?: RawCreative;
  adset?: { id?: string; name?: string; start_time?: string };
  campaign?: { id?: string; name?: string };
}

async function fetchAccountAds(
  accountId: string,
  token: string,
  sinceUnix: number
): Promise<RawAd[]> {
  const fields =
    "id,name,created_time,effective_status," +
    "creative{id,video_id,thumbnail_url,image_url,object_story_spec}," +
    "adset{id,name,start_time},campaign{id,name}";
  const filtering = JSON.stringify([
    { field: "ad.created_time", operator: "GREATER_THAN", value: sinceUnix },
  ]);

  let url =
    `${FB_API_BASE}/${accountId}/ads?` +
    new URLSearchParams({
      access_token: token,
      fields,
      filtering,
      limit: String(PAGE_SIZE),
    }).toString();

  const out: RawAd[] = [];
  for (let page = 0; url && page < MAX_PAGES_PER_ACCOUNT; page++) {
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      // Rate limit or other FB error — stop paging this account, keep what we have.
      break;
    }
    const data = (json.data ?? []) as RawAd[];
    out.push(...data);
    url = (json.paging?.next as string) ?? "";
  }
  return out;
}

function toSubmittedAd(ad: RawAd, sinceMs: number): SubmittedAd | null {
  // Belt-and-suspenders date filter (in case FB ignores `filtering`).
  const createdMs = ad.created_time ? new Date(ad.created_time).getTime() : 0;
  if (createdMs && createdMs < sinceMs) return null;

  const creative = ad.creative ?? {};
  const oss = creative.object_story_spec ?? {};
  // Prefer the object_story_spec video id — that's the uploaded video that
  // exposes a playable `source`. creative.video_id is an ad-level reference
  // that returns no source (true for both normal and duplicated "- Copy" ads).
  const videoId = oss.video_data?.video_id ?? creative.video_id ?? null;
  const imageUrl = creative.image_url ?? oss.link_data?.picture ?? null;
  const campaignName = ad.campaign?.name ?? null;
  const adsetName = ad.adset?.name ?? null;
  const startTime = ad.adset?.start_time ?? null;
  const { code, name } = attributeMarketer(ad.name);
  const store =
    matchAdToStore(`${campaignName ?? ""} ${ad.name}`, adsetName ?? "") || null;

  return {
    fb_ad_id: ad.id,
    ad_account_id: "",
    ad_name: ad.name,
    creative_type: videoId ? "video" : "image",
    video_id: videoId,
    thumbnail_url: creative.thumbnail_url ?? null,
    image_url: imageUrl,
    marketer_name: name,
    marketer_code: code,
    created_time: ad.created_time ?? null,
    start_time: startTime,
    effective_status: ad.effective_status ?? null,
    is_scheduled: startTime
      ? new Date(startTime).getTime() > Date.now()
      : false,
    store_name: store,
    campaign_name: campaignName,
    adset_name: adsetName,
    reviewed_at: null,
    reviewed_by: null,
    reviewed_by_name: null,
    note: null,
    note_by_name: null,
    note_at: null,
    is_starred: false,
  };
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(
    MAX_DAYS,
    Math.max(1, parseInt(searchParams.get("days") || String(DEFAULT_DAYS), 10) || DEFAULT_DAYS)
  );
  const forceRefresh = searchParams.get("refresh") === "1";

  const supabase = await createClient();

  // FB token (same source the create + token routes use).
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured. Go to Settings." },
      { status: 400 }
    );
  }
  const token = tokenSetting.value as string;

  // Selected ad accounts (mirrors all-ads). If none selected, use all under the token.
  const { data: selectedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();
  let accountIds: string[] = [];
  try {
    accountIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    accountIds = [];
  }
  if (accountIds.length === 0) {
    try {
      const res = await fetch(
        `${FB_API_BASE}/me/adaccounts?fields=id&limit=100&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      accountIds = ((json.data ?? []) as { id: string }[]).map((a) => a.id);
    } catch {
      accountIds = [];
    }
  }

  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const sinceUnix = Math.floor(sinceMs / 1000);
  const cacheKey = `${accountIds.join(",")}|${days}`;

  let ads: SubmittedAd[];
  const cached = adsCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    ads = cached.data;
  } else {
    const perAccount = await Promise.all(
      accountIds.map(async (acct) => {
        try {
          const raw = await fetchAccountAds(acct, token, sinceUnix);
          return raw
            .map((r) => {
              const dto = toSubmittedAd(r, sinceMs);
              if (dto) dto.ad_account_id = acct;
              return dto;
            })
            .filter((x): x is SubmittedAd => x !== null);
        } catch {
          return [] as SubmittedAd[];
        }
      })
    );
    ads = perAccount.flat();
    // Newest first.
    ads.sort((a, b) =>
      (b.created_time ?? "").localeCompare(a.created_time ?? "")
    );
    adsCache.set(cacheKey, { data: ads, timestamp: Date.now() });
  }

  // Marketers see only their own ads (matched by name-prefix code).
  if (employee.role === "marketing") {
    const myCode = codeForEmployee(employee.full_name);
    ads = myCode ? ads.filter((a) => a.marketer_code === myCode) : [];
  }

  // Merge reviewed state (keyed by fb_ad_id).
  const { data: reviews } = await supabase
    .from("fb_ad_reviews")
    .select("fb_ad_id, reviewed_at, reviewed_by, reviewer:employees!reviewed_by(full_name)");
  if (reviews && reviews.length > 0) {
    const map = new Map(
      reviews.map((r: Record<string, unknown>) => [
        r.fb_ad_id as string,
        {
          reviewed_at: r.reviewed_at as string | null,
          reviewed_by: r.reviewed_by as string | null,
          reviewed_by_name:
            ((r.reviewer as { full_name?: string } | null)?.full_name as string) ??
            null,
        },
      ])
    );
    ads = ads.map((a) => {
      const rv = map.get(a.fb_ad_id);
      return rv ? { ...a, ...rv } : a;
    });
  }

  // Merge notes (keyed by fb_ad_id).
  const { data: notes } = await supabase
    .from("fb_ad_notes")
    .select("fb_ad_id, note, updated_at, author:employees!updated_by(full_name)");
  if (notes && notes.length > 0) {
    const noteMap = new Map(
      notes
        .filter((n: Record<string, unknown>) => ((n.note as string) || "").trim())
        .map((n: Record<string, unknown>) => [
          n.fb_ad_id as string,
          {
            note: n.note as string,
            note_at: n.updated_at as string | null,
            note_by_name:
              ((n.author as { full_name?: string } | null)?.full_name as string) ??
              null,
          },
        ])
    );
    ads = ads.map((a) => {
      const nt = noteMap.get(a.fb_ad_id);
      return nt ? { ...a, ...nt } : a;
    });
  }

  // Merge stars (keyed by fb_ad_id).
  const { data: stars } = await supabase
    .from("fb_ad_stars")
    .select("fb_ad_id");
  if (stars && stars.length > 0) {
    const starred = new Set(stars.map((s: { fb_ad_id: string }) => s.fb_ad_id));
    ads = ads.map((a) =>
      starred.has(a.fb_ad_id) ? { ...a, is_starred: true } : a
    );
  }

  return Response.json({ data: ads, window_days: days });
}

// Mark / unmark an ad as reviewed (admin only). Keyed by Facebook ad id.
export async function PATCH(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { id?: string; reviewed?: boolean };
  if (!body.id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }
  const supabase = await createClient();
  const reviewed = body.reviewed !== false; // default: mark reviewed

  if (reviewed) {
    const { data, error } = await supabase
      .from("fb_ad_reviews")
      .upsert(
        {
          fb_ad_id: body.id,
          reviewed_at: new Date().toISOString(),
          reviewed_by: employee.id,
        },
        { onConflict: "fb_ad_id" }
      )
      .select("fb_ad_id, reviewed_at, reviewed_by")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      data: {
        id: data.fb_ad_id,
        reviewed_at: data.reviewed_at,
        reviewed_by: data.reviewed_by,
        reviewed_by_name: employee.full_name,
      },
    });
  }

  const { error } = await supabase
    .from("fb_ad_reviews")
    .delete()
    .eq("fb_ad_id", body.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({
    data: { id: body.id, reviewed_at: null, reviewed_by: null, reviewed_by_name: null },
  });
}
