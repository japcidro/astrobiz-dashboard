"use client";

import { HelpCircle } from "lucide-react";
import { getGuide } from "@/lib/guides/registry";
import { cn } from "@/lib/utils";
import { startGuide } from "./start";

/** The "?" on a page that has a guide: starts (or resumes) its walkthrough. */
export function GuideButton({ guide, className }: { guide: string; className?: string }) {
  if (!getGuide(guide)) return null;
  return (
    <button
      type="button"
      onClick={() => startGuide(guide)}
      title="Show me around"
      aria-label="Show me around"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control border border-line-strong bg-panel text-muted transition-colors hover:bg-raised hover:text-fg",
        className
      )}
    >
      <HelpCircle size={16} />
    </button>
  );
}
