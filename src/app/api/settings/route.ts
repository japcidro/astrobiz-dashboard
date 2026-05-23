import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// Admin-only upsert into app_settings. Used by AiKeyManager to save the
// Anthropic API key (and any future provider keys) without exposing them
// to the client beyond the moment of entry.
export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { key, value } = body as { key?: string; value?: string };

  if (!key || typeof value !== "string") {
    return Response.json(
      { error: "key and value are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
