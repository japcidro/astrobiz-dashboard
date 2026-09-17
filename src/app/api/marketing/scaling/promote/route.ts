import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
// Meta's /copies call can take a few seconds. Bump from default.
export const maxDuration = 60;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Mark the source ad as scaled in scaling_detection_cache so the "↑ SCALED"
// badge appears immediately. Without this, the badge waits up to 30 min for
// the next /api/cron/refresh-scaling-detection tick — which led to users
// double-promoting because the UI looked unchanged after a successful copy.
//
// Best-effort: swallows all errors. The cron will fill in any missing
// creative_id/campaign_id on its next run.
async function markSourceAdScaledInCache(
  supabase: SupabaseClient,
  args: {
    sourceAdId: string;
    sourceAccountId: string | null;
    copiedAdId: string | null;
    scalingCampaignId: string;
    scalingStoreName: string;
  }
): Promise<void> {
  try {
    const now = new Date().toISOString();

    // Update first to preserve creative_id/campaign_id from prior cron runs
    // (those columns drive scaling-campaign matching — wiping them would
    // break the next cron tick's rollup detection for this ad).
    const { data: existing } = await supabase
      .from("scaling_detection_cache")
      .select("fb_ad_id")
      .eq("fb_ad_id", args.sourceAdId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("scaling_detection_cache")
        .update({
          in_scaling: true,
          scaled_ad_id: args.copiedAdId,
          scaled_in_campaign: args.scalingCampaignId,
          scaled_in_store: args.scalingStoreName,
          refreshed_at: now,
        })
        .eq("fb_ad_id", args.sourceAdId);
    } else {
      await supabase.from("scaling_detection_cache").insert({
        fb_ad_id: args.sourceAdId,
        creative_id: null,
        campaign_id: null,
        account_id: args.sourceAccountId,
        in_scaling: true,
        scaled_ad_id: args.copiedAdId,
        scaled_in_campaign: args.scalingCampaignId,
        scaled_in_store: args.scalingStoreName,
        self_is_scaling: false,
        refreshed_at: now,
      });
    }
  } catch (e) {
    console.error("[scaling/promote] cache mark failed (non-fatal)", e);
  }
}

interface PromoteBody {
  ad_id?: string;
  target_store?: string;
  // WHERE — campaign. Omit both and the ad lands in the store's configured
  // scaling campaign, which is what every caller did before this existed.
  //   target_campaign_id — any other campaign in the same ad account.
  //   new_campaign       — create one first, then land in it. Requires
  //                        new_adset: a campaign born this second has no
  //                        ad set to drop into.
  target_campaign_id?: string;
  new_campaign?: {
    name: string;
    objective?: string;
    special_ad_categories?: string[];
    // Major units (pesos). Set = campaign budget optimisation; omit and the
    // cloned ad set keeps carrying its own budget.
    daily_budget?: number | null;
  };
  // WHERE — ad set, inside whichever campaign the above resolved to.
  // Mode 1: put the ad in an existing adset.
  target_adset_id?: string;
  // Mode 2: first create a new adset by cloning a template, then put the
  //         ad in that new adset.
  new_adset?: {
    template_adset_id: string;
    name: string;
  };
  status_option?: "PAUSED" | "ACTIVE";
  // Optional name override; if omitted FB defaults to "Copy of {ad_name}".
  name_suffix?: string | null;
}

const CAMPAIGN_OBJECTIVES = new Set([
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_AWARENESS",
  "OUTCOME_APP_PROMOTION",
]);

// Meta hands back ["NONE"] for a campaign with no special ad category but
// rejects that same value on create — it wants an empty array.
function cleanCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v)).filter((v) => v && v !== "NONE");
}

function normalizeAcct(v: string | null | undefined): string {
  return (v ?? "").toString().replace(/^act_/, "").trim();
}

