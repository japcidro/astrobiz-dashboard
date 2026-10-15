"use client";

import { AlertTriangle, Check, Download, Images, Loader2, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { PRESETS, ROLE_LABEL, type Attachment, type AttachmentRole, type ImageFormat, type OutputMode, type PersonMode, type PresetId, type ProductMode, type ResultView, type RunView, type StudioPage, type TextStyle } from "@/lib/image-studio/types";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { Lightbox } from "@/components/remake/clip-video";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
const ROLE_ORDER: AttachmentRole[] = ["reference", "model", "product", "look"];
const ROLE_TONE: Record<AttachmentRole, string> = { reference: "bg-pink-500/20 text-pink-200", model: "bg-purple-500/20 text-purple-200", product: "bg-green-500/20 text-green-200", look: "bg-amber-500/20 text-amber-200" };
const ACCEPT = "image/png,image/jpeg,image/webp";
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

interface Att extends Attachment {
  url: string | null;
}

interface Form {
  preset: PresetId;
  instruction: string;
  product: ProductMode;
  person: PersonMode;
  output: OutputMode;
  format: ImageFormat;
  versions: number;
  text: string;
  textStyle: TextStyle;
  store: string;
}

const elapsedMin = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "under a minute" : `${m} min`;
};

/**
 * Image Studio: say what should come out, attach images with a role
 * (reference, model, product, look), choose product / person / output /
 * format, and Nano Banana Pro renders the versions side by side. Opened
 * from an image card on the board (its image comes in as the reference) or
 * blank from Marketing Tools.
 */
