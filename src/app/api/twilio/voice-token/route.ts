import { getEmployee } from "@/lib/supabase/get-employee";
import {
  mintVoiceToken,
  vaDialerHasBudget,
  getVaDialerConfig,
} from "@/lib/twilio/va-dialer";

export const dynamic = "force-dynamic";

// Mints a short-lived Twilio Voice access token for a VA's browser SDK.
// Refuses if today's VA call spend has hit the daily cap.
export async function POST() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "va" && employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await getVaDialerConfig();
  if (!config) {
    return Response.json(
      { error: "VA dialer not configured" },
      { status: 503 },
    );
  }
  if (!config.enabled) {
    return Response.json(
      { error: "VA dialer is disabled" },
      { status: 503 },
    );
  }

  const budget = await vaDialerHasBudget();
  if (!budget.ok) {
    return Response.json(
      {
        error: "Daily call budget exceeded",
        spend_usd: budget.spend,
        cap_usd: budget.cap,
      },
      { status: 429 },
    );
  }

  try {
    const minted = mintVoiceToken({ employeeId: employee.id });
    return Response.json({
      token: minted.token,
      identity: minted.identity,
      expires_in: minted.expiresIn,
      employee: {
        id: employee.id,
        full_name: employee.full_name,
      },
      budget: {
        spend_usd: budget.spend,
        cap_usd: budget.cap,
      },
      config: {
        per_call_max_seconds: config.per_call_max_seconds,
        recording_retention_days: config.recording_retention_days,
      },
    });
  } catch (err) {
    return Response.json(
      {
        error: "Failed to mint token",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
