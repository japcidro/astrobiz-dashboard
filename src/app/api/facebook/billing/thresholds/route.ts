import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  BILLING_THRESHOLDS_KEY,
  parseThresholdConfig,
  resolveThreshold,
  withAccountThreshold,
} from "@/lib/facebook/billing-threshold";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const employee = await getEmployee();
  if (!employee) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (employee.role !== "admin") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { employee };
}

/** GET /api/facebook/billing/thresholds — the stored limits, parsed. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", BILLING_THRESHOLDS_KEY)
    .maybeSingle();
  return Response.json(parseThresholdConfig(data?.value as string | undefined));
}

/**
 * PUT /api/facebook/billing/thresholds
 * Body: { account_id: "act_…", limit: 50000, alert_at: 40000 }
 *
 * Sets one account's payment threshold and warning level. The alert cron
 * reads the same row, so a change here moves the email trigger too.
 */
export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    account_id?: string;
    limit?: number;
    alert_at?: number;
  } | null;

  const accountId = body?.account_id?.trim();
  const limit = Number(body?.limit);
  const alertAt = Number(body?.alert_at);

  if (!accountId || !/^act_\d+$/.test(accountId)) {
    return Response.json({ error: "account_id must look like act_123" }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return Response.json({ error: "limit must be a positive amount" }, { status: 400 });
  }
  if (!Number.isFinite(alertAt) || alertAt <= 0) {
    return Response.json({ error: "alert_at must be a positive amount" }, { status: 400 });
  }
  if (alertAt > limit) {
    return Response.json(
      { error: "The alert level must be at or below the billing limit" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", BILLING_THRESHOLDS_KEY)
    .maybeSingle();

  const next = withAccountThreshold(
    parseThresholdConfig(data?.value as string | undefined),
    accountId,
    { limit: Math.round(limit), alert_at: Math.round(alertAt) }
  );

  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: BILLING_THRESHOLDS_KEY, value: JSON.stringify(next) }, { onConflict: "key" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, threshold: resolveThreshold(next, accountId) });
}
