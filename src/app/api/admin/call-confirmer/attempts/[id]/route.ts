import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import { syncAttemptFromVapi } from "@/lib/call-confirmer/sync";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "no_answer",
  "voicemail",
  "busy",
  "escalated",
]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_attempts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  // Defensive auto-sync: if call has terminal status but is missing key
  // diagnostic info (transcript OR cost OR handoff_reason for failures),
  // pull fresh from Vapi. Covers webhook delivery gaps.
  const isFailureMissingReason =
    (data.status === "failed" ||
      data.status === "no_answer" ||
      data.status === "voicemail" ||
      data.status === "busy") &&
    !data.handoff_reason;

  const isTerminal = TERMINAL_STATUSES.has(data.status);

  // A non-terminal attempt is the polling case: the call is live, or it ended
  // and no webhook arrived. This used to require a TERMINAL status to sync,
  // which was unreachable without a webhook — so attempts sat on "ringing"
  // forever and the UI never left "Call in progress".
  if (
    data.provider_call_id &&
    (!isTerminal ||
      !data.transcript ||
      data.cost_usd == null ||
      isFailureMissingReason)
  ) {
    await syncAttemptFromVapi(data.id, data.provider_call_id).catch(() => {});
    const { data: refreshed } = await supabase
      .from("call_attempts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (refreshed) return Response.json({ attempt: refreshed });
  }

  return Response.json({ attempt: data });
}
