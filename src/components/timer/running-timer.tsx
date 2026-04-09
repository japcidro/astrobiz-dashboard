"use client";

import { useState, useEffect, useTransition } from "react";
import { Play, Pause, Square, Coffee } from "lucide-react";
import { startTimer, pauseTimer, resumeTimer, stopTimer } from "@/lib/time-actions";
import type { TimeEntry, TimePause } from "@/lib/types";

interface RunningTimerProps {
  activeEntry: (TimeEntry & { time_pauses: TimePause[] }) | null;
}

export function RunningTimer({ activeEntry }: RunningTimerProps) {
  const [seconds, setSeconds] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Calculate initial seconds from active entry
  useEffect(() => {
    if (!activeEntry) {
      setSeconds(0);
      return;
    }

    const calculateElapsed = () => {
      const startedAt = new Date(activeEntry.started_at).getTime();
      const now = Date.now();
      let elapsed = now - startedAt;

      // Subtract pause durations
      for (const pause of activeEntry.time_pauses || []) {
        const pauseStart = new Date(pause.paused_at).getTime();
        const pauseEnd = pause.resumed_at
          ? new Date(pause.resumed_at).getTime()
          : now;
        elapsed -= pauseEnd - pauseStart;
      }

      return Math.max(0, Math.floor(elapsed / 1000));
    };

    setSeconds(calculateElapsed());

    // Only tick if running
    if (activeEntry.status === "running") {
      const interval = setInterval(() => {
        setSeconds(calculateElapsed());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [activeEntry]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

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
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-6">Timer</h2>

      {/* Timer Display */}
      <div className="text-center mb-8">
        <div className="text-6xl font-mono font-bold text-white tracking-wider">
          {formatTime(seconds)}
        </div>
        <div className="mt-2">
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 text-green-400 text-sm">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Running
            </span>
          )}
          {isPaused && (
            <span className="inline-flex items-center gap-1.5 text-yellow-400 text-sm">
              <Coffee size={14} />
              Paused (on break)
            </span>
          )}
          {!hasSession && (
            <span className="text-gray-500 text-sm">Ready to start</span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm text-center">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        {!hasSession && (
          <button
            onClick={() => handleAction(startTimer)}
            disabled={isPending}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Play size={20} />
            Start Work
          </button>
        )}

        {isRunning && (
          <>
            <button
              onClick={() =>
                handleAction(() => pauseTimer(activeEntry!.id))
              }
              disabled={isPending}
              className="flex items-center gap-2 bg-yellow-600 hover:bg-yellow-500 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Pause size={20} />
              Take Break
            </button>
            <button
              onClick={() =>
                handleAction(() => stopTimer(activeEntry!.id))
              }
              disabled={isPending}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Square size={20} />
              Clock Out
            </button>
          </>
        )}

        {isPaused && (
          <>
            <button
              onClick={() =>
                handleAction(() => resumeTimer(activeEntry!.id))
              }
              disabled={isPending}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Play size={20} />
              Resume Work
            </button>
            <button
              onClick={() =>
                handleAction(() => stopTimer(activeEntry!.id))
              }
              disabled={isPending}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Square size={20} />
              Clock Out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
