import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// FB ad-format strings ranked from most-preferred (full mobile feed) down
// to fallbacks. Some ads only expose certain formats (DPA, Reels, IG-only),
// so we try a few in order and use the first one FB returns a body for.
const FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "FACEBOOK_STORY_MOBILE",
] as const;

// Extracts the src attribute from FB's preview iframe HTML response.
// FB returns: { data: [{ body: "<iframe src='...'>...</iframe>" }] }
function extractIframeSrc(body: string): string | null {
  const m = body.match(/src=["']([^"']+)["']/);
  if (!m) return null;
  // FB HTML-encodes &amp; in the URL — decode so the URL works as a real link.
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

// GET /api/facebook/ad-preview?ad_id=ABC123
//
// Returns the FB-rendered preview iframe URL for one ad. This works
// even when the ad has no public page post (effective_object_story_id
// missing) — i.e. exactly the case where the View link was falling
// back to Ads Manager. Used by the Ads page View button to open the
// actual creative in a new tab instead of Ads Manager.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const adId = new URL(request.url).searchParams.get("ad_id");
  if (!adId) {
    return Response.json({ error: "ad_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const token = tokenRow?.value as string | undefined;
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  // Try formats in order. Bail at the first one that returns a usable
  // iframe src.
  for (const format of FORMATS) {
    const params = new URLSearchParams({
      access_token: token,
      ad_format: format,
    });
    try {
      const res = await fetch(
        `${FB_API_BASE}/${encodeURIComponent(adId)}/previews?${params}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<{ body?: string }>;
      };
      const body = json.data?.[0]?.body;
      if (!body) continue;
      const src = extractIframeSrc(body);
      if (src) {
        return Response.json({ url: src, format });
      }
    } catch {
      // try next format
    }
  }

  return Response.json(
    {
      error:
        "FB returned no preview for this ad in any supported format. The ad may be deleted or your token lacks ads_read on its account.",
    },
    { status: 404 }
  );
}
