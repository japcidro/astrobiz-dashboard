import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 20;
const TITLE_MAX = 80;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function gateRole(role: string) {
  return ["admin", "marketing"].includes(role);
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const raw = firstUser?.content?.trim() ?? "Untitled chat";
  return raw.length > TITLE_MAX ? raw.slice(0, TITLE_MAX) + "…" : raw;
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!gateRole(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .select("id, title, account_id, date_preset, updated_at, messages")
    .eq("employee_id", employee.id)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string | null) ?? deriveTitle(
      (r.messages as ChatMessage[]) ?? []
    ),
    account_id: r.account_id as string | null,
    date_preset: r.date_preset as string | null,
    updated_at: r.updated_at as string,
    message_count: Array.isArray(r.messages) ? (r.messages as unknown[]).length : 0,
  }));

  return Response.json({ rows });
}

// Upsert a session. Pass `id` to update an existing one, omit to create.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!gateRole(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    id?: string | null;
    messages: ChatMessage[];
    account_id?: string | null;
    date_preset?: string | null;
  };

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return Response.json(
      { error: "messages must be a non-empty array" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const payload = {
    employee_id: employee.id,
    messages,
    account_id: body.account_id ?? null,
    date_preset: body.date_preset ?? null,
    title: deriveTitle(messages),
  };

  if (body.id) {
    // Ownership is enforced by RLS, but also guard explicitly.
    const { data: existing } = await supabase
      .from("ai_chat_sessions")
      .select("id, employee_id")
      .eq("id", body.id)
      .single();
    if (!existing || existing.employee_id !== employee.id) {
      return Response.json(
        { error: "Session not found or not yours" },
        { status: 404 }
      );
    }
    const { data, error } = await supabase
      .from("ai_chat_sessions")
      .update(payload)
      .eq("id", body.id)
      .select()
      .single();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ row: data });
  }

  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .insert(payload)
    .select()
    .single();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ row: data });
}
