import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fbPost, fbGet } from "@/lib/fb-ads-module/fb-api";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Mint an image hash for a specific ad account by re-uploading the safe
// image's bytes (FB image hashes are per-account). We fetch the stored
// CDN url and POST the bytes via multipart — the by-URL upload form
// (url=) is blocked for this app ("(#3) Application does not have the
// capability"), so multipart is the only reliable path.
async function mintImageHash(
  accountId: string,
  token: string,
  sourceUrl: string
): Promise<string> {
  const imgRes = await fetch(sourceUrl);
  if (!imgRes.ok) throw new Error(`couldn't fetch safe image (${imgRes.status})`);
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const bytes = await imgRes.arrayBuffer();

  const form = new FormData();
  form.append("access_token", token);
  form.append("filename", new Blob([bytes], { type: contentType }), "safe-image");

  const res = await fetch(`${FB_API_BASE}/${accountId}/adimages`, {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as {
    images?: Record<string, { hash: string }>;
    error?: { message?: string };
  };
  if (!res.ok || !json.images) {
    throw new Error(json.error?.message || `FB image upload failed (${res.status})`);
  }
  const first = Object.values(json.images)[0];
  return first.hash;
}
// A single fix does: read creative → (maybe upload image) → create
// creative → swap + re-review → adjust ad set. Allow headroom.
export const maxDuration = 120;

interface ObjectStorySpec {
  page_id?: string;
  link_data?: {
    link?: string;
    call_to_action?: { value?: { link?: string } };
  };
  video_data?: {
    call_to_action?: { value?: { link?: string } };
  };
}

interface AdCreativeResp {
  id?: string;
  adset_id?: string;
  creative?: { id?: string; object_story_spec?: ObjectStorySpec };
}

interface SafeImageRow {
  id: string;
  source_url: string;
  account_hashes: Record<string, string>;
}

// POST /api/facebook/fix-rejection
//
// Option A "cat method": swap a DISAPPROVED ad's creative for a benign
// safe image + chosen copy, set the SAME ad back to ACTIVE so Meta
// re-reviews it (clearing the active rejection), then run a cheap
// ₱50/2-day engagement burst on its existing ad set. Same ad ID — no
// new campaign. One ad per call; the page loops for bulk so each ad
// gets its own result.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ad_id?: string;
    ad_account_id?: string;
    safe_image_id?: string;
    headline?: string;
    primary_text?: string;
    description?: string;
    cta?: string;
    engagement_budget?: number; // PHP/day, default 50
    engagement_days?: number; // default 2
  };

  const adId = body.ad_id?.trim();
  const adAccountId = body.ad_account_id?.trim();
  if (!adId || !adAccountId) {
    return Response.json(
      { error: "ad_id and ad_account_id are required" },
      { status: 400 }
    );
  }
  if (!body.safe_image_id) {
    return Response.json({ error: "safe_image_id is required" }, { status: 400 });
  }
  const headline = (body.headline ?? "").trim();
  if (!headline) {
    return Response.json({ error: "headline is required" }, { status: 400 });
  }
  const primaryText = (body.primary_text ?? "").trim();
  const description = (body.description ?? "").trim();
  const cta = (body.cta ?? "LEARN_MORE").trim();
  const engagementBudget =
    body.engagement_budget && body.engagement_budget > 0
      ? body.engagement_budget
      : 50;
  const engagementDays =
    body.engagement_days && body.engagement_days > 0 ? body.engagement_days : 2;

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }
  const token = tokenSetting.value as string;
  const actorId = employee.id;

  const warnings: string[] = [];

  // Records the attempt regardless of outcome so the CEO has a trail.
  async function logAction(fields: {
    status: string;
    old_creative_id?: string | null;
    new_creative_id?: string | null;
    adset_id?: string | null;
    engagement_applied?: boolean;
    error_message?: string | null;
  }) {
    await supabase.from("fix_rejection_actions").insert({
      ad_id: adId,
      ad_account_id: adAccountId,
      adset_id: fields.adset_id ?? null,
      old_creative_id: fields.old_creative_id ?? null,
      new_creative_id: fields.new_creative_id ?? null,
      safe_image_id: body.safe_image_id,
      headline,
      primary_text: primaryText,
      description,
      cta,
      engagement_budget: engagementBudget,
      engagement_days: engagementDays,
      engagement_applied: fields.engagement_applied ?? false,
      status: fields.status,
      error_message: fields.error_message ?? null,
      actor_id: actorId,
    });
  }

  // 1. Read the rejected ad's current creative — we reuse its page_id +
  //    landing link so the cat creative posts from the same page/URL.
  let oldCreativeId: string | null = null;
  let pageId: string | undefined;
  let link: string | undefined;
  let adsetId: string | undefined;
  try {
    const ad = (await fbGet(`/${adId}`, token, {
      fields:
        "adset_id,creative{id,object_story_spec}",
    })) as AdCreativeResp;
    oldCreativeId = ad.creative?.id ?? null;
    adsetId = ad.adset_id;
    const oss = ad.creative?.object_story_spec;
    pageId = oss?.page_id;
    link =
      oss?.link_data?.link ||
      oss?.link_data?.call_to_action?.value?.link ||
      oss?.video_data?.call_to_action?.value?.link;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed to read ad creative";
    await logAction({ status: "failed", error_message: msg });
    return Response.json({ error: `Couldn't read the ad: ${msg}` }, { status: 502 });
  }

  // 1b. Fall back to the store's saved defaults for any missing page/link.
  if (!pageId || !link) {
    const { data: def } = await supabase
      .from("store_ad_defaults")
      .select("page_id, website_url, default_cta")
      .eq("ad_account_id", adAccountId)
      .maybeSingle();
    if (!pageId) pageId = def?.page_id ?? undefined;
    if (!link) link = def?.website_url ?? undefined;
  }
  if (!pageId) {
    const msg =
      "No page_id found on the ad or in this account's store defaults. Set a default Page for this ad account in Marketing settings first.";
    await logAction({ status: "failed", old_creative_id: oldCreativeId, adset_id: adsetId, error_message: msg });
    return Response.json({ error: msg }, { status: 400 });
  }
  if (!link) {
    const msg =
      "No landing URL found on the ad or in this account's store defaults. Set a default Website URL for this ad account first.";
    await logAction({ status: "failed", old_creative_id: oldCreativeId, adset_id: adsetId, error_message: msg });
    return Response.json({ error: msg }, { status: 400 });
  }

  // 2. Resolve the safe image's hash for THIS ad account (mint + cache on
  //    first use — FB image hashes are per-account).
  const { data: safeImage } = await supabase
    .from("fix_rejection_safe_images")
    .select("id, source_url, account_hashes")
    .eq("id", body.safe_image_id)
    .eq("active", true)
    .maybeSingle<SafeImageRow>();
  if (!safeImage) {
    return Response.json({ error: "Safe image not found" }, { status: 404 });
  }

  let imageHash = safeImage.account_hashes?.[adAccountId];
  if (!imageHash) {
    try {
      imageHash = await mintImageHash(adAccountId, token, safeImage.source_url);
      await supabase
        .from("fix_rejection_safe_images")
        .update({
          account_hashes: { ...safeImage.account_hashes, [adAccountId]: imageHash },
        })
        .eq("id", safeImage.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "image upload failed";
      await logAction({ status: "failed", old_creative_id: oldCreativeId, adset_id: adsetId, error_message: msg });
      return Response.json(
        { error: `Couldn't load the safe image into this account: ${msg}` },
        { status: 502 }
      );
    }
  }

  // 3. Create the replacement creative (static image) on the account.
  const objectStorySpec = {
    page_id: pageId,
    link_data: {
      link,
      message: primaryText,
      name: headline,
      description,
      call_to_action: { type: cta, value: { link } },
      image_hash: imageHash,
    },
  };
  let newCreativeId: string;
  try {
    const created = await fbPost(`/${adAccountId}/adcreatives`, token, {
      name: `Fix Rejection - ${headline}`.slice(0, 100),
      object_story_spec: JSON.stringify(objectStorySpec),
    });
    newCreativeId = created.id as string;
  } catch (e) {
    let msg = e instanceof Error ? e.message : "creative creation failed";
    // Most common failure: the FB token/system user can't post as this
    // ad's Page. Point the user at the real fix (Business Manager) rather
    // than leaving them staring at a raw Graph error.
    if (/permission to access this profile|does not have permission/i.test(msg)) {
      msg = `This ad's Facebook Page isn't assigned to the system-user token, so we can't post the new creative from it. Assign the Page to the system user in Business Manager (Business Settings → Pages → Assign), then retry. (${msg})`;
    }
    await logAction({ status: "failed", old_creative_id: oldCreativeId, adset_id: adsetId, error_message: msg });
    return Response.json({ error: `Couldn't build the new creative: ${msg}` }, { status: 502 });
  }

  // 4. Swap the creative on the SAME ad + set ACTIVE → triggers re-review.
  //    Option A: no auto-duplicate fallback. If Meta won't update the
  //    creative in place we surface the error so the rejection state is
  //    never silently misreported as cleared.
  try {
    await fbPost(`/${adId}`, token, {
      creative: JSON.stringify({ creative_id: newCreativeId }),
      status: "ACTIVE",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "creative swap failed";
    await logAction({
      status: "failed",
      old_creative_id: oldCreativeId,
      new_creative_id: newCreativeId,
      adset_id: adsetId,
      error_message: msg,
    });
    return Response.json(
      {
        error: `Meta wouldn't swap the creative in place: ${msg}`,
        new_creative_id: newCreativeId,
      },
      { status: 502 }
    );
  }

  // 5. ₱50/2-day engagement burst on the existing ad set (best-effort).
  //    Fails harmlessly if the ad set is under a CBO campaign (budget
  //    lives at campaign level) — the rejection is already cleared.
  let engagementApplied = false;
  if (adsetId) {
    const endTime = Math.floor(Date.now() / 1000) + engagementDays * 86400;
    try {
      await fbPost(`/${adsetId}`, token, {
        daily_budget: Math.round(engagementBudget * 100).toString(),
        end_time: endTime.toString(),
        status: "ACTIVE",
      });
      engagementApplied = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ad set update failed";
      warnings.push(
        `Creative swapped, but the ₱${engagementBudget}/${engagementDays}-day burst couldn't be set on the ad set (${msg}). Set it manually in Ads Manager.`
      );
    }
  } else {
    warnings.push("Couldn't find the ad set, so the engagement burst was skipped.");
  }

  await logAction({
    status: engagementApplied ? "success" : "partial",
    old_creative_id: oldCreativeId,
    new_creative_id: newCreativeId,
    adset_id: adsetId,
    engagement_applied: engagementApplied,
    error_message: warnings.length ? warnings.join(" ") : null,
  });

  return Response.json({
    success: true,
    ad_id: adId,
    new_creative_id: newCreativeId,
    engagement_applied: engagementApplied,
    warnings,
  });
}
