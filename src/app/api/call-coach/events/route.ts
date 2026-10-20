import { requireRecordedEmployee } from "@/lib/call-coach/server";
import { phDate, type MicEventKind } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

const KINDS = new Set<MicEventKind>(["started", "paused", "resumed", "lost", "blocked", "stopped", "silent"]);

/** POST { kind, time_entry_id?, detail? } — what the recorder just did. */
export async function POST(request: Request) {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as
    | { kind?: string; time_entry_id?: string | null; detail?: string | null; at?: string }
    | null;
  const kind = body?.kind as MicEventKind | undefined;
  if (!kind || !KINDS.has(kind)) return Response.json({ error: "Unknown event" }, { status: 400 });

  const at = body?.at ? new Date(body.at) : new Date();
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  const entry = typeof body?.time_entry_id === "string" && /^[0-9a-f-]{36}$/.test(body.time_entry_id) ? body.time_entry_id : null;

  const { error } = await auth.db.from("call_coach_mic_events").insert({
    employee_id: auth.employee.id,
    time_entry_id: entry,
    date: phDate(when),
    kind,
    at: when.toISOString(),
    detail: typeof body?.detail === "string" ? body.detail.slice(0, 300) : null,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
