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
    .from("brand_reference_files")
    .select("id, store_name, title, category, file_url, file_name, file_type, file_size_bytes, created_by, created_at")
    .eq("store_name", store)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ files: data ?? [] });
}
