import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const DAY = 86400;

// Custom (warm) audiences of an ad account: list them, or create one of the
// four kinds a retargeting ad set needs. Rule shapes follow Meta's audience
// guides: pixel rules carry inclusions/event_sources/retention_seconds, a
// Page rule uses the page as event source with the page_engaged event, and
// a video rule is a list of {object_id, event_name}. Only the video kind
// sends subtype (ENGAGEMENT); the others are inferred from the rule.
export type AudienceKind =
  | "website_visitors"
  | "website_event"
  | "page_engaged"
  | "video_viewers";

const MAX_DAYS: Record<AudienceKind, number> = {
  website_visitors: 180,
  website_event: 180,
  page_engaged: 730,
  video_viewers: 365,
};

async function tokenOrError(): Promise<{ token: string } | { error: Response }> {
  const employee = await getEmployee();
  if (!employee) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return { error: Response.json({ error: "Token not configured" }, { status: 400 }) };
  }
  return { token: tokenSetting.value as string };
}

export interface AudienceRow {
  id: string;
  name: string;
  subtype: string | null;
  approximate_count_lower_bound: number | null;
  approximate_count_upper_bound: number | null;
  delivery_status: string | null;
  time_created: string | null;
}

export async function GET(request: Request) {
  const auth = await tokenOrError();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  if (!accountId) {
    return Response.json({ error: "Missing account_id" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      access_token: auth.token,
      fields:
        "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,time_created",
      limit: "200",
    });
    type Page = {
      data?: Array<Record<string, unknown>>;
      paging?: { next?: string };
      error?: { message?: string };
    };
    const rows: AudienceRow[] = [];
    let url: string | null = `${FB_API_BASE}/${accountId}/customaudiences?${params}`;
    while (url) {
      const res: Response = await fetch(url, { cache: "no-store" });
      const json: Page = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || `FB API error: ${res.status}`);
      }
      for (const raw of json.data || []) {
        const a = raw as {
          id: string;
          name: string;
          subtype?: string;
          approximate_count_lower_bound?: number;
          approximate_count_upper_bound?: number;
          delivery_status?: { code?: number };
          time_created?: string;
        };
        rows.push({
          id: a.id,
          name: a.name,
          subtype: a.subtype ?? null,
          approximate_count_lower_bound: a.approximate_count_lower_bound ?? null,
          approximate_count_upper_bound: a.approximate_count_upper_bound ?? null,
          delivery_status: a.delivery_status?.code != null ? String(a.delivery_status.code) : null,
          time_created: a.time_created ?? null,
        });
      }
      url = json.paging?.next ?? null;
    }
    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return Response.json({ data: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list audiences";
    return Response.json({ error: message }, { status: 500 });
  }
}

interface CreateBody {
  ad_account_id: string;
  name: string;
  kind: AudienceKind;
  days: number;
  pixel_id?: string;
  event?: string; // website_event: a pixel event name such as Purchase
  page_id?: string; // page_engaged
  video_ids?: string[]; // video_viewers
  video_event?: string; // video_viewers: video_view_50_percent by default
}

function buildParams(b: CreateBody): Record<string, string> {
  const days = Math.max(1, Math.min(MAX_DAYS[b.kind], Math.round(b.days || 1)));
  const base: Record<string, string> = { name: b.name.trim(), prefill: "1" };

  if (b.kind === "website_visitors" || b.kind === "website_event") {
    if (!b.pixel_id) throw new Error("A pixel is required for a website audience");
    const filters =
      b.kind === "website_visitors"
        ? [{ field: "url", operator: "i_contains", value: "" }]
        : [{ field: "event", operator: "eq", value: (b.event || "").trim() }];
    if (b.kind === "website_event" && !filters[0].value) {
      throw new Error("An event name (for example Purchase) is required");
    }
    // No subtype here: Facebook rejects it for pixel-rule audiences ("not
    // supported in the current API version", code 2654) and infers WEBSITE.
    return {
      ...base,
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: b.pixel_id, type: "pixel" }],
              retention_seconds: days * DAY,
              filter: { operator: "and", filters },
            },
          ],
        },
      }),
    };
  }

  if (b.kind === "page_engaged") {
    if (!b.page_id) throw new Error("A Facebook Page is required for a page audience");
    return {
      ...base,
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: b.page_id, type: "page" }],
              retention_seconds: days * DAY,
              filter: {
                operator: "and",
                filters: [{ field: "event", operator: "eq", value: "page_engaged" }],
              },
            },
          ],
        },
      }),
    };
  }

  // video_viewers
  const ids = (b.video_ids || []).map((v) => String(v).trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("At least one video ID is required");
  const event = (b.video_event || "video_view_50_percent").trim();
  return {
    ...base,
    subtype: "ENGAGEMENT",
    retention_days: String(days),
    rule: JSON.stringify(ids.map((id) => ({ object_id: id, event_name: event }))),
  };
}

export async function POST(request: Request) {
  const auth = await tokenOrError();
  if ("error" in auth) return auth.error;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.ad_account_id || !body.name?.trim() || !body.kind || !(body.kind in MAX_DAYS)) {
    return Response.json({ error: "Missing ad_account_id, name or kind" }, { status: 400 });
  }

  try {
    const params = buildParams(body);
    const res = await fetch(`${FB_API_BASE}/${body.ad_account_id}/customaudiences`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: auth.token, ...params }).toString(),
      cache: "no-store",
    });
    const json = await res.json();
    if (!res.ok) {
      const err = json.error || {};
      const msg = err.error_user_msg || err.message || `FB API error: ${res.status}`;
      throw new Error(`${msg} [code ${err.code}${err.error_subcode ? `, subcode ${err.error_subcode}` : ""}]`);
    }
    return Response.json({ id: json.id as string, name: params.name, kind: body.kind });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create audience";
    return Response.json({ error: message }, { status: 500 });
  }
}
