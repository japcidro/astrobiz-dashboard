"use client";

import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LANES } from "@/lib/hook-studio/presets";
import type { LibraryRow } from "@/lib/hook-studio/types";
import { Panel, Button, Pill, credits, timeAgo, api } from "./ui";

export function Library({
  rows,
  monthCredits,
  onOpen,
  onNew,
  onChanged,
}: {
  rows: LibraryRow[];
  monthCredits: number;
  onOpen: (id: string) => void;
  onNew: () => void;
  onChanged: () => void;
}) {
  const remove = async (r: LibraryRow) => {
    try {
      await api(`/api/owner/hook-studio/hooks/${r.id}`, { method: "DELETE" });
      toast.success("Hook deleted");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (rows.length === 0) {
    return (
      <Panel className="text-center py-12">
        <p className="text-white font-semibold">No hooks yet</p>
        <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
          Drop in a UGC clip that already works and get it back with a new person, silent, ready for text.
        </p>
        <div className="mt-5">
          <Button primary onClick={onNew}>
            <Plus size={16} /> New hook
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
              <th className="text-left px-4 py-2.5 font-semibold">Hook</th>
              <th className="text-left px-3 py-2.5 font-semibold">Lane</th>
              <th className="text-left px-3 py-2.5 font-semibold">Remakes</th>
              <th className="text-left px-3 py-2.5 font-semibold">Status</th>
              <th className="text-right px-3 py-2.5 font-semibold">Credits</th>
              <th className="text-left px-3 py-2.5 font-semibold">When</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tone = r.remakes_pending > 0 ? "run" : r.remakes_failed > 0 && r.remakes_done === 0 ? "bad" : r.remakes_done > 0 ? "ok" : "muted";
              const status =
                r.remakes_pending > 0 ? "Rendering" : r.remakes_done > 0 ? "Ready" : r.remakes_failed > 0 ? "Failed" : "Draft";
              return (
                <tr key={r.id} className="border-b border-gray-800 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onOpen(r.id)} className="text-left cursor-pointer">
                      <p className="text-white font-medium">{r.title}</p>
                      <p className="text-xs text-gray-500">{r.creator}</p>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-gray-300">{LANES.find((l) => l.id === r.lane)?.label ?? r.lane}</td>
                  <td className="px-3 py-3 text-gray-300">
                    {r.remakes_done} ready{r.remakes_pending > 0 ? `, ${r.remakes_pending} rendering` : ""}
                    {r.remakes_failed > 0 ? `, ${r.remakes_failed} failed` : ""}
                  </td>
                  <td className="px-3 py-3">
                    <Pill tone={tone}>{status}</Pill>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-gray-300 tabular-nums">{credits(r.credits)}</td>
                  <td className="px-3 py-3 text-gray-400">{timeAgo(r.created_at)}</td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" onClick={() => remove(r)} title="Delete hook and its files" className="text-gray-600 hover:text-red-300 cursor-pointer">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between gap-3 flex-wrap text-xs text-gray-500">
        <span>
          Files are copied to our own storage when they finish, so links never expire. <b className="text-gray-300">This month: {credits(monthCredits)}</b>
        </span>
        <Button primary onClick={onNew}>
          <Plus size={16} /> New hook
        </Button>
      </div>
    </Panel>
  );
}
