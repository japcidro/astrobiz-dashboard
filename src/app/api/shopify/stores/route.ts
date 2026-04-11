import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const employee = await getEmployee();
  if (!employee || !["admin", "va", "fulfillment"].includes(employee.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, is_active")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
