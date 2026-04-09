"use server";

import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { revalidatePath } from "next/cache";

export async function startTimer() {
  const supabase = await createClient();
  const employee = await getEmployee();
  if (!employee) throw new Error("Not authenticated");

  // Check for existing running/paused entry today
  const today = new Date().toISOString().split("T")[0];
  const { data: existing } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", employee.id)
    .eq("date", today)
    .in("status", ["running", "paused"])
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error("You already have an active session today");
  }

  const { error } = await supabase.from("time_entries").insert({
    employee_id: employee.id,
    date: today,
    status: "running",
    started_at: new Date().toISOString(),
    total_seconds: 0,
    is_manual: false,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/time-tracker");
}

export async function pauseTimer(entryId: string) {
  const supabase = await createClient();
  const employee = await getEmployee();
  if (!employee) throw new Error("Not authenticated");

  // Get current entry to calculate elapsed time
  const { data: entry } = await supabase
    .from("time_entries")
    .select("*, time_pauses(*)")
    .eq("id", entryId)
    .single();

  if (!entry || entry.status !== "running") {
    throw new Error("No running session found");
  }

  // Calculate total seconds so far
  const totalSeconds = calculateTotalSeconds(entry);

  // Update entry to paused and save accumulated time
  await supabase
    .from("time_entries")
    .update({ status: "paused", total_seconds: totalSeconds })
    .eq("id", entryId);

  // Create pause record
  await supabase.from("time_pauses").insert({
    time_entry_id: entryId,
    paused_at: new Date().toISOString(),
  });

  revalidatePath("/time-tracker");
}

export async function resumeTimer(entryId: string) {
  const supabase = await createClient();
  const employee = await getEmployee();
  if (!employee) throw new Error("Not authenticated");

  // Update the latest pause record with resumed_at
  const { data: pauses } = await supabase
    .from("time_pauses")
    .select("*")
    .eq("time_entry_id", entryId)
    .is("resumed_at", null)
    .order("paused_at", { ascending: false })
    .limit(1);

  if (pauses && pauses.length > 0) {
    await supabase
      .from("time_pauses")
      .update({ resumed_at: new Date().toISOString() })
      .eq("id", pauses[0].id);
  }

  await supabase
    .from("time_entries")
    .update({ status: "running" })
    .eq("id", entryId);

  revalidatePath("/time-tracker");
}

export async function stopTimer(entryId: string) {
  const supabase = await createClient();
  const employee = await getEmployee();
  if (!employee) throw new Error("Not authenticated");

  const { data: entry } = await supabase
    .from("time_entries")
    .select("*, time_pauses(*)")
    .eq("id", entryId)
    .single();

  if (!entry) throw new Error("Entry not found");

  const totalSeconds = calculateTotalSeconds(entry);

  // Close any open pause
  const { data: openPauses } = await supabase
    .from("time_pauses")
    .select("id")
    .eq("time_entry_id", entryId)
    .is("resumed_at", null);

  if (openPauses && openPauses.length > 0) {
    const now = new Date().toISOString();
    for (const p of openPauses) {
      await supabase
        .from("time_pauses")
        .update({ resumed_at: now })
        .eq("id", p.id);
    }
  }

  await supabase
    .from("time_entries")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      total_seconds: totalSeconds,
    })
    .eq("id", entryId);

  revalidatePath("/time-tracker");
}

export async function addManualEntry(formData: FormData) {
  const supabase = await createClient();
  const employee = await getEmployee();
  if (!employee) throw new Error("Not authenticated");

  const date = formData.get("date") as string;
  const hours = parseInt(formData.get("hours") as string) || 0;
  const minutes = parseInt(formData.get("minutes") as string) || 0;
  const notes = formData.get("notes") as string;

  const totalSeconds = hours * 3600 + minutes * 60;
  if (totalSeconds <= 0) throw new Error("Please enter valid hours/minutes");

  const { error } = await supabase.from("time_entries").insert({
    employee_id: employee.id,
    date,
    status: "completed",
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    total_seconds: totalSeconds,
    is_manual: true,
    notes: notes || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/time-tracker");
}

interface EntryWithPauses {
  started_at: string;
  total_seconds: number;
  status: string;
  time_pauses: Array<{
    paused_at: string;
    resumed_at: string | null;
  }>;
}

function calculateTotalSeconds(entry: EntryWithPauses): number {
  const startedAt = new Date(entry.started_at).getTime();
  const now = Date.now();

  // Total elapsed from start
  let elapsed = now - startedAt;

  // Subtract pause durations
  const pauses = entry.time_pauses || [];
  for (const pause of pauses) {
    const pauseStart = new Date(pause.paused_at).getTime();
    const pauseEnd = pause.resumed_at
      ? new Date(pause.resumed_at).getTime()
      : now;
    elapsed -= pauseEnd - pauseStart;
  }

  return Math.max(0, Math.floor(elapsed / 1000));
}
