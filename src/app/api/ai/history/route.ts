import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET — fetch generation history (admin sees all, others see own)
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store");
  const toolType = searchParams.get("tool_type");

  const supabase = await createClient();

  let query = supabase
    .from("ai_generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  // Admin and marketing can see all threads (shared)
  // Other roles see only their own
  if (!["admin", "marketing"].includes(employee.role)) {
    query = query.eq("employee_id", employee.id);
  }

  if (store) {
    query = query.eq("store_name", store);
  }

  if (toolType) {
    query = query.eq("tool_type", toolType);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ history: data || [], generations: data || [] });
}

// POST — save or update a generation thread.
// If `id` is passed, updates that row (so the running conversation accumulates
// in one thread instead of a new row per response). Otherwise inserts.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, store_name, tool_type, input_data, output_data } = body as {
    id?: string;
    store_name: string;
    tool_type: string;
    input_data: unknown;
    output_data: unknown;
  };

  if (!store_name || !tool_type) {
    return Response.json(
      { error: "store_name and tool_type are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  if (id) {
    // Update existing thread. Only allow the owner (or admin/marketing, who
    // share threads in the GET handler) to mutate it.
    let updateQuery = supabase
      .from("ai_generations")
      .update({ input_data, output_data })
      .eq("id", id);

    if (!["admin", "marketing"].includes(employee.role)) {
      updateQuery = updateQuery.eq("employee_id", employee.id);
    }

    const { data, error } = await updateQuery.select("id").maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      // Row not found / not owned — fall through to insert so the thread
      // isn't lost when the id ref gets stale.
    } else {
      return Response.json({ success: true, id: data.id });
    }
  }

  const { data, error } = await supabase
    .from("ai_generations")
    .insert({
      employee_id: employee.id,
      store_name,
      tool_type,
      input_data,
      output_data,
    })
    .select("id")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, id: data.id });
}
