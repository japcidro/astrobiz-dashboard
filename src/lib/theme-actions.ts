"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { THEME_COOKIE, isTheme, type Theme } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

async function writeCookie(theme: Theme) {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Save the signed-in employee's theme: the cookie for the next paint, the
 * employee row so it follows them to another device.
 */
export async function setTheme(theme: Theme): Promise<void> {
  if (!isTheme(theme)) throw new Error("Unknown theme");
  const employee = await getEmployee();
  if (!employee) throw new Error("Not authenticated");

  await writeCookie(theme);

  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({ theme })
    .eq("id", employee.id);
  if (error) throw new Error(error.message);
}

/**
 * Bring the cookie in line with the saved theme, for a device that has not
 * seen this employee before. Called by ThemeSync; no database write.
 */
export async function syncThemeCookie(theme: Theme): Promise<void> {
  if (!isTheme(theme)) return;
  const employee = await getEmployee();
  if (!employee || employee.theme !== theme) return;
  await writeCookie(theme);
}
