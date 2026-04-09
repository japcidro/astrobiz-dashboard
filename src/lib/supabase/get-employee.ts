import { createClient } from "./server";
import type { Employee } from "../types";

export async function getEmployee(): Promise<Employee | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("auth_id", user.id)
    .single();

  return data as Employee | null;
}
