import { createClient } from "./server";
import type { Employee } from "../types";

export async function getEmployee(): Promise<Employee | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Try by auth_id first (normal case — already linked)
  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("auth_id", user.id)
    .single();

  if (data) return data as Employee;

  // Fallback: try by email (pre-registered employee signing in for first time)
  if (user.email) {
    const { data: byEmail } = await supabase
      .from("employees")
      .select("*")
      .eq("email", user.email.toLowerCase())
      .is("auth_id", null)
      .single();

    if (byEmail) {
      // Link auth_id to this employee
      await supabase
        .from("employees")
        .update({ auth_id: user.id })
        .eq("id", byEmail.id);

      return { ...byEmail, auth_id: user.id } as Employee;
    }
  }

  return null;
}
