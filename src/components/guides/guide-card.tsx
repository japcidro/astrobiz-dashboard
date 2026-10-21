"use client";

import { useState } from "react";
import { LinkButton, Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { guideHref } from "@/lib/guides/registry";
import type { Guide, GuideProgress } from "@/lib/guides/types";

/**
 * One guide on the Guides page: where they are with it, the button that
 * runs it on its page, and the same steps written out for reading.
 */
export function GuideCard({ guide, progress, canOpen }: { guide: Guide; progress?: GuideProgress; canOpen: boolean }) {
  const [reading, setReading] = useState(false);
  const total = guide.steps.length;
  const done = !!progress?.completed_at;
  const partway = !done && !!progress && progress.last_step > 0 && progress.last_step < total;

  return (
    <div className="grid min-w-0 gap-2 rounded-panel border border-line bg-panel px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 text-sm text-fg">{guide.title}</h3>
        {!canOpen ? (
          <Pill>Development dashboard</Pill>
        ) : done ? (
          <Pill tone="good">Done</Pill>
        ) : partway ? (
          <Pill tone="info">
            {progress!.last_step + 1} of {total}
          </Pill>
        ) : (
          <Pill>Not started</Pill>
        )}
      </div>
      <p className="text-[13px] text-muted">{guide.blurb}</p>
      <div className="flex gap-3 font-num text-[11.5px] text-dim">
        <span>{total} steps</span>
        <span>about {guide.minutes} min</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        {canOpen && (
          <LinkButton href={guideHref(guide)} size="sm" variant={done ? "secondary" : "primary"}>
            {done ? "Watch again" : partway ? "Continue" : "Start walkthrough"}
          </LinkButton>
        )}
        <Button size="sm" variant="ghost" onClick={() => setReading((v) => !v)} className="ml-auto" aria-expanded={reading}>
          {reading ? "Hide the steps" : "Read the steps"}
        </Button>
      </div>
      {reading && (
        <ol className="mt-1 grid list-decimal gap-1.5 border-t border-line pl-5 pt-3 text-[13px] text-muted">
          {guide.steps.map((s) => (
            <li key={s.target}>
              <span className="font-semibold text-fg">{s.title}.</span> {s.body.replaceAll("**", "")}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
