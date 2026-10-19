"use client";

import { AlertTriangle, Loader2, Microscope, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import type { CartoonHookSummary, CartoonResolution } from "@/lib/cartoon/types";
import { MAX_VARIANTS, MOVES, roughEstimate } from "@/lib/science-broll/engines";
import { Button, Chip, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo } from "@/components/remake/clip-video";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
const BRANDS = ["", "FOLIQ", "I Love Patches", "NURTELLE", "CAPSULED"];

export const PROJECT_STATUS: Record<CartoonHookSummary["status"], { tone: "run" | "ok" | "bad"; label: string }> = {
  planning: { tone: "run", label: "Claude is planning" },
  working: { tone: "run", label: "Making" },
  done: { tone: "ok", label: "Ready" },
  failed: { tone: "bad", label: "Failed" },
};

interface Form {
  text: string;
  direction: string;
  brand: string;
  resolution: CartoonResolution;
  variants: number;
}

/**
 * Science B-roll Generator: text in, textbook-style cross-section clips out.
 * Claude plans one science move per beat, the Mac draws a style anchor and a
 * still per beat (checked by Claude before it moves), animates each, and
 * joins them. No captions; CapCut adds them.
 */
export function ScienceBrollList() {
  const [projects, setProjects] = useState<CartoonHookSummary[] | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>({ text: "", direction: "", brand: "", resolution: "480p", variants: 1 });

  const refresh = useCallback(async () => {
    try {
      setProjects((await api<{ projects: CartoonHookSummary[] }>("/api/owner/science-broll")).projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void refresh();
    api<WorkerStatus>("/api/owner/hook-studio/status").then(setWorker).catch(() => {});
  }, [refresh]);

  const working = !!projects?.some((h) => h.status === "planning" || h.status === "working");
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 6_000 : 45_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const rough = roughEstimate(form.text, form.resolution);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ projects: CartoonHookSummary[] }>("/api/owner/science-broll", {
        method: "POST",
        body: JSON.stringify({ text: form.text, direction: form.direction, brand: form.brand, resolution: form.resolution, variants: form.variants }),
      });
      setProjects(r.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/owner/science-broll/${id}`, { method: "DELETE" });
      setProjects((hs) => (hs ?? []).filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Microscope size={22} className="text-purple-400" /> Science B-roll Generator
          </h1>
          <p className="text-sm text-gray-500 mt-1">Text in, textbook-style cross-section clips out. Claude plans one science move per beat, the Mac draws and animates, and every still is checked before it moves. Captions go on in CapCut.</p>
        </div>
        {worker && (
          <span className="text-xs text-gray-400 inline-flex items-center gap-1.5 mt-2">
            <span className={`w-2 h-2 rounded-full ${worker.online ? "bg-green-400" : "bg-red-400"}`} />
            {worker.online ? `Mac worker online · ${credits(worker.credits)}` : "Mac worker offline: sets wait until it is back"}
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <Panel className="space-y-3">
        <Label>New set</Label>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
          <div className="space-y-3">
            <textarea
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              rows={7}
              placeholder={"Pills lose up to 70% of their potency in your stomach acid and liver before your blood ever sees them.\nThe patch goes through your skin instead, straight into the bloodstream, a steady release for 8 to 12 hours."}
              className={`${field} resize-y`}
            />
            <input value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} placeholder='Notes for Claude (optional): "show the patch on a forearm", "no capsules on screen", "gut wall only"' className={field} />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">Brand · optional, for the product form</p>
              <div className="flex flex-wrap gap-1.5">
                {BRANDS.map((b) => (
                  <Chip key={b || "none"} on={form.brand === b} onClick={() => setForm({ ...form, brand: b })}>
                    {b || "none"}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-gray-400">Clips</span>
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {(["480p", "720p"] as CartoonResolution[]).map((r) => (
                  <button key={r} type="button" onClick={() => setForm({ ...form, resolution: r })} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${form.resolution === r ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {r}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-gray-600">{form.resolution === "480p" ? "0.5 cr per second" : "1 cr per second, sharper"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400">Takes</span>
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {Array.from({ length: MAX_VARIANTS }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setForm({ ...form, variants: n })} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${form.variants === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-gray-600">Each take is a different visual idea for the same text</span>
            </div>
            <p className="text-[11px] text-gray-600">Moves the skill knows: {MOVES.map((m) => m.name).join(" · ")}.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <Button primary onClick={() => void generate()} busy={busy} disabled={busy || !form.text.trim()}>
            <Wand2 size={13} /> Make {form.variants > 1 ? `${form.variants} sets` : "the b-roll"}
          </Button>
          {form.text.trim() && (
            <span className="text-xs text-gray-400">
              About {rough.beats} beats · ≈ {credits(rough.credits * form.variants)}
              {form.variants > 1 ? ` for ${form.variants}` : ""} · usually 6–12 min
            </span>
          )}
        </div>
      </Panel>

      <Panel>
        <Label>Sets · {projects?.length ?? 0}</Label>
        {projects === null ? (
          <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-500 text-center my-10">Nothing yet. Write what to show above and press Make the b-roll.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {projects.map((h) => (
              <ProjectCard key={h.id} project={h} onDelete={() => void remove(h.id)} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ProjectCard({ project: h, onDelete }: { project: CartoonHookSummary; onDelete: () => void }) {
  const st = PROJECT_STATUS[h.status];
  const progress =
    h.status === "planning"
      ? "Planning the shots…"
      : h.status === "working"
        ? h.final_status === "running" || h.final_status === "queued"
          ? "Joining the clips…"
          : `Stills ${h.stills_done}/${h.beats_total} · clips ${h.clips_done}/${h.beats_total}`
        : h.status === "failed"
          ? h.error ?? "Failed"
          : `${h.beats_total} clips · ${h.final_seconds ?? "?"} s`;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-2 flex flex-col gap-1.5">
      <Link href={`/owner/science-broll/${h.id}`} className="relative block aspect-[9/16] rounded-lg overflow-hidden bg-black">
        {h.final_url ? (
          <ClipVideo src={h.final_url} poster={h.cover_url} className="h-full" hoverOnly />
        ) : h.cover_url || h.character_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(h.cover_url ?? h.character_url)!} alt="" className="w-full h-full object-cover opacity-70" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">{h.status === "failed" ? <AlertTriangle size={18} className="text-red-300" /> : <Loader2 size={18} className="animate-spin text-purple-300" />}</div>
        )}
      </Link>
      <Link href={`/owner/science-broll/${h.id}`} className="text-[12px] text-white font-semibold truncate hover:text-purple-200" title={h.title}>
        {h.title}
      </Link>
      <p className={`text-[11px] line-clamp-2 ${h.status === "failed" ? "text-red-300" : "text-gray-400"}`}>{progress}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill tone={st.tone}>{st.label}</Pill>
        <span className="text-[10px] text-gray-600">{timeAgo(h.created_at)}</span>
        <ConfirmButton question="Delete?" label="Delete" onConfirm={onDelete} className="ml-auto text-gray-500 hover:text-red-300 cursor-pointer">
          <Trash2 size={11} />
        </ConfirmButton>
      </div>
      {h.credits > 0 && <p className="text-[10px] text-gray-600">Spent {credits(h.credits)}</p>}
    </div>
  );
}
