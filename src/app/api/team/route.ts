import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET — list all employees
export async function GET() {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, email, full_name, role, is_active, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ employees: data || [] });
}

// POST — add new employee (pre-register email + role before they sign in)
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { email, full_name, role } = body as {
    email: string;
    full_name: string;
    role: string;
  };

  if (!email || !full_name || !role) {
    return Response.json({ error: "Email, name, and role are required" }, { status: 400 });
  }

  const validRoles = ["admin", "va", "fulfillment", "marketing"];
  if (!validRoles.includes(role)) {
    return Response.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, { status: 400 });
  }

  const supabase = await createClient();

  // Check if email already exists
  const { data: existing } = await supabase
    .from("employees")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (existing) {
    return Response.json({ error: "An employee with this email already exists" }, { status: 400 });
  }

  // Insert employee without auth_id — it will be linked when they first sign in
  const { data, error } = await supabase
    .from("employees")
    .insert({
      email: email.toLowerCase().trim(),
      full_name,
      role,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, id: data.id });
}

// PUT — update employee role, name, or active status
export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { id, full_name, role, is_active } = body as {
    id: string;
    full_name?: string;
    role?: string;
    is_active?: boolean;
  };

  if (!id) {
    return Response.json({ error: "Employee ID is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (role !== undefined) {
    const validRoles = ["admin", "va", "fulfillment", "marketing"];
    if (!validRoles.includes(role)) {
      return Response.json({ error: `Invalid role` }, { status: 400 });
    }
    updates.role = role;
  }
  if (is_active !== undefined) updates.is_active = is_active;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update(updates)
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

// DELETE — remove employee
export async function DELETE(request: Request) {
  const employee = await getEmployee();
  if (!employee || employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Employee ID is required" }, { status: 400 });
  }

  // Don't allow deleting yourself
  if (id === employee.id) {
    return Response.json({ error: "You cannot remove yourself" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .delete()
    .eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
