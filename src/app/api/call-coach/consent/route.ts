import { activeConsent, requireRecordedEmployee } from "@/lib/call-coach/server";
import { CONSENT_TEXT } from "@/lib/call-coach/shared";

export const dynamic = "force-dynamic";

/** GET — the signed-in employee's active consent, or null. */
export async function GET() {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;
  return Response.json({ consent: await activeConsent(auth.db, auth.employee.id), text: CONSENT_TEXT });
}

/** POST { signed_name } — sign the consent. Stores the exact wording shown. */
export async function POST(request: Request) {
  const auth = await requireRecordedEmployee();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as { signed_name?: string } | null;
  const signedName = (body?.signed_name ?? "").trim();
  if (signedName.length < 2) return Response.json({ error: "Type your full name to sign" }, { status: 400 });

  const existing = await activeConsent(auth.db, auth.employee.id);
  if (existing) return Response.json({ consent: existing });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const { data, error } = await auth.db
    .from("call_coach_consents")
    .insert({
      employee_id: auth.employee.id,
      signed_name: signedName,
      consent_text: CONSENT_TEXT,
      ip,
      user_agent: request.headers.get("user-agent"),
    })
    .select("id, employee_id, signed_name, signed_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ consent: data });
}
