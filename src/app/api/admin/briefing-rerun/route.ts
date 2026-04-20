import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { runBriefing } from "@/lib/briefings/run";
import { getPeriod, phtDateString } from "@/lib/briefings/period";
import type { BriefingType } from "@/lib/briefings/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Force-rebuild (and re-send) a briefing for the current period even if
// one already exists. Deletes the existing row first so the
// idempotency guard in runBriefing doesn't short-circuit.
//
// Admin-only. Usage:
//   /api/admin/briefing-rerun?type=morning
//   /api/admin/briefing-rerun?type=morning&no_email=1

const VALID_TYPES: BriefingType[] = [
  "morning",
  "evening",
  "weekly",
  "monthly",
];

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as BriefingType | null;
  if (!type || !VALID_TYPES.includes(type)) {
    return Response.json(
      { error: `type must be one of ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const period = getPeriod(type);
  const periodStart = phtDateString(period.start);

  const { data: existing } = await supabase
    .from("briefings")
    .select("id, headline")
    .eq("type", type)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (existing?.id) {
    const { error: delErr } = await supabase
      .from("briefings")
      .delete()
      .eq("id", existing.id);
    if (delErr) {
      return Response.json(
        { error: `delete failed: ${delErr.message}` },
        { status: 500 }
      );
    }
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET env var not set" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const result = await runBriefing(supabase, baseUrl, cronSecret, type);

  return Response.json({
    replaced_existing: !!existing,
    previous_headline: existing?.headline ?? null,
    result,
  });
}
