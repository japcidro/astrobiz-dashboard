import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

interface Access {
  employeeId: string;
  apiKey: string;
}

// Shared gate for the three Transcriber routes: signed in, allowed role, and a
// Gemini key configured. Returns a Response to send back on failure so each
// route stays a couple of lines.
export async function requireTranscriberAccess(): Promise<
  { ok: true; access: Access } | { ok: false; response: Response }
> {
  const employee = await getEmployee();
  if (!employee) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "gemini_api_key")
    .single();
  const apiKey = (data?.value as string | undefined) ?? null;
  if (!apiKey) {
    return {
      ok: false,
      response: Response.json(
        { error: "Gemini API key not configured. Go to Settings." },
        { status: 400 }
      ),
    };
  }

  return { ok: true, access: { employeeId: employee.id, apiKey } };
}
