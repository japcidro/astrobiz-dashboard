"use client";

import { AlertTriangle, Check, Download, Images, Loader2, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { PRESETS, type Attachment, type PresetId, type ResultView, type RunView, type StudioPage } from "@/lib/image-studio/types";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, timeAgo } from "@/components/hook-studio/ui";
import { Lightbox } from "@/components/remake/clip-video";

const field = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";
const ACCEPT = "image/png,image/jpeg,image/webp";

interface Pic {
  bucket: string;
  path: string;
  label: string;
  url: string | null;
}

const elapsedMin = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "under a minute" : `${m} min`;
};

/**
 * Image Studio: one reference (a Marketing Board image or an upload), our
 * model if a person should be ours, our product photos from the brand kit,
 * an instruction in plain words, and the text that goes on the image,
 * approved before anything renders. Always one 1:1 image per version.
 */
export function ImageStudio() {
  const params = useSearchParams();
  const itemId = params.get("item");
  const [page, setPage] = useState<StudioPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<Pic | null>(null);
  const [model, setModel] = useState<Pic | null>(null);
  const [productOff, setProductOff] = useState<Set<string>>(new Set());
  const [store, setStore] = useState("");
  const [preset, setPreset] = useState<PresetId>("adapt");
  const [instruction, setInstruction] = useState(PRESETS[0].instruction);
  const [versions, setVersions] = useState(4);
  const [text, setText] = useState("");
  const [textState, setTextState] = useState<"reading" | "unread" | "proposed" | "approved" | "none">("unread");
  const [busy, setBusy] = useState<"run" | "keep" | "delete" | null>(null);
  const [picker, setPicker] = useState<"reference" | "model" | null>(null);
  const [modelTab, setModelTab] = useState<"people" | "stills">("people");
  const [uploading, setUploading] = useState(false);
  const [uploadAs, setUploadAs] = useState<"reference" | "model">("reference");
  const [zoom, setZoom] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  // First load: the board card is the reference and its store is the brand.
  useEffect(() => {
    if (!page || seeded.current) return;
    seeded.current = true;
    setStore(page.item?.store ?? page.stores[0] ?? "");
    if (page.item?.path && page.item.url) setReference({ bucket: page.item.bucket, path: page.item.path, label: page.item.title ?? "Board image", url: page.item.url });
  }, [page]);

  // A new reference: read its text so it can be approved.
  useEffect(() => {
    if (!reference) {
      setTextState("unread");
      return;
    }
    let alive = true;
    setTextState("reading");
    api<{ text: string; has_text: boolean }>("/api/owner/image-studio/read-text", { method: "POST", body: JSON.stringify({ bucket: reference.bucket, path: reference.path }) })
      .then((r) => {
        if (!alive) return;
        setText(r.has_text ? r.text : "");
        setTextState(r.has_text ? "proposed" : "none");
      })
      .catch(() => {
        if (!alive) return;
        setTextState("proposed");
      });
    return () => {
      alive = false;
    };
  }, [reference]);

  const working = !!page?.runs.some((r) => r.results.some((x) => x.status === "queued" || x.status === "running" || x.brand_check?.notes === "Checking…"));
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const runs = useMemo(() => page?.runs ?? [], [page]);
  const brandPhotos = useMemo(() => (page?.sources.brand ?? []).filter((b) => b.store === store), [page, store]);
  const products = useMemo(() => brandPhotos.filter((b) => !productOff.has(b.path)), [brandPhotos, productOff]);
  const cost = versions * STILL_CREDITS;
  const textReady = textState === "approved" || textState === "none";
  const canRun = !!reference && textReady && busy === null;
  const boardImages = page?.sources.board ?? [];

  const applyPreset = (id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setInstruction(p.instruction);
  };

  const pickFile = (as: "reference" | "model") => {
    setUploadAs(as);
    fileRef.current?.click();
  };

  const upload = async (file: File) => {
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Upload a PNG, JPG or WebP image");
      return;
    }
    setUploading(true);
    try {
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/marketing-board/upload-url", { method: "POST", body: JSON.stringify({ kind: "studio", mime: file.type }) });
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const pic = { bucket, path, label: file.name.replace(/\.[a-z0-9]+$/i, ""), url: URL.createObjectURL(file) };
      if (uploadAs === "reference") setReference(pic);
      else setModel(pic);
      setPicker(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generate = async () => {
    if (!reference) return;
    setBusy("run");
    setError(null);
    const attachments: Attachment[] = [
      { bucket: reference.bucket, path: reference.path, role: "reference", label: reference.label },
      ...products.map((b) => ({ bucket: b.bucket, path: b.path, role: "product" as const, label: `${b.store} · ${b.kind ?? "product"}` })),
      ...(model ? [{ bucket: model.bucket, path: model.path, role: "model" as const, label: model.label }] : []),
    ];
    try {
      const r = await api<{ id: string; runs: RunView[] }>("/api/owner/image-studio", {
        method: "POST",
        body: JSON.stringify({
          item_id: itemId,
          store: store || null,
          preset,
          instruction,
          product_mode: products.length ? "in" : "none",
          person_mode: model ? "model" : "new",
          output: "single",
          format: "1:1",
          versions,
          text_on_image: textState === "none" ? "" : text,
          text_style: textState === "none" ? "clean" : "reference",
          attachments,
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

  const sendBackAsRef = (x: ResultView) => {
    if (!x.path) return;
    setReference({ bucket: "marketing-board", path: x.path, label: "Earlier result", url: x.preview_url });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reuse = (r: RunView) => {
    const ref = r.attachments.find((a) => a.role === "reference");
    const mdl = r.attachments.find((a) => a.role === "model");
    if (ref) setReference({ bucket: ref.bucket, path: ref.path, label: ref.label, url: ref.url });
    setModel(mdl ? { bucket: mdl.bucket, path: mdl.path, label: mdl.label, url: mdl.url } : null);
    setStore(r.store ?? "");
    setPreset(r.preset);
    setInstruction(r.instruction);
    setVersions(Math.min(4, r.versions));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const slotFrame = "aspect-square w-full rounded-xl overflow-hidden bg-black border border-gray-800";
  const modelOptions =
    modelTab === "people"
      ? (page?.sources.people ?? []).map((p) => ({ key: p.id, bucket: p.bucket, path: p.path, url: p.url, label: p.name || "Person", sub: p.folder ?? "Unsorted" }))
      : (page?.sources.stills ?? []).map((s) => ({ key: s.id, bucket: s.bucket, path: s.path, url: s.url, label: s.title, sub: s.title }));

  return (
    <div className="max-w-7xl space-y-5">
      {zoom && <Lightbox image={zoom} onClose={() => setZoom(null)} />}
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
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
              "Pick a reference, say what should come out, approve the text, generate. One 1:1 image per version."
            )}
          </p>
        </div>
        {page && (
          <label className="text-xs text-gray-400 inline-flex items-center gap-2">
            Brand
            <select value={store} onChange={(e) => setStore(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-200 focus:outline-none">
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

      <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4 items-start">
        {/* The three slots */}
        <Panel className="space-y-4">
          <div>
            <Label>1 · Reference · the image to copy</Label>
            {reference ? (
              <div className="relative group">
                <button type="button" onClick={() => reference.url && setZoom(reference.url)} className={`${slotFrame} cursor-zoom-in block`}>
                  {reference.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={reference.url} alt="" className="w-full h-full object-contain" />
                  )}
                </button>
                <p className="text-[11px] text-gray-500 mt-1 truncate">{reference.label}</p>
                <button type="button" onClick={() => setReference(null)} aria-label="Remove reference" className="absolute top-2 right-2 rounded-md bg-black/70 text-white p-1 opacity-0 group-hover:opacity-100 cursor-pointer">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className={`${slotFrame} border-dashed flex items-center justify-center text-xs text-gray-500 text-center p-4`}>Pick an image from the Marketing Board, or upload one.</div>
            )}
            <div className="flex gap-1.5 mt-2">
              <Button onClick={() => setPicker(picker === "reference" ? null : "reference")} className="!px-2.5 !py-1 !text-xs">
                <Images size={12} /> From the Marketing Board
              </Button>
              <Button ghost onClick={() => pickFile("reference")} busy={uploading && uploadAs === "reference"} className="!px-2.5 !py-1 !text-xs">
                <Upload size={12} /> Upload
              </Button>
            </div>
            {picker === "reference" && (
              <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-2 max-h-72 overflow-y-auto grid grid-cols-3 gap-1.5">
                {boardImages.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setReference({ bucket: b.bucket, path: b.path, label: b.title, url: b.url });
                      setPicker(null);
                    }}
                    className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5"
                    title={b.title}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.url} alt="" className="w-full aspect-square object-cover rounded" loading="lazy" />
                    <p className="text-[9px] text-gray-500 truncate">{b.title}</p>
                  </button>
                ))}
                {boardImages.length === 0 && (
                  <p className="col-span-3 text-xs text-gray-500 p-2">
                    No images on the board yet. Add some on the{" "}
                    <Link href="/owner/marketing-board?tab=images" className="text-purple-300 hover:text-white">
                      Images tab
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label>2 · Our model · optional</Label>
            <div className="flex items-center gap-3">
              {model ? (
                <div className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={model.url ?? ""} alt="" className="w-16 aspect-[9/16] object-cover rounded-lg border border-purple-500" />
                  <button type="button" onClick={() => setModel(null)} aria-label="Remove model" className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-800 border border-gray-600 text-white p-0.5 cursor-pointer">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <div className="w-16 aspect-[9/16] rounded-lg border border-dashed border-gray-700 shrink-0" />
              )}
              <div className="text-xs text-gray-400 flex-1 min-w-0">
                <p>{model ? model.label : "If a person should be in the image, this is who. Leave it empty and the AI invents a new face."}</p>
                <div className="flex gap-1.5 mt-1.5">
                  <Button ghost onClick={() => setPicker(picker === "model" ? null : "model")} className="!px-2 !py-1 !text-xs">
                    {model ? "Change" : "Pick a person"}
                  </Button>
                  <Button ghost onClick={() => pickFile("model")} busy={uploading && uploadAs === "model"} className="!px-2 !py-1 !text-xs">
                    Upload
                  </Button>
                </div>
              </div>
            </div>
            {picker === "model" && page && (
              <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-2">
                <div className="flex gap-1 mb-2">
                  {(["people", "stills"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setModelTab(t)} className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${modelTab === t ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                      {t === "people" ? "People folders" : "Starting images"}
                    </button>
                  ))}
                </div>
                <div className="max-h-64 overflow-y-auto grid grid-cols-4 gap-1.5">
                  {modelOptions.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        setModel({ bucket: p.bucket, path: p.path, label: p.label, url: p.url });
                        setPicker(null);
                      }}
                      className="text-left cursor-pointer hover:bg-white/5 rounded-md p-0.5"
                      title={p.sub}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="w-full aspect-[9/16] object-cover rounded" loading="lazy" />
                      <p className="text-[9px] text-gray-500 truncate">{p.sub}</p>
                    </button>
                  ))}
                  {modelOptions.length === 0 && <p className="col-span-4 text-xs text-gray-500 p-2">Nothing here yet.</p>}
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>3 · Our product · from the {store || "brand"} kit</Label>
            {brandPhotos.length ? (
              <div className="flex gap-2 flex-wrap">
                {brandPhotos.map((b) => {
                  const off = productOff.has(b.path);
                  return (
                    <button
                      key={b.path}
                      type="button"
                      onClick={() =>
                        setProductOff((s) => {
                          const n = new Set(s);
                          if (n.has(b.path)) n.delete(b.path);
                          else n.add(b.path);
                          return n;
                        })
                      }
                      title={off ? "Not attached · click to attach" : "Attached · click to leave out"}
                      className={`rounded-lg p-0.5 cursor-pointer ${off ? "opacity-40 grayscale" : "ring-2 ring-green-500/70"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.url} alt="" className="w-14 h-14 object-cover rounded-md" />
                      <p className="text-[9px] text-gray-500 text-center capitalize">{b.kind ?? "product"}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No product photos for this brand yet; add them in the Clipper&apos;s brand kit.</p>
            )}
            <p className="text-[11px] text-gray-600 mt-1.5">These are what the AI copies when your instruction or the reference calls for the product. Click one to leave it out.</p>
          </div>
        </Panel>

        {/* Instruction, text, generate */}
        <Panel className="space-y-3">
          <Label>What should come out</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.id)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${preset === p.id ? "border-purple-500 bg-purple-500/15 text-white" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={5} placeholder="Plain words, English or Taglish. Say what to keep from the reference, what to change, whether our product or a person is in it, close-up or wide, before and after side by side… The brand rules are always added underneath." className={`${field} resize-none`} />

          <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Label>Text on the image</Label>
              {textState === "reading" && (
                <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> reading the reference…
                </span>
              )}
              {textState === "proposed" && <Pill tone="warn">approve or edit</Pill>}
              {textState === "approved" && <Pill tone="ok">approved</Pill>}
              {textState === "none" && <Pill tone="muted">no text</Pill>}
            </div>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTextState("proposed");
              }}
              rows={3}
              placeholder={reference ? "Nothing was read from the reference. Type a headline, or leave this empty for no text." : "Pick a reference first; its text is read for you to approve."}
              className={`${field} resize-none`}
              disabled={!reference || textState === "reading"}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button primary={textState === "proposed"} onClick={() => setTextState(text.trim() ? "approved" : "none")} disabled={!reference || textState === "reading"} className="!px-2.5 !py-1 !text-xs">
                <Check size={12} /> {text.trim() ? "Use this text" : "No text on the image"}
              </Button>
              {text.trim() && (
                <Button
                  ghost
                  onClick={() => {
                    setText("");
                    setTextState("none");
                  }}
                  disabled={!reference}
                  className="!px-2.5 !py-1 !text-xs"
                >
                  No text instead
                </Button>
              )}
              <span className="text-[11px] text-gray-600">Rendered letter for letter, in the reference&apos;s style. Edit it to make it ours.</span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <Button primary onClick={() => void generate()} busy={busy === "run"} disabled={!canRun}>
              <Sparkles size={13} /> Generate {versions} · {credits(cost)}
            </Button>
            <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
              {[1, 2, 4].map((n) => (
                <button key={n} type="button" onClick={() => setVersions(n)} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${versions === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500">versions · 1:1 · Nano Banana Pro · usually 1–2 min · all at once</span>
          </div>
          {!reference && <p className="text-[11px] text-amber-300">Pick a reference first.</p>}
          {reference && !textReady && textState !== "reading" && <p className="text-[11px] text-amber-300">Approve the text, or choose no text, before generating.</p>}
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
                  {timeAgo(run.created_at)}
                  {run.store ? ` · ${run.store}` : ""}
                  {run.text_on_image ? ` · text "${run.text_on_image.split("\n")[0]}"` : " · no text"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {run.attachments.slice(0, 6).map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a.path} src={a.url ?? ""} alt="" title={`${a.role} · ${a.label}`} className="w-7 h-7 object-cover rounded border border-gray-700" />
                ))}
              </div>
              <button type="button" onClick={() => reuse(run)} className="text-[11px] text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                <RotateCcw size={11} /> Reuse
              </button>
              <ConfirmButton question="Delete run?" label="Delete" onConfirm={() => void removeRun(run.id)} className="text-[11px] text-gray-500 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer">
                <Trash2 size={11} />
              </ConfirmButton>
            </div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {run.results.map((x) => {
                const rendering = x.status === "queued" || x.status === "running";
                const check = x.brand_check;
                const checking = check?.notes === "Checking…";
                return (
                  <div key={x.id} className="rounded-xl border border-gray-800 bg-gray-950 p-2 space-y-1.5">
                    <div className="relative aspect-square rounded-lg overflow-hidden bg-black">
                      {x.preview_url ? (
                        <button type="button" onClick={() => setZoom(x.url ?? x.preview_url!)} className="block w-full h-full cursor-zoom-in">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={x.preview_url} alt="" className="w-full h-full object-contain" />
                        </button>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center p-2">
                          {rendering ? <Loader2 size={18} className="animate-spin text-purple-300" /> : <AlertTriangle size={18} className="text-red-300" />}
                          <p className="text-[11px] text-white">{x.status === "running" ? `Nano Banana · ${elapsedMin(x.updated_at)}` : x.status === "queued" ? "Queued on the Mac" : "Failed"}</p>
                          {x.status === "failed" && x.error && <p className="text-[10px] text-red-300 line-clamp-3">{x.error}</p>}
                        </div>
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
                        {x.url && (
                          <a href={x.url} download className="text-gray-300 hover:text-white inline-flex items-center gap-1">
                            <Download size={11} /> Download
                          </a>
                        )}
                        <button type="button" onClick={() => sendBackAsRef(x)} className="text-gray-400 hover:text-white cursor-pointer">
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
