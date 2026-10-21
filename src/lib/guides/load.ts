import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/lib/types";
import type { GuideProgress } from "./types";

/** Every guide_progress row for one employee. Server only. */
export async function loadGuideProgress(employee: Employee): Promise<GuideProgress[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("guide_progress")
    .select("guide_id, last_step, completed_at, dismissed_at")
    .eq("employee_id", employee.id);
  return (data ?? []) as GuideProgress[];
}
