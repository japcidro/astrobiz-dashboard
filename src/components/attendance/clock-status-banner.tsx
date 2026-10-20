"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, AlertCircle, PauseCircle, ArrowRight } from "lucide-react";

interface Status {
  state: "running" | "paused" | "not_clocked_in" | "loading";
  running_seconds?: number;
  shift_start?: string | null;
  shift_end?: string | null;
  is_off_day?: boolean;
}

const POLL_MS = 30_000;

function phtTodayString(): string {
  const pht = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function ClockStatusBanner() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  const load = useCallback(async () => {
    try {
      const today = phtTodayString();
      const [entriesRes, shiftRes] = await Promise.all([
        fetch(`/api/time/today`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/employee-shifts/list?start=${today}&end=${today}`, {
          cache: "no-store",
        }).catch(() => null),
      ]);

      let running_seconds = 0;
      let state: Status["state"] = "not_clocked_in";

      if (entriesRes?.ok) {
        const data = (await entriesRes.json()) as {
          running?: { started_at: string; total_seconds: number };
          paused?: boolean;
          total_seconds?: number;
        };
        if (data.running) {
          state = "running";
          const elapsed =
            (Date.now() - new Date(data.running.started_at).getTime()) / 1000;
          running_seconds = Math.floor(elapsed + (data.running.total_seconds ?? 0));
        } else if (data.paused) {
          state = "paused";
          running_seconds = data.total_seconds ?? 0;
        } else if ((data.total_seconds ?? 0) > 0) {
          state = "not_clocked_in";
          running_seconds = data.total_seconds ?? 0;
        }
      }

      let shift_start: string | null = null;
      let shift_end: string | null = null;
      let is_off_day = false;
      if (shiftRes?.ok) {
        const data = (await shiftRes.json()) as {
          shifts: Array<{
            start_time: string | null;
            end_time: string | null;
            is_off_day: boolean;
          }>;
        };
        const shift = data.shifts[0];
        if (shift) {
          shift_start = shift.start_time;
          shift_end = shift.end_time;
          is_off_day = shift.is_off_day;
        }
      }

      setStatus({ state, running_seconds, shift_start, shift_end, is_off_day });
    } catch {
      setStatus({ state: "not_clocked_in" });
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Tick the running counter every second for visual feedback
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status.state !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [status.state]);

  if (status.state === "loading") return null;
  if (status.is_off_day) return null;

  // Determine if we should show an urgent "you haven't clocked in" state.
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const currentMinutes = ph.getUTCHours() * 60 + ph.getUTCMinutes();
  let shiftActive = false;
  if (status.shift_start && status.shift_end) {
    const [sh, sm] = status.shift_start.split(":").map(Number);
    const [eh, em] = status.shift_end.split(":").map(Number);
    shiftActive =
      currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em;
  }

  if (status.state === "running") {
    const displaySeconds = (status.running_seconds ?? 0) + tick;
    return (
      <div className="flex items-center justify-between gap-3 border-b border-line bg-sidebar px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-good" />
          <CheckCircle size={14} className="text-good" />
          <span className="text-sm text-fg">
            Clocked in · <span className="font-num">{fmtDuration(displaySeconds)}</span>
          </span>
        </div>
        <Link
          href="/time-tracker"
          className="flex items-center gap-1 text-xs text-muted hover:text-fg"
        >
          Open tracker <ArrowRight size={12} />
        </Link>
      </div>
    );
  }

  if (status.state === "paused") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-warn/40 bg-warn-soft px-4 py-2">
        <div className="flex items-center gap-2">
          <PauseCircle size={14} className="text-warn" />
          <span className="text-sm text-fg">
            On break · <span className="font-num">{fmtDuration(status.running_seconds ?? 0)}</span>
          </span>
        </div>
        <Link
          href="/time-tracker"
          className="flex items-center gap-1 text-xs text-warn hover:text-fg"
        >
          Resume <ArrowRight size={12} />
        </Link>
      </div>
    );
  }

  // not clocked in
  if (shiftActive) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-bad/50 bg-bad-soft px-4 py-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="text-bad" />
          <span className="text-sm text-fg">
            Not clocked in
            {status.shift_start &&
              ` · shift started ${status.shift_start.slice(0, 5)}`}
          </span>
        </div>
        <Link
          href="/time-tracker"
          className="flex items-center gap-1 rounded-control bg-accent px-3 py-1 font-display text-xs text-accent-ink hover:bg-accent-hover"
        >
          Clock in now <ArrowRight size={12} />
        </Link>
      </div>
    );
  }

  // outside shift hours — minimal indicator
  return null;
}
