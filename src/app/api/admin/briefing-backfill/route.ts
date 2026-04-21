import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { runBriefing } from "@/lib/briefings/run";
import type { BriefingType, PeriodRange } from "@/lib/briefings/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Rebuild a specific briefing row by id. Unlike /api/admin/briefing-rerun
// (which always uses the CURRENT period and is useful right after a cron
// finished with bad data), this endpoint uses the briefing's own
// period_start/period_end — so it can backfill briefings from days or
// weeks ago. Email send is skipped so admins don't get duplicate reports
// in their inbox on every rebuild.

// Map briefing type → the fields collectBriefingData still reads off
// PeriodRange (mostly `datePreset` for FB fallback and `label` for UI).
const TYPE_PRESET: Record<BriefingType, string> = {
  morning: "yesterday",
  evening: "today",
  weekly: "last_7_days",
  monthly: "last_30_days",
};

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id param required" }, { status: 400 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET env var not set" },
      { status: 500 }
    );
  }

  const supabase = createServiceClient();

  const { data: existing, error: loadErr } = await supabase
    .from("briefings")
    .select("id, type, period_label, period_start, period_end, headline")
    .eq("id", id)
    .maybeSingle();

  if (loadErr || !existing) {
    return Response.json(
      { error: `briefing not found: ${loadErr?.message ?? "no row"}` },
      { status: 404 }
    );
  }

  const type = existing.type as BriefingType;
  const periodStartStr = existing.period_start as string | null;
  const periodEndStr = existing.period_end as string | null;
  if (!periodStartStr || !periodEndStr) {
    return Response.json(
      { error: "existing briefing is missing period_start/period_end" },
      { status: 400 }
    );
  }

  // Reconstruct PeriodRange. We store period dates as PHT calendar dates
  // (YYYY-MM-DD). Convert back to Date objects positioned at midday PHT so
  // phtDateString() round-trips to the exact same calendar date regardless
  // of DST/timezone edge cases.
  const startDate = new Date(`${periodStartStr}T12:00:00+08:00`);
  const endDate = new Date(`${periodEndStr}T12:00:00+08:00`);
  const period: PeriodRange = {
    start: startDate,
    end: endDate,
    label: existing.period_label as string,
    dateFilter: "custom",
    datePreset: TYPE_PRESET[type],
  };

  // Delete the old row so runBriefing's idempotency guard doesn't short-circuit.
  const { error: delErr } = await supabase
    .from("briefings")
    .delete()
    .eq("id", id);
  if (delErr) {
    return Response.json(
      { error: `delete failed: ${delErr.message}` },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const result = await runBriefing(supabase, baseUrl, cronSecret, type, {
    period,
    skipEmail: true,
  });

  return Response.json({
    rebuilt_id: existing.id,
    previous_headline: existing.headline,
    period: { start: periodStartStr, end: periodEndStr, type },
    result,
  });
}
