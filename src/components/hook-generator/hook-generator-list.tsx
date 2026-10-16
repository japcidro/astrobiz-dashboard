"use client";

import { AlertTriangle, Hand, Loader2, Trash2, Upload, Users, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WorkerStatus } from "@/lib/hook-studio/types";
import type { CastSource, PersonLibrary } from "@/lib/remake/types";
import { BEAT_KINDS, DEFAULT_BEATS, IMAGE_MODELS, MAX_REFS, MAX_VARIANTS, REF_ROLES, VIDEO_MODELS, estimateCredits } from "@/lib/hook-generator/engines";
import type { BeatKind, HookgenSummary, ImageModel, RefRole, VideoModel } from "@/lib/hook-generator/types";
import { Button, Chip, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { ClipVideo } from "@/components/remake/clip-video";
import { CastPicker } from "@/components/remake/cast-picker";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** The role a new reference gets from its position: expert, then client, then setting. */
const ROLE_BY_POSITION: RefRole[] = ["expert", "client", "setting", "product", "style", "style"];

/** A reference on the form: an uploaded photo or a library person, with a preview. */
interface RefDraft {
  key: string;
  path?: string;
  person_id?: string;
  name: string;
  role: RefRole;
  url: string;
}

interface Form {
  direction: string;
  line: string;
  kinds: BeatKind[];
  image: ImageModel;
  video: VideoModel;
  variants: number;
}

/** What a hook is doing, for the card and the detail page. */
export function hookProgress(h: HookgenSummary): { tone: "run" | "ok" | "bad" | "warn"; label: string; detail: string } {
  if (h.status === "planning") return { tone: "run", label: "Claude is planning", detail: "Planning the beats…" };
  if (h.status === "failed") return { tone: "bad", label: "Failed", detail: h.error ?? "Failed" };
  if (h.status === "done") return { tone: "ok", label: "Ready", detail: `${h.beats_total} beats · ${h.final_seconds ?? "?"} s` };
  if (h.status === "stills") {
    return h.stills_done < h.beats_total
      ? { tone: "run", label: "Drawing", detail: `Starting images ${h.stills_done}/${h.beats_total}` }
      : { tone: "warn", label: "Needs your OK", detail: `Approved ${h.approved}/${h.beats_total}: approve to animate` };
  }
  if (h.final_status === "queued" || h.final_status === "running") return { tone: "run", label: "Joining", detail: "Joining the beats…" };
  if (h.final_status === "failed") return { tone: "bad", label: "Join failed", detail: h.final_error ?? "Join failed" };
  return { tone: "run", label: "Animating", detail: `Clips ${h.clips_done}/${h.beats_total} · head taps checked ${h.checks_done}/${h.beats_total}` };
}

/**
 * Hook Generator: reference images and a direction in, head-tap hooks out.
 * Claude plans one beat per head-tap move; the Mac draws a starting image per
 * beat; once every image of a hook is approved, the Mac animates the beats,
 * checks each clip for the hand on the head, and joins them. Captions are
 * added in CapCut.
 */
export function HookGeneratorList() {
  const [hooks, setHooks] = useState<HookgenSummary[] | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState<RefDraft[]>([]);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>({ direction: "", line: "", kinds: DEFAULT_BEATS, image: "seedream_5_0_flash", video: "veo3_1", variants: 2 });

  const refresh = useCallback(async () => {
    try {
      setHooks((await api<{ hooks: HookgenSummary[] }>("/api/owner/hook-generator")).hooks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void refresh();
    api<WorkerStatus>("/api/owner/hook-studio/status")
      .then(setWorker)
      .catch(() => null);
  }, [refresh]);

  const working = !!hooks?.some((h) => h.status === "planning" || h.status === "working" || (h.status === "stills" && h.stills_done < h.beats_total));
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 6_000 : 45_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const addRef = (r: Omit<RefDraft, "key" | "role">) =>
    setRefs((rs) => (rs.length >= MAX_REFS ? rs : [...rs, { ...r, key: crypto.randomUUID(), role: ROLE_BY_POSITION[rs.length] ?? "style" }]));

  const upload = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => IMAGE_TYPES.has(f.type)).slice(0, Math.max(0, MAX_REFS - refs.length));
    if (files.length === 0) {
      setError(refs.length >= MAX_REFS ? `Up to ${MAX_REFS} reference images` : "Add PNG, JPG or WebP images");
      return;
    }
    setError(null);
    setUploading((n) => n + files.length);
    const supabase = createClient();
    for (const file of files) {
      try {
        const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/hook-generator/upload-url", { method: "POST", body: JSON.stringify({ mime: file.type }) });
        const up = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        addRef({ path, name: file.name.replace(/\.[a-z0-9]+$/i, ""), url: URL.createObjectURL(file) });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const pickPerson = async (body: CastSource) => {
    if (!body.person_id) return;
    const lib = await api<PersonLibrary>("/api/owner/remake/library");
    const person = lib.people.find((p) => p.id === body.person_id);
    if (!person) throw new Error("That person is no longer in the library");
    addRef({ person_id: person.id, name: person.name, url: person.url });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  const toggleKind = (k: BeatKind) =>
    setForm((f) => ({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] }));

  const estimate = estimateCredits({ beats: form.kinds.length, image: form.image, video: form.video });

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ hooks: HookgenSummary[] }>("/api/owner/hook-generator", {
        method: "POST",
        body: JSON.stringify({
          direction: form.direction,
          line: form.line,
          kinds: form.kinds,
          refs: refs.map((r) => ({ path: r.path, person_id: r.person_id, role: r.role, name: r.name })),
          image_model: form.image,
          video_model: form.video,
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
      await api(`/api/owner/hook-generator/${id}`, { method: "DELETE" });
      setHooks((hs) => (hs ?? []).filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  return (
    <div className="max-w-7xl space-y-5">
      {picker && <CastPicker current={null} onPick={pickPerson} onClose={() => setPicker(false)} />}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Hand size={22} className="text-purple-400" /> Hook Generator
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Reference images and a direction in, head-tap hooks out. You approve each starting image; then the Mac animates the beats, checks that a hand really touches the head, and joins them. Add captions in CapCut.
          </p>
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
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div className="space-y-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-xl border border-dashed p-3 transition-colors ${dragOver ? "border-purple-400 bg-purple-500/10" : "border-gray-700"}`}
            >
              <p className="text-[11px] text-gray-400 mb-2">Reference images · up to {MAX_REFS} · drop photos here</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {refs.map((r) => (
                  <div key={r.key} className="space-y-1">
                    <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setRefs((rs) => rs.filter((x) => x.key !== r.key))}
                        className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 text-gray-300 hover:text-white cursor-pointer"
                        aria-label="Remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <select
                      value={r.role}
                      onChange={(e) => setRefs((rs) => rs.map((x) => (x.key === r.key ? { ...x, role: e.target.value as RefRole } : x)))}
                      className="w-full bg-gray-900 border border-gray-700 rounded-md px-1.5 py-1 text-[11px] text-gray-200"
                      title="Who or what this image is"
                    >
                      {REF_ROLES.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                {Array.from({ length: uploading }, (_, i) => (
                  <div key={`up-${i}`} className="aspect-[3/4] rounded-lg bg-gray-900 flex items-center justify-center">
                    <Loader2 size={16} className="animate-spin text-purple-300" />
                  </div>
                ))}
                {refs.length + uploading < MAX_REFS && (
                  <div className="aspect-[3/4] rounded-lg border border-gray-700 flex flex-col items-stretch justify-center gap-1.5 p-1.5">
                    <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-gray-300 hover:text-white inline-flex items-center justify-center gap-1 rounded-md bg-gray-900 py-1.5 cursor-pointer">
                      <Upload size={12} /> Upload
                    </button>
                    <button type="button" onClick={() => setPicker(true)} className="text-[11px] text-gray-300 hover:text-white inline-flex items-center justify-center gap-1 rounded-md bg-gray-900 py-1.5 cursor-pointer">
                      <Users size={12} /> Library
                    </button>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <textarea
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value })}
              rows={4}
              placeholder="Filipino hair expert in a bright salon. A woman with a thin crown sits with her back to camera; he taps it twice, then parts a second woman's hair to show the scalp."
              className={`${field} resize-y`}
            />
            <input value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} placeholder="Spoken line (blank = Claude writes one): If your part looks like this, it's hormonal." className={field} />
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">Head-tap moves · one beat each, in the order you pick them</p>
              <div className="flex flex-wrap gap-1.5">
                {BEAT_KINDS.map((k) => {
                  const n = form.kinds.indexOf(k.id);
                  return (
                    <Chip key={k.id} on={n >= 0} onClick={() => toggleKind(k.id)}>
                      {n >= 0 ? `${n + 1} · ` : ""}
                      {k.name}
                    </Chip>
                  );
                })}
              </div>
              {form.kinds.length === 0 && <p className="text-[11px] text-amber-300 mt-1">Pick at least one: the hand on the head is the scroll stopper.</p>}
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">Starting images</p>
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_MODELS.map((m) => (
                  <span key={m.id} title={m.blurb}>
                    <Chip on={form.image === m.id} onClick={() => setForm({ ...form, image: m.id })}>
                      {m.name} · {credits(m.credits)}
                    </Chip>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">Video</p>
              <div className="flex flex-wrap gap-1.5">
                {VIDEO_MODELS.map((m) => (
                  <span key={m.id} title={m.blurb}>
                    <Chip on={form.video === m.id} onClick={() => setForm({ ...form, video: m.id })}>
                      {m.name}
                    </Chip>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-gray-600 mt-1">{VIDEO_MODELS.find((m) => m.id === form.video)?.blurb}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400">Variations</span>
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {Array.from({ length: MAX_VARIANTS }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setForm({ ...form, variants: n })} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${form.variants === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <Button primary onClick={() => void generate()} busy={busy} disabled={busy || uploading > 0 || form.kinds.length === 0 || (!form.direction.trim() && refs.length === 0)}>
            <Wand2 size={13} /> Make starting images
          </Button>
          {form.kinds.length > 0 && (
            <span className="text-xs text-gray-400">
              Now: {credits(estimate.stills * form.variants)} for {form.kinds.length * form.variants} starting images · each hook you approve: about {credits(estimate.total)} in all
            </span>
          )}
        </div>
      </Panel>

      <Panel>
        <Label>Hooks · {hooks?.length ?? 0}</Label>
        {hooks === null ? (
          <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
        ) : hooks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center my-10">Nothing yet. Add reference images and a direction above, then press Make starting images.</p>
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

function HookCard({ hook: h, onDelete }: { hook: HookgenSummary; onDelete: () => void }) {
  const p = hookProgress(h);
  const href = `/owner/hook-generator/${h.id}`;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-2 flex flex-col gap-1.5">
      <Link href={href} className="relative block aspect-[9/16] rounded-lg overflow-hidden bg-black">
        {h.final_url ? (
          <ClipVideo src={h.final_url} poster={h.cover_url} className="h-full" hoverOnly />
        ) : h.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={h.cover_url} alt="" className="w-full h-full object-cover opacity-80" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">{h.status === "failed" ? <AlertTriangle size={18} className="text-red-300" /> : <Loader2 size={18} className="animate-spin text-purple-300" />}</div>
        )}
      </Link>
      <Link href={href} className="text-[12px] text-white font-semibold truncate hover:text-purple-200" title={h.title}>
        {h.title}
      </Link>
      <p className={`text-[11px] line-clamp-2 ${p.tone === "bad" ? "text-red-300" : "text-gray-400"}`}>{p.detail}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill tone={p.tone}>{p.label}</Pill>
        <span className="text-[10px] text-gray-600">{timeAgo(h.created_at)}</span>
        <ConfirmButton question="Delete?" label="Delete" onConfirm={onDelete} className="ml-auto text-gray-500 hover:text-red-300 cursor-pointer">
          <Trash2 size={11} />
        </ConfirmButton>
      </div>
      {h.credits > 0 && <p className="text-[10px] text-gray-600">Spent {credits(h.credits)}</p>}
    </div>
  );
}
