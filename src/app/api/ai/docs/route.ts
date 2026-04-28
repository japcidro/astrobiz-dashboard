import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET — fetch all docs for a store (admin + marketing)
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin" && employee.role !== "marketing") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store");

  if (!store) {
    return Response.json({ error: "store is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_store_docs")
    .select("*")
    .eq("store_name", store)
    .order("doc_type", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ docs: data || [] });
}

// POST — upsert a document (admin only)
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Special case: save API key to app_settings
  if (body._save_setting) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: body._save_setting, value: body.value }, { onConflict: "key" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true });
  }

  const { store_name, doc_type, title, content, metadata } = body as {
    store_name: string;
    doc_type: string;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  };

  if (!store_name || !doc_type || !title || !content) {
    return Response.json(
      { error: "store_name, doc_type, title, and content are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const upsertPayload: Record<string, unknown> = {
    store_name,
    doc_type,
    title,
    content,
  };
  if (metadata !== undefined) {
    upsertPayload.metadata = metadata;
  }

  const { error } = await supabase
    .from("ai_store_docs")
    .upsert(upsertPayload, { onConflict: "store_name,doc_type" });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

// DELETE — delete a document by ID (admin only)
export async function DELETE(request: Request) {
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
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("ai_store_docs")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
