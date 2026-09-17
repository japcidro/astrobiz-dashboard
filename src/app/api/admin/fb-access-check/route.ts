import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { canMintPageToken, fetchAllFbPages } from "@/lib/facebook/pages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Scopes the dashboard actually depends on, and what breaks without each.
const REQUIRED_SCOPES: { scope: string; needed_for: string }[] = [
  { scope: "ads_read", needed_for: "Ad Performance figures" },
  { scope: "ads_management", needed_for: "Creating and pausing ads" },
  { scope: "pages_show_list", needed_for: "Listing Pages in Create Ad" },
  { scope: "pages_read_engagement", needed_for: "Playing ad videos" },
  { scope: "business_management", needed_for: "Seeing Pages owned by the business" },
];

export interface FbPageAccess {
  id: string;
  name: string;
  sources: string[];
  /** A Page token is what Graph demands before it will hand over an MP4. */
  can_play_video: boolean;
  reason: string | null;
}

export interface FbAccessReport {
  token_valid: boolean;
  token_type: string | null;
  app_name: string | null;
  expires_at: string | null;
  scopes: string[];
  missing_scopes: { scope: string; needed_for: string }[];
  businesses: { id: string; name: string }[];
  ad_accounts: { id: string; name: string }[];
  pages: FbPageAccess[];
  page_warnings: string[];
  /** Plain-language conclusions, most actionable first. */
  findings: string[];
}

async function graphGet<T>(path: string, token: string): Promise<T | null> {
  try {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(
      `${FB_API_BASE}${path}${sep}access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * One-shot answer to "what can the connected Facebook token actually reach?"
 *
 * Written because two very different symptoms — a Page missing from Create Ad,
 * and an ad video that won't play — usually share one cause: the token's user
 * has no role on that brand's Page. Neither screen could say so on its own.
 */
export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured. Add one in Settings." },
      { status: 400 }
    );
  }
  const token = tokenSetting.value as string;

  const debug = await graphGet<{
    data?: {
      is_valid?: boolean;
      type?: string;
      application?: string;
      expires_at?: number;
      scopes?: string[];
    };
  }>(`/debug_token?input_token=${encodeURIComponent(token)}`, token);

  const info = debug?.data;
  const scopes = info?.scopes ?? [];
  const missing = REQUIRED_SCOPES.filter((r) => !scopes.includes(r.scope));

  const [businessesRes, accountsRes, pageLookup] = await Promise.all([
    graphGet<{ data?: { id: string; name: string }[] }>(
      "/me/businesses?fields=id,name&limit=100",
      token
    ),
    graphGet<{ data?: { id: string; name: string }[] }>(
      "/me/adaccounts?fields=id,name&limit=100",
      token
    ),
    fetchAllFbPages(token),
  ]);

  // The Page-token probe is the real test, so run it for every Page — but in
  // parallel, since it is one cheap call each.
  const pages: FbPageAccess[] = await Promise.all(
    pageLookup.pages.map(async (p) => {
      const { ok, reason } = await canMintPageToken(p.id, token);
      return {
        id: p.id,
        name: p.name,
        sources: p.sources,
        can_play_video: ok,
        reason,
      };
    })
  );

  const findings: string[] = [];

  if (info?.is_valid === false) {
    findings.push(
      "The token is no longer valid. Reconnect it in Settings → Facebook Ads."
    );
  }
  for (const m of missing) {
    findings.push(
      `Scope "${m.scope}" is missing — ${m.needed_for} will not work.`
    );
  }

  const noVideo = pages.filter((p) => !p.can_play_video);
  if (noVideo.length > 0) {
    findings.push(
      `${noVideo.length} Page${noVideo.length === 1 ? "" : "s"} cannot produce a Page token, so ad videos on ${noVideo.length === 1 ? "it" : "them"} will not play: ${noVideo
        .map((p) => p.name)
        .join(", ")}. Give the token's Facebook user a role on ${noVideo.length === 1 ? "that Page" : "those Pages"} in Business Settings → Pages → Add People.`
    );
  }

  const onlyBusinessEdge = pages.filter(
    (p) => !p.sources.includes("/me/accounts")
  );
  if (onlyBusinessEdge.length > 0) {
    findings.push(
      `${onlyBusinessEdge.map((p) => p.name).join(", ")} ${onlyBusinessEdge.length === 1 ? "is" : "are"} visible only through the business, not through the token user's own Page roles. ${onlyBusinessEdge.length === 1 ? "It" : "They"} will list in Create Ad, but give the user a direct Page role if video or publishing misbehaves.`
    );
  }

  if (findings.length === 0) {
    findings.push(
      "No problems found — every Page the token can see can also produce a Page token."
    );
  }

  const report: FbAccessReport = {
    token_valid: info?.is_valid ?? false,
    token_type: info?.type ?? null,
    app_name: info?.application ?? null,
    expires_at:
      info?.expires_at && info.expires_at > 0
        ? new Date(info.expires_at * 1000).toISOString()
        : null,
    scopes,
    missing_scopes: missing,
    businesses: businessesRes?.data ?? [],
    ad_accounts: accountsRes?.data ?? [],
    pages,
    page_warnings: pageLookup.warnings,
    findings,
  };

  return Response.json({ data: report });
}
