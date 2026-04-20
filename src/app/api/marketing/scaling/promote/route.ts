import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";
// Meta's /copies call can take a few seconds. Bump from default.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface PromoteBody {
  ad_id?: string;
  target_store?: string;
  target_adset_id?: string;
  status_option?: "PAUSED" | "ACTIVE";
  // Optional name override; if omitted FB defaults to "Copy of {ad_name}".
  name_suffix?: string | null;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as PromoteBody;
  const adId = (body.ad_id ?? "").trim();
  const targetStore = (body.target_store ?? "").trim();
  const targetAdsetId = (body.target_adset_id ?? "").trim();
  const statusOption =
    body.status_option === "ACTIVE" ? "ACTIVE" : "PAUSED";

  if (!adId || !targetStore || !targetAdsetId) {
    return Response.json(
      { error: "ad_id, target_store, target_adset_id are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Look up FB token + the store's configured scaling campaign.
  const [{ data: tokenRow }, { data: scalingRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    supabase
      .from("store_scaling_campaigns")
      .select("*")
      .eq("store_name", targetStore)
      .maybeSingle(),
  ]);

  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }
  if (!scalingRow) {
    return Response.json(
      {
        error: `No scaling campaign mapped for store "${targetStore}". Set it in Admin → Settings.`,
      },
      { status: 400 }
    );
  }

  // Safety: verify the target adset actually belongs to this store's
  // scaling campaign. Prevents a malformed request from dropping the ad
  // into an arbitrary adset on any account the token touches.
  try {
    const verifyRes = await fetch(
      `${FB_API_BASE}/${targetAdsetId}?fields=campaign_id&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const verifyJson = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(verifyJson?.error?.message ?? "adset lookup failed");
    }
    if (verifyJson.campaign_id !== scalingRow.campaign_id) {
      return Response.json(
        {
          error: `Target adset is not inside the scaling campaign for "${targetStore}". Expected campaign ${scalingRow.campaign_id}, got ${verifyJson.campaign_id}.`,
        },
        { status: 400 }
      );
    }
  } catch (err) {
    return Response.json(
      {
        error: `Could not verify target adset: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  // Fire the Meta copy. Uses application/x-www-form-urlencoded for the
  // body because /copies is finicky about JSON in some versions.
  const params = new URLSearchParams({
    adset_id: targetAdsetId,
    status_option: statusOption,
  });
  if (body.name_suffix && body.name_suffix.trim()) {
    params.set("rename_options", JSON.stringify({
      rename_suffix: body.name_suffix.trim(),
    }));
  }

  let copiedAdId: string | null = null;
  try {
    const copyRes = await fetch(
      `${FB_API_BASE}/${adId}/copies?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    const copyJson = await copyRes.json();
    if (!copyRes.ok) {
      const msg =
        copyJson?.error?.message ??
        copyJson?.error_user_msg ??
        `FB /copies ${copyRes.status}`;
      const userTitle = copyJson?.error?.error_user_title;
      return Response.json(
        {
          error: userTitle ? `${userTitle}: ${msg}` : msg,
          fb_code: copyJson?.error?.code,
          fb_subcode: copyJson?.error?.error_subcode,
        },
        { status: 502 }
      );
    }
    copiedAdId = (copyJson?.copied_ad_id ?? copyJson?.ad_id ?? null) as
      | string
      | null;
  } catch (err) {
    return Response.json(
      {
        error: `Promote call failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  console.info(
    `[scaling/promote] employee=${employee.id} ad=${adId} → adset=${targetAdsetId} (store=${targetStore}) copied_ad=${copiedAdId} status=${statusOption}`
  );

  return Response.json({
    success: true,
    copied_ad_id: copiedAdId,
    status: statusOption,
    target_adset_id: targetAdsetId,
    target_campaign_id: scalingRow.campaign_id,
    target_campaign_name: scalingRow.campaign_name,
  });
}