export function ImageStudio() {
  const params = useSearchParams();
  const itemId = params.get("item");
  const [page, setPage] = useState<StudioPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [atts, setAtts] = useState<Att[]>([]);
  const [form, setForm] = useState<Form>({ preset: "adapt", instruction: PRESETS[0].instruction, product: "in", person: "model", output: "single", format: "1:1", versions: 4, text: "", textStyle: "reference", store: "" });
  const [busy, setBusy] = useState<"run" | "keep" | "delete" | null>(null);
  const [picker, setPicker] = useState<"people" | "stills" | "brand" | "board" | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [filesOver, setFilesOver] = useState(false);
  const [zoom, setZoom] = useState<{ image?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const seeded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const p = await api<StudioPage>(`/api/owner/image-studio${itemId ? `?item=${itemId}` : ""}`);
      setPage(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [itemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First load: the board card's image is the reference, its store is the brand.
  useEffect(() => {
    if (!page || seeded.current) return;
    seeded.current = true;
    if (page.item?.path && page.item.url) setAtts([{ bucket: page.item.bucket, path: page.item.path, role: "reference", label: page.item.title ?? "Board image", url: page.item.url }]);
    const store = page.item?.store ?? page.stores[0] ?? "";
    setForm((f) => ({ ...f, store }));
    // Our product photos for that store come along by default.
    const product = page.sources.brand.find((b) => b.store === store && b.kind === "bottle") ?? page.sources.brand.find((b) => b.store === store);
    if (product) setAtts((a) => [...a, { bucket: product.bucket, path: product.path, role: "product", label: `${product.store} · ${product.kind ?? "product"}`, url: product.url }]);
  }, [page]);

  const working = !!page?.runs.some((r) => r.results.some((x) => x.status === "queued" || x.status === "running" || x.brand_check?.notes === "Checking…"));
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const runs = useMemo(() => page?.runs ?? [], [page]);
  const count = form.output === "set3" ? 3 : form.versions;
  const cost = count * STILL_CREDITS;
  const canRun = (form.instruction.trim() || atts.length > 0) && busy === null;

  const applyPreset = (id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setForm((f) => ({ ...f, preset: id, instruction: p.instruction, product: p.product, person: p.person, output: p.output }));
  };

  const addAtt = (a: Att) => {
    setAtts((list) => (list.some((x) => x.path === a.path) ? list : [...list, a]));
    setPicker(null);
  };
  const cycleRole = (i: number) => setAtts((list) => list.map((a, n) => (n === i ? { ...a, role: ROLE_ORDER[(ROLE_ORDER.indexOf(a.role) + 1) % ROLE_ORDER.length] } : a)));

  const uploadFiles = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => ACCEPT.split(",").includes(f.type));
    if (!files.length) {
      setError("Drop PNG, JPG or WebP images");
      return;
    }
    setUploading({ done: 0, total: files.length });
    const supabase = createClient();
    for (const file of files) {
      try {
        const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/marketing-board/upload-url", { method: "POST", body: JSON.stringify({ kind: "studio", mime: file.type }) });
        const up = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (up.error) throw new Error(up.error.message);
        const url = URL.createObjectURL(file);
        setAtts((a) => [...a, { bucket, path, role: atts.length === 0 ? "reference" : "look", label: file.name.replace(/\.[a-z0-9]+$/i, ""), url }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const generate = async () => {
    setBusy("run");
    setError(null);
    try {
      const r = await api<{ id: string; runs: RunView[] }>("/api/owner/image-studio", {
        method: "POST",
        body: JSON.stringify({
          item_id: itemId,
          store: form.store || null,
          preset: form.preset,
          instruction: form.instruction,
          product_mode: form.product,
          person_mode: form.person,
          output: form.output,
          format: form.format,
          versions: form.versions,
          text_on_image: form.text,
          text_style: form.textStyle,
          attachments: atts.map(({ bucket, path, role, label }) => ({ bucket, path, role, label })),
        }),
      });
      setPage((p) => (p ? { ...p, runs: r.runs } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(null);
    }
  };

  const keep = async (id: string) => {
    setBusy("keep");
    try {
      await api(`/api/owner/image-studio/results/${id}/keep`, { method: "POST" });
      setPage((p) => (p ? { ...p, runs: p.runs.map((r) => ({ ...r, results: r.results.map((x) => (x.id === id ? { ...x, kept: true } : x)) })) } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not keep");
    } finally {
      setBusy(null);
    }
  };

  const removeRun = async (id: string) => {
    setBusy("delete");
    try {
      await api(`/api/owner/image-studio/runs/${id}`, { method: "DELETE" });
      setPage((p) => (p ? { ...p, runs: p.runs.filter((r) => r.id !== id) } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  };

  /** A result goes back in as a reference for the next round. */
  const sendBackAsReference = (x: ResultView) => {
    if (!x.path) return;
    addAtt({ bucket: "marketing-board", path: x.path, role: "reference", label: "Earlier result", url: x.preview_url });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reuse = (r: RunView) => {
    setAtts(r.attachments.map((a) => ({ ...a })));
    setForm({ preset: r.preset, instruction: r.instruction, product: r.product_mode, person: r.person_mode, output: r.output, format: r.format, versions: Math.min(4, r.versions), text: r.text_on_image, textStyle: r.text_style, store: r.store ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const seg = <T extends string>(value: T, options: Array<[T, string]>, set: (v: T) => void) => (
    <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => set(v)} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${value === v ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  const sources = page?.sources;

  return (
    <div className="max-w-7xl space-y-5">
      {zoom?.image && <Lightbox image={zoom.image} onClose={() => setZoom(null)} />}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-64">
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Images size={22} className="text-purple-400" /> Image Studio
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {page?.item ? (
              <>
                Making ours from <span className="text-gray-300">{page.item.title || "a board image"}</span> ·{" "}
                <Link href="/owner/marketing-board?tab=images" className="text-purple-300 hover:text-white">
                  back to the board
                </Link>
              </>
            ) : (
              "Say what should come out, attach images with a role, and Nano Banana Pro renders the versions side by side."
            )}
          </p>
        </div>
        {page && (
          <label className="text-xs text-gray-400 inline-flex items-center gap-2">
            Brand
            <select value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-200 focus:outline-none">
              <option value="">No brand kit</option>
              {page.stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        {/* Attachments */}
        <div
          className="relative"
          onDragEnter={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current += 1;
            setFilesOver(true);
          }}
          onDragOver={(e) => hasFiles(e) && e.preventDefault()}
          onDragLeave={(e) => {
            if (!hasFiles(e)) return;
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setFilesOver(false);
          }}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth.current = 0;
            setFilesOver(false);
            void uploadFiles(e.dataTransfer.files);
          }}
        >
          <Panel>
            <Label>Attachments · each one has a job</Label>
            <div className="grid grid-cols-3 gap-2">
              {atts.map((a, i) => (
                <div key={a.path} className="rounded-lg bg-gray-950 border border-gray-800 p-1.5 relative group">
                  <button type="button" onClick={() => a.url && setZoom({ image: a.url })} className="block w-full aspect-square rounded-md overflow-hidden bg-black cursor-zoom-in">
                    {a.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt="" className="w-full h-full object-cover" />
                    )}
                  </button>
                  <button type="button" onClick={() => cycleRole(i)} title="Click to change what this image is for" className={`mt-1.5 w-full rounded-md px-1 py-1 text-[10px] font-bold leading-tight cursor-pointer ${ROLE_TONE[a.role]}`}>
                    {ROLE_LABEL[a.role]}
                  </button>
                  <p className="text-[10px] text-gray-500 mt-1 truncate text-center" title={a.label}>
                    {a.label}
                  </p>
                  <button type="button" onClick={() => setAtts((l) => l.filter((_, n) => n !== i))} aria-label="Remove" className="absolute top-2.5 right-2.5 rounded-md bg-black/70 text-white p-0.5 opacity-0 group-hover:opacity-100 cursor-pointer">
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => fileRef.current?.click()} className="aspect-square rounded-lg border border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 flex flex-col items-center justify-center gap-1 text-[11px] cursor-pointer">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {uploading ? `${uploading.done}/${uploading.total}` : "Add"}
                <span className="text-gray-600">or drop here</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => e.target.files?.length && void uploadFiles(e.target.files)} />
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Button ghost onClick={() => fileRef.current?.click()} className="!px-2 !py-1 !text-xs">
                <Upload size={12} /> Upload
              </Button>
              {(["people", "stills", "brand", "board"] as const).map((k) => (
                <Button key={k} ghost onClick={() => setPicker(picker === k ? null : k)} className={`!px-2 !py-1 !text-xs ${picker === k ? "!bg-white/10 !text-white" : ""}`}>
                  {k === "people" ? "People folders" : k === "stills" ? "Starting images" : k === "brand" ? "Brand kit" : "Board images"}
                </Button>
              ))}
            </div>
            {picker && sources && (
              <div className="mt-3 rounded-lg bg-gray-950 border border-gray-800 p-2 max-h-72 overflow-y-auto">
                {picker === "people" && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {sources.people.map((p) => (
                      <button key={p.id} type="button" onClick={() => addAtt({ bucket: p.bucket, path: p.path, role: "model", label: p.name || "Person", url: p.url })} className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5" title={`${p.folder ?? "Unsorted"} · ${p.name}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="w-full aspect-[9/16] object-cover rounded" loading="lazy" />
                        <p className="text-[9px] text-gray-500 truncate">{p.folder ?? "Unsorted"}</p>
                      </button>
                    ))}
                    {sources.people.length === 0 && <p className="col-span-4 text-xs text-gray-500 p-2">No people yet. Add them in the Clipper&apos;s person picker.</p>}
                  </div>
                )}
                {picker === "stills" && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {sources.stills.map((s) => (
                      <button key={s.id} type="button" onClick={() => addAtt({ bucket: s.bucket, path: s.path, role: "look", label: s.title, url: s.url })} className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5" title={s.title}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt="" className="w-full aspect-[9/16] object-cover rounded" loading="lazy" />
                        <p className="text-[9px] text-gray-500 truncate">{s.title}</p>
                      </button>
                    ))}
                    {sources.stills.length === 0 && <p className="col-span-4 text-xs text-gray-500 p-2">No starting images yet.</p>}
                  </div>
                )}
                {picker === "brand" && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {sources.brand.map((b) => (
                      <button key={b.path} type="button" onClick={() => addAtt({ bucket: b.bucket, path: b.path, role: "product", label: `${b.store} · ${b.kind ?? "product"}`, url: b.url })} className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.url} alt="" className="w-full aspect-square object-cover rounded" loading="lazy" />
                        <p className="text-[9px] text-gray-500 truncate">
                          {b.store} · {b.kind ?? "product"}
                        </p>
                      </button>
                    ))}
                    {sources.brand.length === 0 && <p className="col-span-4 text-xs text-gray-500 p-2">No brand kit photos yet. Add them in the Clipper.</p>}
                  </div>
                )}
                {picker === "board" && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {sources.board.map((b) => (
                      <button key={b.id} type="button" onClick={() => addAtt({ bucket: b.bucket, path: b.path, role: "reference", label: b.title, url: b.url })} className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5" title={b.title}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.url} alt="" className="w-full aspect-square object-cover rounded" loading="lazy" />
                        <p className="text-[9px] text-gray-500 truncate">{b.title}</p>
                      </button>
                    ))}
                    {sources.board.length === 0 && <p className="col-span-4 text-xs text-gray-500 p-2">No image cards on the board yet.</p>}
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-gray-600 mt-3">Reference = layout and composition. Model = this exact face. Product = our product, label letter for letter. Look = style, lighting or subject only. Click a role to change it.</p>
          </Panel>
          {filesOver && (
            <div className="absolute inset-1 rounded-xl border-2 border-dashed border-purple-500 bg-purple-600/15 flex items-center justify-center pointer-events-none">
              <p className="text-sm font-semibold text-purple-100 bg-gray-950/80 rounded-lg px-4 py-2">Drop to attach</p>
            </div>
          )}
        </div>

        {/* Instruction + toggles */}
        <Panel className="space-y-3">
          <Label>What should come out</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.id)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${form.preset === p.id ? "border-purple-500 bg-purple-500/15 text-white" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <textarea value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} rows={4} placeholder="Plain words, English or Taglish. Say what to keep, what to change, what text to put. The brand rules are always added underneath." className={`${field} resize-none`} />
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-gray-400 w-16">Product</span>
            {seg<ProductMode>(form.product, [["in", "In the image"], ["none", "None"]], (v) => setForm({ ...form, product: v }))}
            <span className="text-gray-400 ml-2">Person</span>
            {seg<PersonMode>(form.person, [["model", "Model from attachments"], ["none", "No person"], ["new", "Any new person"]], (v) => setForm({ ...form, person: v }))}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-gray-400 w-16">Output</span>
            {seg<OutputMode>(form.output, [["single", "1 image"], ["pair", "Before & after pair"], ["set3", "Set of 3"]], (v) => setForm({ ...form, output: v }))}
            {form.output !== "pair" && (
              <>
                <span className="text-gray-400 ml-2">Format</span>
                {seg<ImageFormat>(form.format, [["1:1", "1:1"], ["4:5", "4:5"], ["9:16", "9:16"], ["1.91:1", "1.91:1"]], (v) => setForm({ ...form, format: v }))}
              </>
            )}
            {form.output !== "set3" && (
              <>
                <span className="text-gray-400 ml-2">Versions</span>
                {seg<"1" | "2" | "4">(String(form.versions) as "1" | "2" | "4", [["1", "1"], ["2", "2"], ["4", "4"]], (v) => setForm({ ...form, versions: Number(v) }))}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-gray-400 w-16">Text on image</span>
            <input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Optional headline, rendered letter for letter" className={`${field} flex-1 min-w-48 !py-1.5`} />
            {seg<TextStyle>(form.textStyle, [["reference", "Reference style"], ["clean", "Clean / no text"]], (v) => setForm({ ...form, textStyle: v }))}
          </div>
          {form.person === "model" && !atts.some((a) => a.role === "model") && <p className="text-[11px] text-amber-300">Person is set to Model, but no attachment has the Model role: pick someone from People folders, or click a role to change it.</p>}
          {form.product === "in" && !atts.some((a) => a.role === "product") && <p className="text-[11px] text-amber-300">Product is In, but no attachment has the Product role: add one from the Brand kit.</p>}
          <button type="button" onClick={() => setShowPrompt((v) => !v)} className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer">
            {showPrompt ? "Hide" : "What the AI will be told"}
          </button>
          {showPrompt && (
            <p className="text-[11px] text-gray-500 rounded-lg border border-dashed border-gray-800 p-3 leading-relaxed">
              Your instruction, then each attachment by role, then the person and product rules, the text rule, the output rule, realism, the brand rules for {form.store || "no brand"}, and the aspect ratio. The brand check reads every result afterwards.
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap pt-1">
            <Button primary onClick={() => void generate()} busy={busy === "run"} disabled={!canRun}>
              <Sparkles size={13} /> Generate {count} · {credits(cost)}
            </Button>
            <span className="text-xs text-gray-500">Nano Banana Pro · usually 1–2 min · all at once · keep working meanwhile</span>
          </div>
        </Panel>
      </div>

      {/* Runs */}
      {page === null ? (
        <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
      ) : runs.length === 0 ? (
        <Panel>
          <p className="text-sm text-gray-500 text-center my-6">Nothing generated yet.</p>
        </Panel>
      ) : (
        runs.map((run) => (
          <Panel key={run.id}>
            <div className="flex items-start gap-3 flex-wrap mb-3">
              <div className="flex-1 min-w-64">
                <p className="text-sm text-white line-clamp-2" title={run.instruction}>
                  {run.instruction || "(no instruction)"}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {timeAgo(run.created_at)} · {run.output === "pair" ? "before & after" : run.output === "set3" ? "set of 3" : run.format} · product {run.product_mode} · person {run.person_mode}
                  {run.text_on_image ? ` · text "${run.text_on_image}"` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {run.attachments.slice(0, 6).map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a.path} src={a.url ?? ""} alt="" title={`${a.role} · ${a.label}`} className="w-7 h-7 object-cover rounded border border-gray-700" />
                ))}
              </div>
              <button type="button" onClick={() => reuse(run)} className="text-[11px] text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                <RotateCcw size={11} /> Reuse settings
              </button>
              <ConfirmButton question="Delete run?" label="Delete" onConfirm={() => void removeRun(run.id)} className="text-[11px] text-gray-500 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer">
                <Trash2 size={11} />
              </ConfirmButton>
            </div>
            <div className={`grid gap-3 ${run.output === "pair" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
              {run.results.map((x) => {
                const rendering = x.status === "queued" || x.status === "running";
                const check = x.brand_check;
                const checking = check?.notes === "Checking…";
                const ratio = run.output === "pair" ? "aspect-[16/9]" : run.format === "9:16" ? "aspect-[9/16]" : run.format === "4:5" ? "aspect-[4/5]" : run.format === "1.91:1" ? "aspect-[1.91/1]" : "aspect-square";
                return (
                  <div key={x.id} className="rounded-xl border border-gray-800 bg-gray-950 p-2 space-y-1.5">
                    <div className={`relative ${ratio} rounded-lg overflow-hidden bg-black`}>
                      {x.preview_url ? (
                        <button type="button" onClick={() => setZoom({ image: x.url ?? x.preview_url! })} className="block w-full h-full cursor-zoom-in">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={x.preview_url} alt="" className="w-full h-full object-cover" />
                        </button>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center p-2">
                          {rendering ? <Loader2 size={18} className="animate-spin text-purple-300" /> : <AlertTriangle size={18} className="text-red-300" />}
                          <p className="text-[11px] text-white">{x.status === "running" ? `Nano Banana · ${elapsedMin(x.updated_at)}` : x.status === "queued" ? "Queued on the Mac" : "Failed"}</p>
                          {x.status === "failed" && x.error && <p className="text-[10px] text-red-300 line-clamp-3">{x.error}</p>}
                        </div>
                      )}
                      {run.output === "pair" && x.preview_url && (
                        <>
                          <span className="absolute top-1.5 left-1.5 text-[9px] font-bold bg-black/70 text-white px-1.5 py-0.5 rounded">BEFORE</span>
                          <span className="absolute top-1.5 right-1.5 text-[9px] font-bold bg-black/70 text-white px-1.5 py-0.5 rounded">AFTER</span>
                        </>
                      )}
                      {x.kept && (
                        <span className="absolute bottom-1.5 left-1.5 bg-green-600 text-white rounded-full p-1">
                          <Check size={10} />
                        </span>
                      )}
                    </div>
                    {x.status === "done" && check && (
                      <p className={`text-[11px] inline-flex items-start gap-1 ${checking ? "text-gray-500" : check.ok ? "text-green-400" : "text-red-300"}`}>
                        {checking ? <Loader2 size={10} className="animate-spin mt-0.5" /> : check.ok ? <Check size={10} className="mt-0.5" /> : <AlertTriangle size={10} className="mt-0.5" />}
                        <span className="line-clamp-2" title={check.notes}>
                          {checking ? "Checking…" : check.ok ? "Clean" : check.notes}
                        </span>
                      </p>
                    )}
                    {x.status === "done" && (
                      <div className="flex items-center gap-2 flex-wrap text-[11px]">
                        {itemId && (
                          <button type="button" onClick={() => void keep(x.id)} disabled={x.kept || busy !== null} className={`inline-flex items-center gap-1 cursor-pointer ${x.kept ? "text-green-400" : "text-purple-300 hover:text-white"}`}>
                            <Check size={11} /> {x.kept ? "Kept" : "Keep"}
                          </button>
                        )}
                        {x.pair_urls ? (
                          <>
                            <a href={x.pair_urls[0]} download className="text-gray-300 hover:text-white inline-flex items-center gap-1">
                              <Download size={11} /> Before
                            </a>
                            <a href={x.pair_urls[1]} download className="text-gray-300 hover:text-white inline-flex items-center gap-1">
                              <Download size={11} /> After
                            </a>
                          </>
                        ) : (
                          x.url && (
                            <a href={x.url} download className="text-gray-300 hover:text-white inline-flex items-center gap-1">
                              <Download size={11} /> Download
                            </a>
                          )
                        )}
                        <button type="button" onClick={() => sendBackAsReference(x)} className="text-gray-400 hover:text-white cursor-pointer">
                          Use as reference
                        </button>
                        {x.credits != null && <Pill tone="muted">{credits(x.credits)}</Pill>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
