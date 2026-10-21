"use server";

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { getGuide } from "./registry";
import type { GuideProgress } from "./types";

async function upsert(guideId: string, patch: Partial<Omit<GuideProgress, "guide_id">>): Promise<void> {
  if (!getGuide(guideId)) return;
  const employee = await getEmployee();
  if (!employee) return;
  const supabase = await createClient();
  await supabase
    .from("guide_progress")
    .upsert(
      { employee_id: employee.id, guide_id: guideId, updated_at: new Date().toISOString(), ...patch },
      { onConflict: "employee_id,guide_id" }
    );
}

/** The step they are on (0-based), so "Continue" picks up there. */
export async function saveGuideStep(guideId: string, step: number): Promise<void> {
  await upsert(guideId, { last_step: Math.max(0, Math.floor(step)) });
}

/** They pressed Finish on the last step. */
export async function finishGuide(guideId: string): Promise<void> {
  await upsert(guideId, { last_step: 0, completed_at: new Date().toISOString() });
}

/** They turned down the first-visit offer; it is not shown again. */
export async function dismissGuideOffer(guideId: string): Promise<void> {
  await upsert(guideId, { dismissed_at: new Date().toISOString() });
}
