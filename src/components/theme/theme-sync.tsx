"use client";

import { useEffect } from "react";
import { syncThemeCookie } from "@/lib/theme-actions";
import type { Theme } from "@/lib/theme";

/**
 * The saved theme wins over the cookie: on a device that has not seen this
 * employee yet, the first paint used the default, so switch at once and
 * write the cookie for next time.
 */
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === theme) return;
    root.setAttribute("data-theme", theme);
    syncThemeCookie(theme).catch(() => {});
  }, [theme]);
  return null;
}
