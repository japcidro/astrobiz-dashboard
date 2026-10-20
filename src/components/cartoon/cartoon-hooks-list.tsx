"use client";

import { AlertTriangle, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import { MAX_VARIANTS, STYLES, roughEstimate } from "@/lib/cartoon/engines";
import type { CartoonHookSummary, CartoonResolution, CartoonStyle, CartoonVoice } from "@/lib/cartoon/types";
import { Button, Chip, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo } from "@/components/remake/clip-video";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
const VOICE_KEY = "cartoon-hooks:voice";
/** A picker value: "<provider>:<voice id>". */
const voiceKey = (v: CartoonVoice) => `${v.provider}:${v.id}`;

export const HOOK_STATUS: Record<CartoonHookSummary["status"], { tone: "run" | "ok" | "bad"; label: string }> = {
  planning: { tone: "run", label: "Claude is planning" },
  working: { tone: "run", label: "Making" },
  done: { tone: "ok", label: "Ready" },
  failed: { tone: "bad", label: "Failed" },
};

interface Form {
  script: string;
  direction: string;
  style: CartoonStyle;
  resolution: CartoonResolution;
  voiceOn: boolean;
  voiceId: string;
  variants: number;
}

/**
 * Cartoon Generator: paste a script, Claude splits it into 2-3 second beats, and
 * the Mac worker makes the character, a starting image and a clip per beat,
 * and joins them into one vertical hook. Captions are added in CapCut.
 */
export function CartoonHooksList() {
  const [hooks, setHooks] = useState<CartoonHookSummary[] | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [elevenVoices, setElevenVoices] = useState<CartoonVoice[]>([]);
  const [elevenError, setElevenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>({ script: "", direction: "", style: "mixed", resolution: "480p", voiceOn: false, voiceId: "", variants: 1 });

  const refresh = useCallback(async () => {
    try {
      setHooks((await api<{ hooks: CartoonHookSummary[] }>("/api/owner/cartoon-hooks")).hooks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void refresh();
    let saved = "";
    try {
      saved = localStorage.getItem(VOICE_KEY) ?? "";
    } catch {
      // no storage: pick again
    }
    Promise.all([
      api<WorkerStatus>("/api/owner/hook-studio/status").catch(() => null),
      api<{ voices: CartoonVoice[]; error: string | null }>("/api/owner/cartoon-hooks/voices").catch((e) => ({ voices: [] as CartoonVoice[], error: e instanceof Error ? e.message : "Could not load" })),
    ]).then(([w, el]) => {
      if (w) setWorker(w);
      setElevenVoices(el.voices);
      setElevenError(el.error);
      // The last voice used here, else the team's first ElevenLabs voice, else their first Higgsfield voice.
      const higgs = (w?.voices ?? []).map((v) => ({ provider: "higgsfield" as const, id: v.id, name: v.name, type: v.type }));
      const all = [...el.voices, ...higgs];
      const pick = all.find((v) => voiceKey(v) === saved) ?? el.voices[0] ?? higgs.find((v) => v.type === "element");
      if (pick) setForm((f) => (f.voiceId ? f : { ...f, voiceId: voiceKey(pick) }));
    });
  }, [refresh]);

  const working = !!hooks?.some((h) => h.status === "planning" || h.status === "working");
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 6_000 : 45_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  // The team's own ElevenLabs voices (FOLIQ) first, then their Higgsfield voices, then Higgsfield's presets.
  const higgsVoices = useMemo<CartoonVoice[]>(() => (worker?.voices ?? []).map((v) => ({ provider: "higgsfield", id: v.id, name: v.name, type: v.type })), [worker]);
  const higgsOwn = higgsVoices.filter((v) => v.type === "element");
  const higgsPresets = higgsVoices.filter((v) => v.type !== "element");
  const voice = [...elevenVoices, ...higgsVoices].find((v) => voiceKey(v) === form.voiceId) ?? null;
  // ElevenLabs lines are billed on the team's ElevenLabs plan, not in Higgsfield credits.
  const rough = roughEstimate(form.script, form.resolution, form.voiceOn && voice?.provider === "higgsfield");

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ hooks: CartoonHookSummary[] }>("/api/owner/cartoon-hooks", {
        method: "POST",
        body: JSON.stringify({
          script: form.script,
          direction: form.direction,
          style: form.style,
          resolution: form.resolution,
          voice_on: form.voiceOn,
          voice_provider: voice?.provider ?? "higgsfield",
          voice_id: voice?.id ?? null,
          voice_type: voice?.type ?? null,
          voice_name: voice?.name ?? null,
          variants: form.variants,
        }),
      });
      setHooks(r.hooks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/owner/cartoon-hooks/${id}`, { method: "DELETE" });
      setHooks((hs) => (hs ?? []).filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Sparkles size={22} className="text-purple-400" /> Cartoon Generator
          </h1>
          <p className="text-sm text-gray-500 mt-1">Paste a script. Claude splits it into 2–3 second beats, and the Mac makes a cartoon image and a clip for each one, then joins them into one vertical video. Mascot world makes the subject itself the character, like the hair-strand film. Add captions in CapCut.</p>
        </div>
        {worker && (
          <span className="text-xs text-gray-400 inline-flex items-center gap-1.5 mt-2">
            <span className={`w-2 h-2 rounded-full ${worker.online ? "bg-green-400" : "bg-red-400"}`} />
            {worker.online ? `Mac worker online · ${credits(worker.credits)}` : "Mac worker offline: hooks wait until it is back"}
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <Panel className="space-y-3">
        <Label>New hook</Label>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
          <div className="space-y-3">
            <textarea
              value={form.script}
              onChange={(e) => setForm({ ...form, script: e.target.value })}
              rows={7}
              placeholder="Mag ingat! Hindi ito ordinaryong taba. Normal lang daw, sabi ng iba. Pero bakit may mga lalaking lagpas kwarenta na active pa rin?"
              className={`${field} resize-y`}
            />
            <input
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value })}
              placeholder="Notes for Claude (optional): main character is a Filipino tito, 45, with a big belly; or for Mascot world: the hair strands are the cast, the shampoo bottle is the villain"
              className={field}
            />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">Look</p>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <span key={s.id} title={s.blurb}>
                    <Chip on={form.style === s.id} onClick={() => setForm({ ...form, style: s.id })}>
                      {s.name}
                    </Chip>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-gray-600 mt-1">{STYLES.find((s) => s.id === form.style)?.blurb}</p>
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
              <span className="text-[11px] text-gray-600">{form.resolution === "480p" ? "Cheapest; what you tested" : "Sharper, twice the clip cost"}</span>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={form.voiceOn} onChange={(e) => setForm({ ...form, voiceOn: e.target.checked })} className="accent-purple-500" />
                Voiceover (ElevenLabs, each beat timed to its line)
              </label>
              {form.voiceOn && (
                <select
                  value={form.voiceId}
                  onChange={(e) => {
                    setForm({ ...form, voiceId: e.target.value });
                    try {
                      localStorage.setItem(VOICE_KEY, e.target.value);
                    } catch {
                      // not saved; fine
                    }
                  }}
                  className={`${field} !py-1.5 text-xs`}
                >
                  <option value="">Pick a voice…</option>
                  {[
                    { label: "Your ElevenLabs voices", list: elevenVoices },
                    { label: "Your Higgsfield voices", list: higgsOwn },
                    { label: "Higgsfield presets", list: higgsPresets },
                  ]
                    .filter((g) => g.list.length > 0)
                    .map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.list.map((v) => (
                          <option key={voiceKey(v)} value={voiceKey(v)}>
                            {v.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              )}
              {form.voiceOn && elevenError && <p className="text-[11px] text-amber-300">Your ElevenLabs voices could not load: {elevenError}</p>}
              {!form.voiceOn && <p className="text-[11px] text-gray-600">Off: beats follow Claude&apos;s timing and the hook is silent, ready for your CapCut voiceover.</p>}
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
              <span className="text-[11px] text-gray-600">Each take is a different visual idea for the same script</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <Button primary onClick={() => void generate()} busy={busy} disabled={busy || !form.script.trim() || (form.voiceOn && !voice)}>
            <Wand2 size={13} /> Make {form.variants > 1 ? `${form.variants} hooks` : "hook"}
          </Button>
          {form.script.trim() && (
            <span className="text-xs text-gray-400">
              About {rough.beats} beats · ≈ {credits(rough.credits * form.variants)}
              {form.variants > 1 ? ` for ${form.variants}` : ""} · usually 5–10 min
            </span>
          )}
        </div>
      </Panel>

      <Panel>
        <Label>Hooks · {hooks?.length ?? 0}</Label>
        {hooks === null ? (
          <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
        ) : hooks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center my-10">Nothing yet. Paste a script above and press Make hook.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {hooks.map((h) => (
              <HookCard key={h.id} hook={h} onDelete={() => void remove(h.id)} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function HookCard({ hook: h, onDelete }: { hook: CartoonHookSummary; onDelete: () => void }) {
  const st = HOOK_STATUS[h.status];
  const progress =
    h.status === "planning"
      ? "Splitting the script…"
      : h.status === "working"
        ? h.final_status === "running" || h.final_status === "queued"
          ? "Joining the beats…"
          : `Images ${h.stills_done}/${h.beats_total} · clips ${h.clips_done}/${h.beats_total}`
        : h.status === "failed"
          ? h.error ?? "Failed"
          : `${h.beats_total} beats · ${h.final_seconds ?? "?"} s`;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-2 flex flex-col gap-1.5">
      <Link href={`/owner/cartoon-generator/${h.id}`} className="relative block aspect-[9/16] rounded-lg overflow-hidden bg-black">
        {h.final_url ? (
          <ClipVideo src={h.final_url} poster={h.cover_url} className="h-full" hoverOnly />
        ) : h.cover_url || h.character_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(h.cover_url ?? h.character_url)!} alt="" className="w-full h-full object-cover opacity-70" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">{h.status === "failed" ? <AlertTriangle size={18} className="text-red-300" /> : <Loader2 size={18} className="animate-spin text-purple-300" />}</div>
        )}
      </Link>
      <Link href={`/owner/cartoon-generator/${h.id}`} className="text-[12px] text-white font-semibold truncate hover:text-purple-200" title={h.title}>
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
