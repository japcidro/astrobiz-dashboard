import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// FB Graph shapes — only the bits we use are typed strictly.
interface AdReviewFeedbackResp {
  global?: Record<string, string>;
  placement_specific?: Record<string, Record<string, string>>;
}

interface IssueInfo {
  error_code?: number;
  error_message?: string;
  error_summary?: string;
  level?: string;
  error_type?: string;
}

interface AdReviewResponse {
  id?: string;
  effective_status?: string;
  ad_review_feedback?: AdReviewFeedbackResp;
  issues_info?: IssueInfo[];
  error?: { message?: string; code?: number };
}

// GET /api/facebook/ad-review-feedback?ad_id=ABC
//
// Returns FB's structured ad-review feedback + issues_info for one
// ad. Used by the Ads page "Why?" link next to a DISAPPROVED status,
// so the user can see the exact policy violation without bouncing to
// Ads Manager. Returns a clean { global, placement_specific, issues }
// payload — the UI renders whichever sections are non-empty.
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

  const params = new URLSearchParams({
    access_token: token,
    fields: "effective_status,ad_review_feedback,issues_info",
  });

  let json: AdReviewResponse;
  try {
    const res = await fetch(
      `${FB_API_BASE}/${encodeURIComponent(adId)}?${params}`,
      { cache: "no-store" }
    );
    json = (await res.json()) as AdReviewResponse;
    if (!res.ok) {
      return Response.json(
        {
          error:
            json.error?.message ||
            `FB returned ${res.status} fetching review feedback`,
        },
        { status: 502 }
      );
    }
  } catch (err) {
    return Response.json(
      {
        error: `FB fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  // Flatten ad_review_feedback into a single list of { scope, policy,
  // description } entries — easier for the UI to render than the
  // nested global / placement_specific shape FB returns.
  const policies: Array<{
    scope: string;
    policy: string;
    description: string;
  }> = [];
  const arf = json.ad_review_feedback;
  if (arf?.global) {
    for (const [policy, description] of Object.entries(arf.global)) {
      policies.push({ scope: "global", policy, description });
    }
  }
  if (arf?.placement_specific) {
    for (const [placement, byPolicy] of Object.entries(arf.placement_specific)) {
      for (const [policy, description] of Object.entries(byPolicy)) {
        policies.push({ scope: placement, policy, description });
      }
    }
  }

  return Response.json({
    ad_id: adId,
    effective_status: json.effective_status ?? null,
    policies,
    issues:
      (json.issues_info ?? []).map((i) => ({
        level: i.level ?? null,
        type: i.error_type ?? null,
        summary: i.error_summary ?? null,
        message: i.error_message ?? null,
        code: i.error_code ?? null,
      })),
  });
}
