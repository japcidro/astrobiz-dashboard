import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";
// Meta's /copies call can take a few seconds. Bump from default.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface PromoteBody {
  ad_id?: string;
  target_store?: string;
  // Mode 1: put the ad in an existing adset.
  target_adset_id?: string;
  // Mode 2: first create a new adset by cloning a template inside the
  //         scaling campaign, then put the ad in that new adset.
  new_adset?: {
    template_adset_id: string;
    name: string;
  };
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
  let targetAdsetId = (body.target_adset_id ?? "").trim();
  const newAdsetReq = body.new_adset;
  const statusOption =
    body.status_option === "ACTIVE" ? "ACTIVE" : "PAUSED";

  if (!adId || !targetStore) {
    return Response.json(
      { error: "ad_id and target_store are required" },
      { status: 400 }
    );
  }
  if (!targetAdsetId && !newAdsetReq) {
    return Response.json(
      {
        error:
          "Either target_adset_id or new_adset (template + name) is required",
      },
      { status: 400 }
    );
  }
  if (
    newAdsetReq &&
    (!newAdsetReq.template_adset_id || !newAdsetReq.name?.trim())
  ) {
    return Response.json(
      {
        error: "new_adset.template_adset_id and new_adset.name are required",
      },
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

  // If creating a new adset: clone a template (inside the same scaling
  // campaign), rename it, and use its id as the target. Template must
  // belong to the configured scaling campaign for safety.
  let createdAdsetId: string | null = null;
  if (newAdsetReq) {
    const templateId = newAdsetReq.template_adset_id;
    const newName = newAdsetReq.name.trim();

    // Verify template is inside the scaling campaign.
    try {
      const verifyRes = await fetch(
        `${FB_API_BASE}/${templateId}?fields=campaign_id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(
          verifyJson?.error?.message ?? "template lookup failed"
        );
      }
      if (verifyJson.campaign_id !== scalingRow.campaign_id) {
        return Response.json(
          {
            error: `Template adset is not inside the scaling campaign for "${targetStore}".`,
          },
          { status: 400 }
        );
      }
    } catch (err) {
      return Response.json(
        {
          error: `Could not verify template adset: ${err instanceof Error ? err.message : "unknown"}`,
        },
        { status: 502 }
      );
    }

    // Clone the template. deep_copy=false keeps it at the adset level
    // and does not deep-copy the creative — we only want the targeting
    // and budget scaffolding.
    try {
      const copyParams = new URLSearchParams({
        deep_copy: "false",
        status_option: "PAUSED",
      });
      const copyRes = await fetch(
        `${FB_API_BASE}/${templateId}/copies?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: copyParams.toString(),
        }
      );
      const copyJson = await copyRes.json();
      if (!copyRes.ok) {
        const msg =
          copyJson?.error?.message ??
          copyJson?.error_user_msg ??
          `FB adset /copies ${copyRes.status}`;
        return Response.json(
          { error: `Adset clone failed: ${msg}` },
          { status: 502 }
        );
      }
      createdAdsetId = (copyJson?.copied_adset_id ?? null) as string | null;
      if (!createdAdsetId) {
        return Response.json(
          { error: "Adset clone returned no id" },
          { status: 502 }
        );
      }
    } catch (err) {
      return Response.json(
        {
          error: `Adset clone failed: ${err instanceof Error ? err.message : "unknown"}`,
        },
        { status: 502 }
      );
    }

    // Rename the new adset.
    try {
      const renameParams = new URLSearchParams({ name: newName });
      const renameRes = await fetch(
        `${FB_API_BASE}/${createdAdsetId}?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: renameParams.toString(),
        }
      );
      if (!renameRes.ok) {
        const renameJson = await renameRes.json().catch(() => ({}));
        console.warn(
          `[scaling/promote] rename failed for ${createdAdsetId}:`,
          renameJson?.error?.message ?? renameRes.status
        );
        // Non-fatal: the adset still exists with the default name.
      }
    } catch {
      // Non-fatal, continue.
    }

    targetAdsetId = createdAdsetId;
  } else {
    // Safety: verify the existing target adset belongs to this store's
    // scaling campaign. Prevents dropping the ad anywhere arbitrary.
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
      // Surface the full FB error blob to the server log so we can debug
      // capability/permission issues without guessing. fbtrace_id is the
      // identifier Meta support asks for if you escalate to them.
      console.error("[scaling/promote] FB /copies failed", {
        ad_id: adId,
        target_adset_id: targetAdsetId,
        target_store: targetStore,
        http_status: copyRes.status,
        fb_error: copyJson?.error,
      });
      return Response.json(
        {
          error: userTitle ? `${userTitle}: ${msg}` : msg,
          fb_code: copyJson?.error?.code,
          fb_subcode: copyJson?.error?.error_subcode,
          fb_user_msg: copyJson?.error?.error_user_msg,
          fb_trace: copyJson?.error?.fbtrace_id,
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
    `[scaling/promote] employee=${employee.id} ad=${adId} → adset=${targetAdsetId} (store=${targetStore}) copied_ad=${copiedAdId} status=${statusOption} new_adset=${createdAdsetId ?? "no"}`
  );

  return Response.json({
    success: true,
    copied_ad_id: copiedAdId,
    status: statusOption,
    target_adset_id: targetAdsetId,
    created_adset_id: createdAdsetId,
    target_campaign_id: scalingRow.campaign_id,
    target_campaign_name: scalingRow.campaign_name,
  });
}
