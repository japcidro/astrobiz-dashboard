"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { startTimer, pauseTimer, resumeTimer, stopTimer } from "@/lib/time-actions";
import type { TimeEntry, TimePause } from "@/lib/types";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/ui/note";

interface RunningTimerProps {
  activeEntry: (TimeEntry & { time_pauses: TimePause[] }) | null;
}

/** A clock that ticks once a second; 0 on the server, so the first paint is 00:00:00. */
function subscribeToClock(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}
const readClock = () => Math.floor(Date.now() / 1000) * 1000;
const readServerClock = () => 0;

/** Seconds on the clock at `now`, with every break taken out. */
function elapsedSeconds(
  entry: NonNullable<RunningTimerProps["activeEntry"]>,
  now: number
): number {
  if (now === 0) return 0;
  let elapsed = now - new Date(entry.started_at).getTime();
  for (const pause of entry.time_pauses || []) {
    const pauseStart = new Date(pause.paused_at).getTime();
    const pauseEnd = pause.resumed_at ? new Date(pause.resumed_at).getTime() : now;
    elapsed -= pauseEnd - pauseStart;
  }
  return Math.max(0, Math.floor(elapsed / 1000));
}

export function RunningTimer({ activeEntry }: RunningTimerProps) {
  const now = useSyncExternalStore(subscribeToClock, readClock, readServerClock);
  const seconds = activeEntry ? elapsedSeconds(activeEntry, now) : 0;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatClock = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  const handleAction = (action: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  };

  const isRunning = activeEntry?.status === "running";
  const isPaused = activeEntry?.status === "paused";
  const hasSession = isRunning || isPaused;

  return (
    <Panel
      title="Today's session"
      actions={
        isRunning ? (
          <Pill tone="good">Running</Pill>
        ) : isPaused ? (
          <Pill tone="warn">On break</Pill>
        ) : (
          <Pill>Not started</Pill>
        )
      }
    >
      {/* The timer is the one big thing on the page. */}
      <p
        className={`font-num text-5xl leading-none tracking-tight sm:text-6xl ${
          isPaused ? "text-muted" : "text-fg"
        }`}
        aria-live="off"
      >
        {formatTime(seconds)}
      </p>
      <p className="mt-2 text-xs text-muted">
        {hasSession && activeEntry
          ? `Started ${formatClock(activeEntry.started_at)}`
          : "Start when your shift begins. Breaks pause the clock."}
      </p>

      {error && (
        <Note tone="bad" className="mt-4">
          {error}
        </Note>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!hasSession && (
          <Button onClick={() => handleAction(startTimer)} disabled={isPending} size="lg">
            {isPending ? "Starting…" : "Start work"}
          </Button>
        )}

        {isRunning && (
          <>
            <Button
              variant="secondary"
              onClick={() => handleAction(() => pauseTimer(activeEntry!.id))}
              disabled={isPending}
            >
              Break
            </Button>
            <Button
              variant="danger"
              onClick={() => handleAction(() => stopTimer(activeEntry!.id))}
              disabled={isPending}
            >
              Clock out
            </Button>
          </>
        )}

        {isPaused && (
          <>
            <Button
              onClick={() => handleAction(() => resumeTimer(activeEntry!.id))}
              disabled={isPending}
            >
              Resume work
            </Button>
            <Button
              variant="danger"
              onClick={() => handleAction(() => stopTimer(activeEntry!.id))}
              disabled={isPending}
            >
              Clock out
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}
