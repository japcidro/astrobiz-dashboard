"use client";

import { AlertTriangle, Check, ChevronDown, ChevronUp, Download, Images, Loader2, Sparkles, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STILL_CREDITS } from "@/lib/remake/engines";
import type { ResultView, RunView, StudioPage } from "@/lib/image-studio/types";
import { Button, ConfirmButton, Label, Panel, Pill, api, credits, downloadHref, timeAgo } from "@/components/hook-studio/ui";
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

const overall = (x: ResultView) => {
  const s = x.brand_check?.scores;
  return s ? Math.round(((s.design * 2 + s.brand + s.structure) / 4) * 10) / 10 : null;
};

/**
 * Static Ad Generator (Image Studio in code): a competitor's static ad in, our brand's ad out. The skill
 * behind the button studies the reference, plans our version from the brand
 * profile, generates the versions and reviews them with scores. Notes are
 * optional; everything else is decided for you and shown under the results.
 */
export function ImageStudio() {
  const params = useSearchParams();
  const itemId = params.get("item");
  const [page, setPage] = useState<StudioPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<Pic | null>(null);
  const [store, setStore] = useState("");
  const [notes, setNotes] = useState("");
  const [versions, setVersions] = useState(4);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [change, setChange] = useState<{ runId: string; note: string } | null>(null);
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

  useEffect(() => {
    if (!page || seeded.current) return;
    seeded.current = true;
    setStore(page.item?.store ?? (page.stores.includes("FOLIQ") ? "FOLIQ" : page.stores[0] ?? ""));
    if (page.item?.path && page.item.url) setReference({ bucket: page.item.bucket, path: page.item.path, label: page.item.title ?? "Board image", url: page.item.url });
  }, [page]);

  const working = !!page?.runs.some((r) => r.results.some((x) => x.status === "queued" || x.status === "running" || x.brand_check?.notes === "Checking…"));
  useEffect(() => {
    const t = setInterval(() => void refresh(), working ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, working]);

  const runs = useMemo(() => page?.runs ?? [], [page]);
  const boardImages = page?.sources.board ?? [];
  const cost = versions * STILL_CREDITS;
  const canRun = !!reference && !!store && busy === null;

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
      setReference({ bucket, path, label: file.name.replace(/\.[a-z0-9]+$/i, ""), url: URL.createObjectURL(file) });
      setPicker(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const adapt = async (changeFor?: { runId: string; note: string }) => {
    if (!reference) return;
    setBusy(changeFor ? `change:${changeFor.runId}` : "run");
    setError(null);
    try {
      const r = await api<{ id: string; runs: RunView[] }>("/api/owner/image-studio/adapt", {
        method: "POST",
        body: JSON.stringify({
          item_id: itemId,
          store,
          reference: { bucket: reference.bucket, path: reference.path, label: reference.label },
          notes,
          versions,
          change: changeFor ? { run_id: changeFor.runId, note: changeFor.note } : null,
        }),
      });
      setPage((p) => (p ? { ...p, runs: r.runs } : p));
      setChange(null);
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

  return (
    <div className="max-w-7xl space-y-5">
      {zoom && <Lightbox image={zoom} onClose={() => setZoom(null)} />}
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <div>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
          <Images size={22} className="text-purple-400" /> Static Ad Generator
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {page?.item ? (
            <>
              Adapting <span className="text-gray-300">{page.item.title || "a board image"}</span> ·{" "}
              <Link href="/owner/marketing-board?tab=images" className="text-purple-300 hover:text-white">
                back to the board
              </Link>
            </>
          ) : (
            "A competitor's static ad in, our ad out. The skill studies it, plans our version from the brand profile, generates and reviews."
          )}
        </p>
      </div>
      {error && (
        <p className="text-xs text-red-300 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <Panel>
        <div className="grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
          <div>
            <Label>Reference · competitor&apos;s static ad</Label>
            {reference ? (
              <div className="relative group">
                <button type="button" onClick={() => reference.url && setZoom(reference.url)} className="block w-full aspect-square rounded-xl overflow-hidden bg-black border border-gray-800 cursor-zoom-in">
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
              <div className="aspect-square w-full rounded-xl border border-dashed border-gray-700 flex items-center justify-center text-xs text-gray-500 text-center p-4">Pick an image from the Marketing Board, or upload one.</div>
            )}
            <div className="flex gap-1.5 mt-2">
              <Button onClick={() => setPicker((v) => !v)} className="!px-2.5 !py-1 !text-xs">
                <Images size={12} /> From the Marketing Board
              </Button>
              <Button ghost onClick={() => fileRef.current?.click()} busy={uploading} className="!px-2.5 !py-1 !text-xs">
                <Upload size={12} /> Upload
              </Button>
            </div>
            {picker && (
              <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-2 max-h-72 overflow-y-auto grid grid-cols-3 gap-1.5">
                {boardImages.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setReference({ bucket: b.bucket, path: b.path, label: b.title, url: b.url });
                      setPicker(false);
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

          <div className="space-y-3">
            <div>
              <Label>Adapt for</Label>
              <select value={store} onChange={(e) => setStore(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
                {(page?.stores ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {store && page && !page.brand_rules[store] && <p className="text-[11px] text-amber-300 mt-1">No brand profile for {store} yet; the planner will only know what the product photos show. Add one in the Clipper&apos;s brand kit.</p>}
            </div>
            <div>
              <Label>Notes · optional</Label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder='e.g. "use the 2-bottle bundle price", "gawing Taglish yung headline", "no price, go for the social-proof angle"' className={`${field} resize-none`} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button primary onClick={() => void adapt()} busy={busy === "run"} disabled={!canRun}>
                <Sparkles size={13} /> Adapt for {store || "…"} · {versions} {versions === 1 ? "version" : "versions"} · {credits(cost)}
              </Button>
              <div className="flex items-center gap-1 rounded-lg bg-gray-900 border border-gray-700 p-0.5">
                {[1, 2, 4].map((n) => (
                  <button key={n} type="button" onClick={() => setVersions(n)} className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${versions === n ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-500">about 3 min: study → plan → generate → review</span>
            </div>
          </div>
        </div>
      </Panel>

      {page === null ? (
        <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
      ) : runs.length === 0 ? (
        <Panel>
          <p className="text-sm text-gray-500 text-center my-6">Nothing adapted yet.</p>
        </Panel>
      ) : (
        runs.map((run) => {
          // BEST only among results that passed review: a wrong bottle never wins on looks.
          const scored = run.results.filter((x) => overall(x) !== null && x.brand_check?.ok !== false);
          const bestId = scored.length ? scored.reduce((a, b) => (overall(a)! >= overall(b)! ? a : b)).id : null;
          const planOpen = openPlan === run.id;
          const changing = change?.runId === run.id;
          const ref = run.attachments.find((a) => a.role === "reference");
          return (
            <Panel key={run.id}>
              <div className="flex items-start gap-3 flex-wrap mb-3">
                {ref?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ref.url} alt="" className="w-12 h-12 object-cover rounded-md border border-gray-700" title="Reference" />
                )}
                <div className="flex-1 min-w-64">
                  <p className="text-sm text-white">
                    {run.plan ? run.plan.study.angle : run.instruction || "Run"}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {timeAgo(run.created_at)} · {run.store}
                    {run.instruction ? ` · ${run.instruction}` : ""}
                    {run.plan?.model_label ? ` · model: ${run.plan.model_label}` : ""}
                  </p>
                </div>
                {run.plan && (
                  <button type="button" onClick={() => setOpenPlan(planOpen ? null : run.id)} className="text-[11px] text-gray-400 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                    {planOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} What the skill did
                  </button>
                )}
                <ConfirmButton question="Delete run?" label="Delete" onConfirm={() => void removeRun(run.id)} className="text-[11px] text-gray-500 hover:text-red-300 inline-flex items-center gap-1 cursor-pointer">
                  <Trash2 size={11} />
                </ConfirmButton>
              </div>

              {planOpen && run.plan && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs">
                  <div className="rounded-lg bg-gray-950 border border-gray-800 p-3 space-y-1.5">
                    <p className="text-white font-semibold">1 · Studied the reference</p>
                    <p className="text-gray-400">
                      <span className="text-gray-500">Angle:</span> {run.plan.study.angle}
                    </p>
                    <p className="text-gray-400">
                      <span className="text-gray-500">Structure:</span> {run.plan.study.structure}
                    </p>
                    <p className="text-gray-400">
                      <span className="text-gray-500">Style:</span> {run.plan.study.style}
                    </p>
                    <p className="text-gray-400">
                      <span className="text-gray-500">Why it works:</span> {run.plan.study.why_it_works}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-950 border border-gray-800 p-3 space-y-1.5">
                    <p className="text-white font-semibold">2 · Planned our version</p>
                    <table className="w-full">
                      <tbody>
                        {run.plan.plan.text.map((t, i) => (
                          <tr key={i} className="border-b border-gray-900">
                            <td className="py-1 pr-2 text-gray-500 align-top w-1/2">{t.from}</td>
                            <td className="py-1 text-white font-semibold align-top">{t.to}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-gray-500">
                      {run.plan.plan.needs_person ? `Person: yes${run.plan.model_label ? `, ${run.plan.model_label}` : ""}` : "Person: none"} · {run.plan.plan.needs_product ? "Product: in" : "Product: none"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-950 border border-gray-800 p-3 space-y-1.5">
                    <p className="text-white font-semibold">3 · Design spec given to the image model</p>
                    <p className="text-gray-400 leading-relaxed max-h-48 overflow-y-auto">{run.plan.plan.design_spec}</p>
                  </div>
                </div>
              )}

              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                {run.results.map((x) => {
                  const rendering = x.status === "queued" || x.status === "running";
                  const check = x.brand_check;
                  const checking = check?.notes === "Checking…";
                  const score = overall(x);
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
                            <p className="text-[11px] text-white">{x.status === "running" ? `Generating · ${elapsedMin(x.updated_at)}` : x.status === "queued" ? (x.attempts > 1 ? "Fixing · 2nd try" : "Queued on the Mac") : "Failed"}</p>
                            {x.status === "failed" && x.error && <p className="text-[10px] text-red-300 line-clamp-3">{x.error}</p>}
                          </div>
                        )}
                        {score !== null && <span className="absolute top-1.5 left-1.5 rounded-full bg-black/70 text-white text-[11px] font-bold px-2 py-0.5">{score.toFixed(1)}</span>}
                        {bestId === x.id && <span className="absolute top-1.5 right-1.5 rounded-full bg-green-500 text-green-950 text-[10px] font-extrabold px-2 py-0.5">BEST</span>}
                        {x.brand_check?.product_ok === false && <span className="absolute top-1.5 right-1.5 rounded-full bg-red-600 text-bad-ink text-[10px] font-extrabold px-2 py-0.5">WRONG PRODUCT</span>}
                        {x.kept && (
                          <span className="absolute bottom-1.5 left-1.5 bg-green-600 text-good-ink rounded-full p-1">
                            <Check size={10} />
                          </span>
                        )}
                      </div>
                      {x.status === "done" && check && (
                        <p className={`text-[11px] inline-flex items-start gap-1 ${checking ? "text-gray-500" : check.ok ? "text-green-400" : "text-amber-300"}`}>
                          {checking ? <Loader2 size={10} className="animate-spin mt-0.5" /> : check.ok ? <Check size={10} className="mt-0.5" /> : <AlertTriangle size={10} className="mt-0.5" />}
                          <span className="line-clamp-2" title={check.notes}>
                            {checking ? "Reviewing…" : check.notes}
                            {check.scores && !checking ? ` (design ${check.scores.design}, brand ${check.scores.brand}, structure ${check.scores.structure})` : ""}
                          </span>
                        </p>
                      )}
                      {x.attempts > 1 && x.status === "done" && <p className="text-[10px] text-gray-600">Regenerated once by the reviewer</p>}
                      {x.status === "done" && (
                        <div className="flex items-center gap-2 flex-wrap text-[11px]">
                          {itemId && (
                            <button type="button" onClick={() => void keep(x.id)} disabled={x.kept || busy !== null} className={`inline-flex items-center gap-1 cursor-pointer ${x.kept ? "text-green-400" : "text-purple-300 hover:text-white"}`}>
                              <Check size={11} /> {x.kept ? "Kept" : "Keep"}
                            </button>
                          )}
                          {x.url && (
                            <a href={downloadHref(x.url, `${run.store ?? "ad"}-${x.idx + 1}`)} className="text-gray-300 hover:text-white inline-flex items-center gap-1" title="Full-size PNG">
                              <Download size={11} /> Download
                            </a>
                          )}
                          {x.credits != null && <Pill tone="muted">{credits(x.credits)}</Pill>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {run.plan && (
                <div className="mt-3">
                  {changing ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input autoFocus value={change.note} onChange={(e) => setChange({ runId: run.id, note: e.target.value })} placeholder="What should change? e.g. bigger headline, no price, warmer light" className={`${field} flex-1 min-w-64 !py-1.5`} onKeyDown={(e) => e.key === "Enter" && change.note.trim() && void adapt(change)} />
                      <Button primary onClick={() => void adapt(change)} busy={busy === `change:${run.id}`} disabled={!change.note.trim() || busy !== null} className="!px-2.5 !py-1 !text-xs">
                        Run again · {credits(cost)}
                      </Button>
                      <Button ghost onClick={() => setChange(null)} className="!px-2.5 !py-1 !text-xs">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setChange({ runId: run.id, note: "" })} disabled={busy !== null} className="text-[11px] text-purple-300 hover:text-white cursor-pointer">
                      Change something and run again (keeps the plan)
                    </button>
                  )}
                </div>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
