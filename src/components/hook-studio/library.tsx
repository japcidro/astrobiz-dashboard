"use client";

import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SKILLS, getEngine } from "@/lib/hook-studio/engines";
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
        <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">Pick a UGC image, choose a skill, and get a silent 9:16 clip back.</p>
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
              <th className="px-4 py-2.5" />
              <th className="text-left px-3 py-2.5 font-semibold">Hook</th>
              <th className="text-left px-3 py-2.5 font-semibold">Skill · engine</th>
              <th className="text-left px-3 py-2.5 font-semibold">Clips</th>
              <th className="text-left px-3 py-2.5 font-semibold">Status</th>
              <th className="text-right px-3 py-2.5 font-semibold">Credits</th>
              <th className="text-left px-3 py-2.5 font-semibold">When</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tone = r.clips_pending > 0 ? "run" : r.clips_failed > 0 && r.clips_done === 0 ? "bad" : r.clips_done > 0 ? "ok" : "muted";
              const status = r.clips_pending > 0 ? "Rendering" : r.clips_done > 0 ? "Ready" : r.clips_failed > 0 ? "Failed" : "Draft";
              return (
                <tr key={r.id} className="border-b border-gray-800 hover:bg-white/[0.03]">
                  <td className="pl-4 py-2 w-12">
                    {r.ugc_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URL
                      <img src={r.ugc_url} alt="" className="w-9 aspect-[9/16] object-cover rounded-md border border-gray-700" />
                    ) : (
                      <div className="w-9 aspect-[9/16] rounded-md bg-gray-900 border border-gray-700" />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => onOpen(r.id)} className="text-left cursor-pointer">
                      <p className="text-white font-medium">{r.title}</p>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-gray-300">
                    {SKILLS.find((s) => s.id === r.skill)?.name ?? r.skill}
                    <span className="text-gray-500"> · {getEngine(r.engine ?? "")?.name ?? "—"} · {r.duration}s</span>
                  </td>
                  <td className="px-3 py-3 text-gray-300">
                    {r.clips_done} ready{r.clips_pending > 0 ? `, ${r.clips_pending} rendering` : ""}
                    {r.clips_failed > 0 ? `, ${r.clips_failed} failed` : ""}
                  </td>
                  <td className="px-3 py-3">
                    <Pill tone={tone}>{status}</Pill>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-gray-300 tabular-nums">{credits(r.credits)}</td>
                  <td className="px-3 py-3 text-gray-400">{timeAgo(r.created_at)}</td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" onClick={() => remove(r)} title="Delete hook and its clips" className="text-gray-600 hover:text-red-300 cursor-pointer">
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
          Clips are copied to our own storage when they finish, so links never expire. <b className="text-gray-300">This month: {credits(monthCredits)}</b>
        </span>
        <Button primary onClick={onNew}>
          <Plus size={16} /> New hook
        </Button>
      </div>
    </Panel>
  );
}
