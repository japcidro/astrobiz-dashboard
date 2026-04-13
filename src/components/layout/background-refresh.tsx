"use client";

import { useEffect } from "react";
import { startBackgroundRefresh } from "@/lib/client-cache";

/**
 * Invisible component that starts the background data refresh.
 * Mount once in the dashboard layout.
 */
export function BackgroundRefresh() {
  useEffect(() => {
    startBackgroundRefresh();
  }, []);

  return null; // Renders nothing
}
