import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlert } from "../insert";
import { fbFetchWithLimits, getBlockedUntil } from "@/lib/facebook/rate-limit";
import {
  describeAccountStatus,
  minorToMajor,
  storesForAccount,
} from "@/lib/facebook/billing";
import {
  BILLING_THRESHOLDS_KEY,
  BILLING_THRESHOLD_STATE_KEY,
  PAYMENT_FAILED_REPEAT_HOURS,
  parseThresholdConfig,
  parseThresholdState,
  advanceCycle,
  resolveThreshold,
  thresholdStatus,
  shouldAlert,
  describeThresholdAlert,
  describePaymentFailedAlert,
  type PriorThresholdAlert,
  type ThresholdStage,
  type ThresholdState,
} from "@/lib/facebook/billing-threshold";
import { matchAdToStore } from "@/lib/profit/store-matching";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// ===================================================================
// Rules: ad_billing_threshold + ad_account_payment_failed
//
// ad_billing_threshold — an ad account's unpaid balance reaches its alert
// level (default ₱40,000 of a ₱50,000 payment threshold), and again when
// it reaches the threshold itself. One alert per stage per billing cycle.
// A cycle ends when the balance drops (Meta charged the card, or someone
// paid early); every pass records the balance so a drop is never missed.
//
// ad_account_payment_failed — Meta reports a status that needs a payment
// (UNSETTLED, IN_GRACE_PERIOD, PENDING_SETTLEMENT, or disabled for payment
// risk). Repeats every PAYMENT_FAILED_REPEAT_HOURS until it clears.
//
// Severity: urgent — the detect-alerts cron emails them right away.
// ===================================================================
export async function detectAdBillingThreshold(
  supabase: SupabaseClient
): Promise<number> {
  const [
    { data: tokenRow },
    { data: selectedRow },
    { data: thresholdRow },
    { data: stateRow },
  ] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "fb_access_token").maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "fb_selected_accounts").maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", BILLING_THRESHOLDS_KEY).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", BILLING_THRESHOLD_STATE_KEY).maybeSingle(),
  ]);

  const token = tokenRow?.value as string | undefined;
  if (!token) return 0;

  let accountIds: string[] = [];
  try {
    accountIds = selectedRow?.value ? JSON.parse(selectedRow.value) : [];
  } catch {
    accountIds = [];
  }
  if (accountIds.length === 0) return 0;

  // Meta is throttling us: skip this pass rather than deepen the block.
  if (await getBlockedUntil(supabase)) return 0;

  const config = parseThresholdConfig(thresholdRow?.value as string | undefined);
  const prevState = parseThresholdState(stateRow?.value as string | undefined);

  const fields =
    "id,name,balance,currency,account_status,disable_reason,funding_source_details{display_string}";
  const res = await fbFetchWithLimits(
    `${FB_API_BASE}/?ids=${accountIds.join(",")}&fields=${fields}&access_token=${token}`,
    { cache: "no-store" },
    supabase
  );
  const detail = (await res.json()) as Record<
    string,
    {
      id?: string;
      name?: string;
      balance?: string;
      currency?: string;
      account_status?: number;
      disable_reason?: number;
      funding_source_details?: { display_string?: string };
      error?: { message: string };
    }
  > & { error?: { message: string } };
  if (detail.error) throw new Error(detail.error.message);

  // Stores per account, from the Ad Performance cache — names the brand
  // in the email so the reader knows what stops if the card fails.
  const { data: adsCache } = await supabase
    .from("cached_api_data")
    .select("response_data")
    .eq("cache_key", "ads_v3:account=ALL&date_preset=last_7d")
    .maybeSingle();
  const adRows =
    ((adsCache?.response_data as { data?: unknown } | null)?.data as
      | Array<{ account_id: string; campaign?: string; adset?: string; spend?: number }>
      | undefined) ?? [];

  let alertCount = 0;
  const nextState: ThresholdState = { ...prevState };

  for (const id of accountIds) {
    const a = detail[id];
    if (!a || a.error || typeof a !== "object" || !("balance" in a)) continue;

    const currency = a.currency ?? "PHP";
    const balance = minorToMajor(a.balance, currency);
    const observed = advanceCycle(prevState[id], balance);
    nextState[id] = observed;

    const name = a.name ?? id;
    const card = a.funding_source_details?.display_string ?? null;
    const storesFor = () =>
      storesForAccount(adRows, id, name, matchAdToStore).map((s) => s.store);

    // A failed payment outranks the threshold: the ads are already
    // stopped (or about to be), so that is the only thing worth saying.
    const accountStatus = describeAccountStatus(
      a.account_status ?? 1,
      a.disable_reason ?? 0
    );
    if (accountStatus.needsPayment) {
      const stores = storesFor();
      const text = describePaymentFailedAlert({
        accountName: name,
        balance,
        headline: accountStatus.headline,
        action: accountStatus.action,
        card,
        stores,
      });
      const inserted = await insertAlert(supabase, {
        type: "ad_account_payment_failed",
        severity: "urgent",
        title: text.title,
        body: text.body,
        resource_type: "ad_account",
        resource_id: id,
        action_url: "/marketing/ads-billing",
        payload: {
          account_id: id,
          account_name: name,
          balance,
          status: accountStatus.label,
          card,
          stores,
        },
        dedup_hours: PAYMENT_FAILED_REPEAT_HOURS,
      });
      if (inserted) alertCount++;
      continue;
    }

    const setting = resolveThreshold(config, id);
    const status = thresholdStatus(balance, setting);
    if (!status.stage) continue;

    const prior = await latestThresholdAlert(supabase, id);
    if (!shouldAlert(status, observed.cycle, prior)) continue;

    const stores = storesFor();
    const text = describeThresholdAlert({
      accountName: name,
      balance,
      status,
      card,
      stores,
    });

    const inserted = await insertAlert(supabase, {
      type: "ad_billing_threshold",
      severity: "urgent",
      title: text.title,
      body: text.body,
      resource_type: "ad_account",
      resource_id: id,
      action_url: "/marketing/ads-billing",
      payload: {
        account_id: id,
        account_name: name,
        balance,
        limit: status.limit,
        alert_at: status.alert_at,
        pct: Math.round(status.pct),
        stage: status.stage,
        cycle: observed.cycle,
        card,
        stores,
      },
      // Cycle tracking above is the real dedup; this only guards against
      // two cron passes landing in the same hour.
      dedup_hours: 1,
    });
    if (inserted) alertCount++;
  }

  // Record every balance seen this pass, alert or not — the next pass
  // compares against it to notice a charge.
  const { error: stateError } = await supabase
    .from("app_settings")
    .upsert(
      { key: BILLING_THRESHOLD_STATE_KEY, value: JSON.stringify(nextState) },
      { onConflict: "key" }
    );
  if (stateError) {
    console.error("[alerts] billing threshold state not saved:", stateError.message);
  }

  return alertCount;
}

async function latestThresholdAlert(
  supabase: SupabaseClient,
  accountId: string
): Promise<PriorThresholdAlert | null> {
  const { data } = await supabase
    .from("admin_alerts")
    .select("payload")
    .eq("type", "ad_billing_threshold")
    .eq("resource_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = data?.payload as { stage?: unknown; cycle?: unknown } | null;
  if (!payload) return null;
  const stage = payload.stage === "reached" || payload.stage === "approaching"
    ? (payload.stage as ThresholdStage)
    : null;
  if (stage === null) return null;
  // An alert written before cycles were tracked has no cycle; treat it as
  // cycle 0, the first cycle the tracker assigns.
  const cycle = typeof payload.cycle === "number" ? payload.cycle : 0;
  return { stage, cycle };
}
