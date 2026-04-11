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

  // Non-admin users only see their own generations
  if (employee.role !== "admin") {
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

  return Response.json({ generations: data || [] });
}

// POST — save a generation
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { store_name, tool_type, input_data, output_data } = body as {
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