function acctPrefix(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
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
  const requestedCampaignId = (body.target_campaign_id ?? "").trim();
  const newCampaignReq = body.new_campaign;
  let targetAdsetId = (body.target_adset_id ?? "").trim();
  const newAdsetReq = body.new_adset;
  const statusOption =
    body.status_option === "ACTIVE" ? "ACTIVE" : "PAUSED";

  if (!adId) {
    return Response.json({ error: "ad_id is required" }, { status: 400 });
  }
  // target_store is optional. It names a mapped scaling campaign to use as
  // the default destination — a store too new to have one (no row in
  // store_scaling_campaigns) can still promote, by naming a campaign in the
  // source ad's own ad account or asking for a new one. Requiring the
  // mapping was what left a brand-new store with an empty dropdown and no
  // way through the modal at all.
  if (requestedCampaignId && newCampaignReq) {
    return Response.json(
      {
        error:
          "Pass either target_campaign_id or new_campaign, not both",
      },
      { status: 400 }
    );
  }
  if (targetAdsetId && newAdsetReq) {
    return Response.json(
      { error: "Pass either target_adset_id or new_adset, not both" },
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
  if (newCampaignReq) {
    if ((newCampaignReq.name ?? "").trim().length < 3) {
      return Response.json(
        { error: "new_campaign.name must be at least 3 characters" },
        { status: 400 }
      );
    }
    if (!newAdsetReq) {
      return Response.json(
        {
          error:
            "new_campaign requires new_adset — a campaign created this second has no ad set to drop the ad into",
        },
        { status: 400 }
      );
    }
    if (
      newCampaignReq.objective &&
      !CAMPAIGN_OBJECTIVES.has(newCampaignReq.objective)
    ) {
      return Response.json(
        { error: `Unsupported objective "${newCampaignReq.objective}"` },
        { status: 400 }
      );
    }
    if (
      newCampaignReq.daily_budget != null &&
      !(Number(newCampaignReq.daily_budget) > 0)
    ) {
      return Response.json(
        { error: "new_campaign.daily_budget must be greater than 0" },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();

  // Look up FB token +, when a store was named, its configured scaling
  // campaign.
  const [{ data: tokenRow }, { data: scalingRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
    targetStore
      ? supabase
          .from("store_scaling_campaigns")
          .select("*")
          .eq("store_name", targetStore)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const token = (tokenRow?.value as string | undefined) ?? "";
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }
  if (targetStore && !scalingRow) {
    return Response.json(
      {
        error: `No scaling campaign mapped for store "${targetStore}". Set it in Admin → Settings.`,
      },
      { status: 400 }
    );
  }
  if (!scalingRow && !requestedCampaignId && !newCampaignReq) {
    return Response.json(
      {
        error:
          "No mapped scaling campaign to fall back on — name a target_campaign_id or pass new_campaign",
      },
      { status: 400 }
    );
  }

  // Meta's /copies endpoint cannot cross ad account boundaries. Verify
  // the source ad lives in the same ad account as the configured scaling
  // campaign before we even try — otherwise FB returns a confusing
  // "(#3) Application does not have the capability" error with no
  // subcode that looks like a permission problem but is actually a
  // hard API restriction.
  let sourceAccountId: string | null = null;
  try {
    const adAcctRes = await fetch(
      `${FB_API_BASE}/${adId}?fields=account_id&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const adAcctJson = await adAcctRes.json();
    if (!adAcctRes.ok) {
      throw new Error(adAcctJson?.error?.message ?? "ad lookup failed");
    }
    sourceAccountId = (adAcctJson.account_id as string | undefined) ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not verify source ad's ad account: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  // scalingRow.account_id is stored without the "act_" prefix; FB's
  // ad.account_id field returns it raw too. normalizeAcct() handles both.
  if (
    scalingRow &&
    sourceAccountId &&
    normalizeAcct(sourceAccountId) !== normalizeAcct(scalingRow.account_id)
  ) {
    return Response.json(
      {
        error:
          `Cross-account copy not supported. Source ad is in ad account ${sourceAccountId}, ` +
          `but the "${targetStore}" scaling campaign lives in ${scalingRow.account_id}. ` +
          `Meta's /copies API only works within a single ad account. ` +
          `Either move the scaling campaign into the same ad account, or recreate the ad manually in the scaling account.`,
        cross_account: true,
        source_account_id: sourceAccountId,
        target_account_id: scalingRow.account_id,
      },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------------------
  // Resolve the destination campaign.
  //
  // Default is the store's mapped scaling campaign — what this endpoint
  // always did. A caller can instead name any other campaign in the same
  // ad account, or ask for a brand-new one to be created first.
  // ---------------------------------------------------------------------
  // Meta's /copies cannot leave an ad account, so the destination account
  // is decided for us: the mapped campaign's when there is one, and
  // otherwise the source ad's own — which is the same account either way,
  // the guard above having just proved it.
  const scalingAccountId = String(
    scalingRow?.account_id ?? sourceAccountId ?? ""
  );
  if (!scalingAccountId) {
    return Response.json(
      { error: "Could not determine which ad account to copy into" },
      { status: 502 }
    );
  }
  let targetCampaignId = scalingRow ? String(scalingRow.campaign_id) : "";
  let targetCampaignName = scalingRow ? String(scalingRow.campaign_name) : "";
  let createdCampaignId: string | null = null;

  if (requestedCampaignId && requestedCampaignId !== targetCampaignId) {
    try {
      const res = await fetch(
        `${FB_API_BASE}/${requestedCampaignId}?fields=id,name,account_id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "campaign lookup failed");
      }
      if (
        normalizeAcct(json.account_id as string) !==
        normalizeAcct(scalingAccountId)
      ) {
        return Response.json(
          {
            error:
              `Target campaign ${requestedCampaignId} is in ad account ${json.account_id}, ` +
              `but the "${targetStore}" scaling campaign lives in ${scalingAccountId}. ` +
              `Meta's /copies API only works within a single ad account.`,
            cross_account: true,
          },
          { status: 400 }
        );
      }
      targetCampaignId = String(json.id);
      targetCampaignName = (json.name as string) ?? targetCampaignId;
    } catch (err) {
      return Response.json(
        {
          error: `Could not verify target campaign: ${err instanceof Error ? err.message : "unknown"}`,
        },
        { status: 502 }
      );
    }
  } else if (newCampaignReq) {
    const campaignName = newCampaignReq.name.trim();

    // Objective and special ad categories have to match what the cloned ad
    // set expects, or Meta rejects the clone. When the caller doesn't say,
    // copy them off the configured scaling campaign — the ad set almost
    // always comes from there.
    let objective = newCampaignReq.objective ?? "";
    let categories = newCampaignReq.special_ad_categories
      ? cleanCategories(newCampaignReq.special_ad_categories)
      : null;
    if (!objective || categories === null) {
      // The mapped scaling campaign is the best model when there is one.
      // With no mapping — a store whose first scaling campaign this is —
      // the source ad's own campaign is the next best: whatever the ad
      // runs under today is something the ad is compatible with.
      const modelCampaign = scalingRow
        ? `${scalingRow.campaign_id}`
        : `${adId}?fields=campaign{objective,special_ad_categories}`;
      try {
        const res = await fetch(
          scalingRow
            ? `${FB_API_BASE}/${modelCampaign}?fields=objective,special_ad_categories&access_token=${encodeURIComponent(token)}`
            : `${FB_API_BASE}/${modelCampaign}&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        const raw = await res.json();
        const json = scalingRow ? raw : (raw?.campaign ?? {});
        if (res.ok) {
          if (!objective && typeof json.objective === "string") {
            objective = json.objective;
          }
          if (categories === null) {
            categories = cleanCategories(json.special_ad_categories);
          }
        }
      } catch {
        // Defaults below cover it.
      }
    }
    if (!objective || !CAMPAIGN_OBJECTIVES.has(objective)) {
      // Graph still reports CONVERSIONS / LINK_CLICKS on older campaigns
      // and refuses to create one with them.
      objective = "OUTCOME_SALES";
    }
    if (categories === null) categories = [];

    try {
      const createParams = new URLSearchParams({
        name: campaignName,
        objective,
        // A campaign the user asked to activate is created ACTIVE; its ad
        // sets still come up PAUSED, so nothing spends before review.
        status: statusOption,
        buying_type: "AUCTION",
        special_ad_categories: JSON.stringify(categories),
      });
      if (newCampaignReq.daily_budget != null) {
        // CBO. Major units in, minor units to Meta.
        createParams.set(
          "daily_budget",
          Math.round(Number(newCampaignReq.daily_budget) * 100).toString()
        );
        createParams.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
      } else {
        createParams.set("is_adset_budget_sharing_enabled", "false");
      }

      const createRes = await fetch(
        `${FB_API_BASE}/${acctPrefix(scalingAccountId)}/campaigns?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: createParams.toString(),
        }
      );
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson?.id) {
        const msg =
          createJson?.error?.error_user_msg ??
          createJson?.error?.message ??
          `FB campaign create ${createRes.status}`;
        return Response.json(
          { error: `Campaign create failed: ${msg}` },
          { status: 502 }
        );
      }
      createdCampaignId = String(createJson.id);
      targetCampaignId = createdCampaignId;
      targetCampaignName = campaignName;
    } catch (err) {
      return Response.json(
        {
          error: `Campaign create failed: ${err instanceof Error ? err.message : "unknown"}`,
        },
        { status: 502 }
      );
    }
  }

  const intoScalingCampaign =
    !!scalingRow && targetCampaignId === String(scalingRow.campaign_id);

  // If creating a new adset: clone a template, rename it, and use its id as
  // the target. The template only has to live in the same ad account as the
  // destination — cloning across campaigns is how a brand-new campaign gets
  // its first ad set.
  let createdAdsetId: string | null = null;
  if (newAdsetReq) {
    const templateId = newAdsetReq.template_adset_id;
    const newName = newAdsetReq.name.trim();

    // Verify the template is reachable and in the right ad account.
    let templateCampaignId: string | null = null;
    try {
      const verifyRes = await fetch(
        `${FB_API_BASE}/${templateId}?fields=campaign_id,account_id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(
          verifyJson?.error?.message ?? "template lookup failed"
        );
      }
      if (
        normalizeAcct(verifyJson.account_id as string) !==
        normalizeAcct(scalingAccountId)
      ) {
        return Response.json(
          {
            error: `Template adset is in ad account ${verifyJson.account_id}, not ${scalingAccountId}. Meta cannot clone an ad set across ad accounts.`,
          },
          { status: 400 }
        );
      }
      templateCampaignId = (verifyJson.campaign_id as string) ?? null;
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
    // and budget scaffolding. campaign_id moves the copy into the
    // destination campaign when that isn't the template's own.
    try {
      const copyParams = new URLSearchParams({
        deep_copy: "false",
        status_option: "PAUSED",
      });
      if (templateCampaignId !== targetCampaignId) {
        copyParams.set("campaign_id", targetCampaignId);
      }
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
          {
            error: `Adset clone failed: ${msg}`,
            // A campaign created moments ago now has no ad set in it. Hand
            // its id back so the caller can retry into it rather than
            // creating a second empty campaign.
            created_campaign_id: createdCampaignId,
            target_campaign_id: targetCampaignId,
          },
          { status: 502 }
        );
      }
      createdAdsetId = (copyJson?.copied_adset_id ?? null) as string | null;
      if (!createdAdsetId) {
        return Response.json(
          {
            error: "Adset clone returned no id",
            created_campaign_id: createdCampaignId,
            target_campaign_id: targetCampaignId,
          },
          { status: 502 }
        );
      }
    } catch (err) {
      return Response.json(
        {
          error: `Adset clone failed: ${err instanceof Error ? err.message : "unknown"}`,
          created_campaign_id: createdCampaignId,
          target_campaign_id: targetCampaignId,
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
    // Safety: verify the existing target adset belongs to the destination
    // campaign. Prevents dropping the ad anywhere arbitrary.
    try {
      const verifyRes = await fetch(
        `${FB_API_BASE}/${targetAdsetId}?fields=campaign_id&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyJson?.error?.message ?? "adset lookup failed");
      }
      if (verifyJson.campaign_id !== targetCampaignId) {
        return Response.json(
          {
            error: `Target adset is not inside "${targetCampaignName}". Expected campaign ${targetCampaignId}, got ${verifyJson.campaign_id}.`,
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

      // Fallback path: when /copies returns code 3 ("Application does
      // not have the capability"), Meta is blocking that endpoint
      // specifically even though the token has ads_management. Bypass
      // /copies by reading the source ad's creative_id and creating a
      // fresh ad in the target adset with POST /act_{}/ads. Same end
      // result, different — and more permissive — endpoint.
      if (copyJson?.error?.code === 3 && sourceAccountId) {
        try {
          const adReadRes = await fetch(
            `${FB_API_BASE}/${adId}?fields=name,creative{id},tracking_specs&access_token=${encodeURIComponent(token)}`,
            { cache: "no-store" }
          );
          const adRead = await adReadRes.json();
          if (!adReadRes.ok) {
            throw new Error(adRead?.error?.message ?? "ad read failed");
          }
          const sourceName = (adRead?.name as string) ?? `Copy of ${adId}`;
          const creativeId = adRead?.creative?.id as string | undefined;
          if (!creativeId) {
            throw new Error("source ad has no creative id");
          }
          const finalName = body.name_suffix?.trim()
            ? `${sourceName} ${body.name_suffix.trim()}`
            : sourceName;
          const acctNoPrefix = sourceAccountId.replace(/^act_/, "");
          const createParams = new URLSearchParams({
            name: finalName,
            adset_id: targetAdsetId,
            creative: JSON.stringify({ creative_id: creativeId }),
            status: statusOption,
          });
          if (Array.isArray(adRead?.tracking_specs)) {
            createParams.set(
              "tracking_specs",
              JSON.stringify(adRead.tracking_specs)
            );
          }
          const createRes = await fetch(
            `${FB_API_BASE}/act_${acctNoPrefix}/ads?access_token=${encodeURIComponent(token)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: createParams.toString(),
            }
          );
          const createJson = await createRes.json();
          if (!createRes.ok) {
            console.error(
              "[scaling/promote] recreate fallback also failed",
              {
                copy_error: copyJson?.error,
                create_error: createJson?.error,
              }
            );
            // Fall through to the diagnostic + error response below.
          } else {
            copiedAdId = (createJson?.id as string | null) ?? null;
            console.info(
              `[scaling/promote] recreate fallback succeeded: source=${adId} new_ad=${copiedAdId}`
            );
            if (intoScalingCampaign) {
              await markSourceAdScaledInCache(supabase, {
                sourceAdId: adId,
                sourceAccountId,
                copiedAdId,
                scalingCampaignId: targetCampaignId,
                scalingStoreName: scalingRow!.store_name as string,
              });
            }
            // Skip the diagnostic+error path below by returning early.
            return Response.json({
              success: true,
              copied_ad_id: copiedAdId,
              status: statusOption,
              target_adset_id: targetAdsetId,
              created_adset_id: createdAdsetId,
              target_campaign_id: targetCampaignId,
              target_campaign_name: targetCampaignName,
              created_campaign_id: createdCampaignId,
              used_fallback: true,
            });
          }
        } catch (fallbackErr) {
          console.error(
            "[scaling/promote] recreate fallback exception",
            fallbackErr
          );
          // Fall through to the diagnostic + error response below.
        }
      }

      // When /copies fails with the opaque "(#3) capability" error, run a
      // bunch of read probes against Meta to capture the *actual* state of
      // everything involved. This lets us tell from the response alone
      // whether the cause is a special-ad-category mismatch, a
      // disapproved/issued ad, an ad-account restriction, a token scope
      // gap, or something else — instead of trial-and-error guessing.
      const probe = async (
        path: string,
        fields?: string
      ): Promise<unknown> => {
        try {
          const url =
            `${FB_API_BASE}/${path}` +
            (fields ? `?fields=${encodeURIComponent(fields)}&` : "?") +
            `access_token=${encodeURIComponent(token)}`;
          const r = await fetch(url, { cache: "no-store" });
          const j = await r.json();
          return r.ok ? j : { __error: j?.error ?? `${r.status}` };
        } catch (e) {
          return { __error: e instanceof Error ? e.message : "fetch failed" };
        }
      };

      const [
        permissions,
        sourceAd,
        sourceAccount,
        targetCampaign,
        targetAdset,
        targetAccount,
      ] = await Promise.all([
        probe("me/permissions"),
        probe(
          adId,
          "id,name,status,effective_status,configured_status,issues_info,account_id,adset{id,name,status,effective_status,campaign{id,name,objective,special_ad_categories,special_ad_category,buying_type,status,effective_status}}"
        ),
        sourceAccountId
          ? probe(
              acctPrefix(sourceAccountId),
              "id,name,account_status,disable_reason,capabilities,business{id,name}"
            )
          : Promise.resolve(null),
        probe(
          targetCampaignId,
          "id,name,objective,special_ad_categories,special_ad_category,buying_type,status,effective_status"
        ),
        probe(
          targetAdsetId,
          "id,name,status,effective_status,optimization_goal,billing_event,promoted_object,campaign_id"
        ),
        probe(
          acctPrefix(scalingAccountId),
          "id,name,account_status,disable_reason,capabilities,business{id,name}"
        ),
      ]);

      const diag = {
        permissions,
        source_ad: sourceAd,
        source_account: sourceAccount,
        target_campaign: targetCampaign,
        target_adset: targetAdset,
        target_account: targetAccount,
      };

      console.error("[scaling/promote] diagnostic probe", diag);

      return Response.json(
        {
          error: userTitle ? `${userTitle}: ${msg}` : msg,
          fb_code: copyJson?.error?.code,
          fb_subcode: copyJson?.error?.error_subcode,
          fb_user_msg: copyJson?.error?.error_user_msg,
          fb_trace: copyJson?.error?.fbtrace_id,
          diag,
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
    `[scaling/promote] employee=${employee.id} ad=${adId} → adset=${targetAdsetId} (store=${targetStore}, campaign=${targetCampaignId}) copied_ad=${copiedAdId} status=${statusOption} new_adset=${createdAdsetId ?? "no"} new_campaign=${createdCampaignId ?? "no"}`
  );

  // Only the mapped scaling campaign earns the "↑ SCALED" badge. An ad
  // copied into some other campaign is not scaled, and claiming otherwise
  // would just be un-claimed by the next detection cron anyway.
  if (intoScalingCampaign) {
    await markSourceAdScaledInCache(supabase, {
      sourceAdId: adId,
      sourceAccountId,
      copiedAdId,
      scalingCampaignId: targetCampaignId,
      scalingStoreName: scalingRow!.store_name as string,
    });
  }

  return Response.json({
    success: true,
    copied_ad_id: copiedAdId,
    status: statusOption,
    target_adset_id: targetAdsetId,
    created_adset_id: createdAdsetId,
    target_campaign_id: targetCampaignId,
    target_campaign_name: targetCampaignName,
    created_campaign_id: createdCampaignId,
  });
}
