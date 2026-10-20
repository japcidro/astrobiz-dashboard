import { requireCoach } from "@/lib/call-coach/server";
import { DEFAULT_RUBRIC, RUBRIC_SETTING_KEY } from "@/lib/call-coach/shared";
import { settingValue } from "@/lib/call-coach/transcribe";

export const dynamic = "force-dynamic";

/** GET — the rubric Claude scores against, and whether it is the default. */
export async function GET() {
  const auth = await requireCoach();
  if (auth.error) return auth.error;
  const custom = await settingValue(auth.db, RUBRIC_SETTING_KEY);
  return Response.json({ rubric: custom ?? DEFAULT_RUBRIC, is_default: !custom, default: DEFAULT_RUBRIC });
}

/** PUT { rubric } — save an edited rubric; an empty string goes back to the default. */
export async function PUT(request: Request) {
  const auth = await requireCoach();
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => null)) as { rubric?: string } | null;
  const rubric = (body?.rubric ?? "").trim();
  if (rubric.length > 20_000) return Response.json({ error: "Rubric is too long" }, { status: 400 });

  if (!rubric) {
    await auth.db.from("app_settings").delete().eq("key", RUBRIC_SETTING_KEY);
    return Response.json({ rubric: DEFAULT_RUBRIC, is_default: true });
  }
  const { error } = await auth.db
    .from("app_settings")
    .upsert({ key: RUBRIC_SETTING_KEY, value: rubric, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rubric, is_default: false });
}
