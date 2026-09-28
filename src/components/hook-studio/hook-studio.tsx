"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Plus } from "lucide-react";
import { toast } from "sonner";
import type { LibraryRow, WorkerStatus } from "@/lib/hook-studio/types";
import { NewHook } from "./new-hook";
import { HookWorkspace } from "./hook-workspace";
import { Library } from "./library";
import { Button, Pill, credits, timeAgo, api } from "./ui";

type Mode = { kind: "library" } | { kind: "new" } | { kind: "hook"; id: string };

const STATUS_POLL_MS = 15000;

export function HookStudio() {
  const [mode, setMode] = useState<Mode>({ kind: "library" });
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [monthCredits, setMonthCredits] = useState(0);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);

  // Loaders resolve into state inside promise callbacks, which is what the
  // react-hooks/set-state-in-effect rule asks for.
  const loadLibrary = useCallback(
    () =>
      api<{ hooks: LibraryRow[]; month_credits: number }>("/api/owner/hook-studio/hooks")
        .then((r) => {
          setRows(r.hooks);
          setMonthCredits(r.month_credits);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load the library")),
    []
  );

  const loadWorker = useCallback(
    () =>
      api<WorkerStatus>("/api/owner/hook-studio/status")
        .then(setWorker)
        .catch(() => {
          // keep the last value
        }),
    []
  );

  useEffect(() => {
    void loadWorker();
    const t = setInterval(() => void loadWorker(), STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [loadWorker]);

  // Reload the table each time the library is shown, so a hook just made or
  // deleted is there without a manual refresh.
  useEffect(() => {
    if (mode.kind === "library") void loadLibrary();
  }, [mode, loadLibrary]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Clapperboard size={22} className="text-purple-300" /> Hook Studio
          </h1>
          <p className="text-sm text-gray-500 mt-1">Reference in, remake out. Silent UGC hooks for SoulShot.</p>
        </div>
        <div className="flex items-center gap-2">
          {mode.kind !== "hook" && worker && (
            worker.online ? (
              <Pill tone="ok">
                Mac worker online{worker.credits !== null ? ` · ${credits(worker.credits)}` : ""}
                {worker.queued + worker.running > 0 ? ` · ${worker.queued + worker.running} in queue` : ""}
              </Pill>
            ) : (
              <Pill tone="warn">Mac worker offline{worker.last_seen ? ` · last seen ${timeAgo(worker.last_seen)}` : ""}</Pill>
            )
          )}
          {mode.kind === "library" && rows.length > 0 && (
            <Button primary onClick={() => setMode({ kind: "new" })}>
              <Plus size={16} /> New hook
            </Button>
          )}
        </div>
      </div>

      {mode.kind === "library" && (
        <Library
          rows={rows}
          monthCredits={monthCredits}
          onOpen={(id) => setMode({ kind: "hook", id })}
          onNew={() => setMode({ kind: "new" })}
          onChanged={loadLibrary}
        />
      )}
      {mode.kind === "new" && (
        <NewHook onCreated={(id) => setMode({ kind: "hook", id })} onCancel={() => setMode({ kind: "library" })} />
      )}
      {mode.kind === "hook" && <HookWorkspace id={mode.id} worker={worker} onBack={() => setMode({ kind: "library" })} />}
    </div>
  );
}
