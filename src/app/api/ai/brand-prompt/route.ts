import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const store = new URL(request.url).searchParams.get("store");
  if (!store) return Response.json({ error: "store is required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_system_prompts")
    .select("*")
    .eq("store_name", store)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ prompt: data ?? { store_name: store, system_prompt: "" } });
}

export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, system_prompt } = body as {
    store_name?: string;
    system_prompt?: string;
  };

  if (!store_name || typeof system_prompt !== "string") {
    return Response.json(
      { error: "store_name and system_prompt are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_system_prompts")
    .upsert(
      {
        store_name,
        system_prompt,
        updated_by: employee.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_name" }
    )
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ prompt: data });
}
