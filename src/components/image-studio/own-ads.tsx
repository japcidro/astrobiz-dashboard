"use client";

import { AlertTriangle, ArrowDown, Check, Loader2, PenLine, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { STILL_CREDITS } from "@/lib/remake/engines";
import { APPROACH_HINT, APPROACH_LABEL, FORMAT_LABEL, isContents, productsOf, type OwnConcept, type OwnPlanRow, type RunView, type StudioPage } from "@/lib/image-studio/types";
import { Button, ConfirmButton, Label, Panel, api, credits, timeAgo } from "@/components/hook-studio/ui";

const field = "w-full bg-canvas border border-line-strong rounded-control px-3 py-2 text-sm text-fg placeholder:text-dim focus:outline-none focus:border-accent";
const select = "bg-canvas border border-line-strong rounded-control px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent";

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/* ─── The sketch: each concept drawn as a layout, with its real words ─── */

// A sketch shows an ad, not the dashboard: its surfaces are the ad's own (a dark studio, a white meme card), whatever the theme.
const HATCH: CSSProperties = { backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 6px, transparent 6px 12px)" };
const INK = "#16181c";
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';
const SERIF = 'Georgia, "Times New Roman", serif';
const CAPS = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/** A stand-in for the photo: what will be there, in words. */
function Shot({ children, className = "", style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`absolute flex items-center justify-center text-center ${className}`} style={{ ...HATCH, backgroundColor: "#3a3f47", color: "rgba(255,255,255,0.72)", fontSize: "3.6cqw", lineHeight: 1.25, padding: "2cqw", ...style }}>
      {children}
    </div>
  );
}

/** Our pack: its real photo when the Brand Kit has one, a labelled box otherwise. */
function Pack({ url, className = "", style }: { url: string | null; className?: string; style?: CSSProperties }) {
  return (
    <div className={`absolute ${className}`} style={style}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-full h-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]" />
      ) : (
        <div className="w-full h-full rounded-[2cqw] border border-dashed flex items-center justify-center" style={{ borderColor: "rgba(255,255,255,0.6)", color: "rgba(255,255,255,0.8)", fontSize: "3.4cqw", backgroundColor: "rgba(0,0,0,0.25)" }}>
          pack
        </div>
      )}
    </div>
  );
}

export function AdSketch({ concept: c, packUrl, brand }: { concept: OwnConcept; packUrl: string | null; brand: string }) {
  const pack = c.needs_product ? packUrl : null;
  const showPack = c.needs_product;
  const who = c.person || (c.needs_person ? "person" : "");
  let body: ReactNode;

  if (c.format === "sorting_line") {
    body = (
      <>
        <Shot className="inset-0" style={{ backgroundColor: "#4a4038", alignItems: "flex-end", justifyContent: "flex-end", padding: "0 6cqw 22cqw 0" }}>
          <span style={{ maxWidth: "38cqw" }}>{who || "the person, in their own place"}</span>
        </Shot>
        <div className="absolute flex flex-col" style={{ left: "6cqw", top: "7cqw", width: "60cqw", gap: "2.4cqw" }}>
          <p className="font-extrabold uppercase" style={{ color: "#fff", fontFamily: CAPS, fontSize: "8.4cqw", lineHeight: 1.02, letterSpacing: "0.01em" }}>{c.headline}</p>
          {c.subhead && (
            <p className="uppercase" style={{ color: "rgba(255,255,255,0.85)", fontSize: "3.1cqw", letterSpacing: "0.08em" }}>
              {c.subhead}
            </p>
          )}
        </div>
        {showPack && <Pack url={pack} style={{ left: "5cqw", bottom: "6cqw", width: "38cqw", height: "50cqw" }} />}
        <p className="absolute font-bold uppercase" style={{ right: "5cqw", bottom: "5cqw", color: "#fff", fontSize: "3.4cqw", letterSpacing: "0.06em" }}>
          {brand}
        </p>
      </>
    );
  } else if (c.format === "authority") {
    body = (
      <>
        <div className="absolute inset-x-0 top-0 flex flex-col items-center justify-center text-center" style={{ height: "34cqw", backgroundColor: "#efe9df", padding: "0 5cqw", gap: "1.2cqw" }}>
          <p style={{ color: INK, fontFamily: SERIF, fontSize: "5.2cqw", lineHeight: 1.1 }}>{c.headline}</p>
          {c.subhead && (
            <p className="font-extrabold uppercase" style={{ color: "#b3125f", fontFamily: CAPS, fontSize: "6.6cqw", lineHeight: 1.02 }}>
              {c.subhead}
            </p>
          )}
        </div>
        <Shot className="inset-x-0 bottom-0" style={{ top: "34cqw", backgroundColor: "#463f3a", alignItems: "flex-end", paddingBottom: "6cqw" }}>
          <span style={{ maxWidth: "70cqw" }}>{c.authority || who || "the authority figure, in their world"}</span>
        </Shot>
        {showPack && <Pack url={pack} style={{ left: "12cqw", top: "58cqw", width: "24cqw", height: "32cqw" }} />}
      </>
    );
  } else if (c.format === "replacement") {
    const pills = c.callouts.slice(0, 4);
    body = (
      <>
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 62%, #3b4250 0%, #14161b 62%)" }} />
        <div className="absolute inset-x-0 flex flex-col items-center text-center" style={{ top: "6cqw", padding: "0 6cqw", gap: "2.4cqw" }}>
          <p className="font-extrabold uppercase" style={{ color: "#fff", fontFamily: CAPS, fontSize: "7.4cqw", lineHeight: 1.03 }}>{c.headline}</p>
          {c.subhead && <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "3.2cqw", lineHeight: 1.25, maxWidth: "76cqw" }}>{c.subhead}</p>}
        </div>
        {showPack && <Pack url={pack} style={{ left: "35cqw", top: "58cqw", width: "30cqw", height: "42cqw" }} />}
        {pills.map((p, i) => (
          <span key={i} className="absolute rounded-full" style={{ [i % 2 === 0 ? "left" : "right"]: "3cqw", top: `${64 + Math.floor(i / 2) * 17}cqw`, maxWidth: "31cqw", backgroundColor: "rgba(255,255,255,0.92)", color: INK, fontSize: "2.7cqw", lineHeight: 1.15, padding: "1cqw 2.2cqw" }}>
            {p}
          </span>
        ))}
        {c.cta && (
          <p className="absolute text-center font-bold uppercase" style={{ left: "18cqw", right: "18cqw", bottom: "5cqw", backgroundColor: "#000", color: "#fff", fontSize: "2.8cqw", letterSpacing: "0.05em", padding: "2cqw 2cqw" }}>
            {c.cta}
          </p>
        )}
      </>
    );
  } else if (c.format === "native_comparison") {
    body = (
      <>
        <Shot className="inset-y-0 left-0" style={{ width: "50%", backgroundColor: "#454c56", alignItems: "flex-end", paddingBottom: "5cqw" }}>
          with it
        </Shot>
        <Shot className="inset-y-0 right-0" style={{ width: "50%", backgroundColor: "#353a42", alignItems: "flex-end", paddingBottom: "5cqw" }}>
          without it
        </Shot>
        <div className="absolute inset-y-0" style={{ left: "50%", borderLeft: "1px dashed rgba(255,255,255,0.35)" }} />
        <p className="absolute" style={{ left: "5cqw", top: "16cqw", width: "40cqw", color: "#45f06a", fontFamily: HAND, fontSize: "6cqw", lineHeight: 1.12, transform: "rotate(-5deg)" }}>
          <span style={{ fontSize: "12cqw", lineHeight: 0.8, display: "block" }}>✓</span>
          {c.callouts[0] ?? ""}
        </p>
        <p className="absolute" style={{ right: "4cqw", top: "22cqw", width: "38cqw", color: "#fff", fontFamily: HAND, fontSize: "6cqw", lineHeight: 1.12, transform: "rotate(4deg)" }}>
          <span style={{ fontSize: "12cqw", lineHeight: 0.8, display: "block" }}>✗</span>
          {c.callouts[1] ?? ""}
        </p>
        {showPack && <Pack url={pack} style={{ left: "12cqw", bottom: "14cqw", width: "24cqw", height: "32cqw" }} />}
      </>
    );
  } else if (c.format === "story_post") {
    body = (
      <>
        <Shot className="inset-0" style={{ backgroundColor: "#5a5148", alignItems: "flex-end", paddingBottom: "5cqw" }}>
          phone photo, at home
        </Shot>
        {showPack && <Pack url={pack} style={{ left: "32cqw", top: "52cqw", width: "36cqw", height: "48cqw" }} />}
        {c.callouts.slice(0, 3).map((t, i) => (
          <p key={i} className="absolute text-center" style={{ left: `${[10, 30, 14][i]}cqw`, top: `${[10, 26, 42][i]}cqw`, maxWidth: "62cqw", backgroundColor: "#fff", color: "#000", borderRadius: "1.6cqw", fontSize: "3.8cqw", lineHeight: 1.2, padding: "1.4cqw 2.6cqw", transform: `rotate(${[-2, 1.5, -1][i]}deg)` }}>
            {t}
          </p>
        ))}
      </>
    );
  } else if (c.format === "meme") {
    const face = (mouth: string) => (
      <div className="shrink-0 rounded-full flex items-center justify-center" style={{ width: "26cqw", height: "26cqw", border: `0.6cqw solid ${INK}`, color: INK, fontSize: "9cqw", fontWeight: 700 }}>
        {mouth}
      </div>
    );
    body = (
      <div className="absolute inset-0 flex flex-col justify-between" style={{ backgroundColor: "#fff", padding: "7cqw 6cqw" }}>
        <div className="flex items-start" style={{ gap: "4cqw" }}>
          {face(":'(")}
          <p className="font-bold" style={{ color: INK, fontSize: "4.6cqw", lineHeight: 1.2 }}>
            {c.headline}
          </p>
        </div>
        <div className="flex items-end justify-end" style={{ gap: "4cqw" }}>
          <div className="text-right">
            <p className="font-extrabold" style={{ color: INK, fontSize: "8cqw", lineHeight: 1 }}>
              {c.subhead}
            </p>
            {c.cta && <p style={{ color: INK, fontSize: "2.8cqw", marginTop: "1.5cqw" }}>{c.cta}</p>}
          </div>
          {face("B)")}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="absolute inset-0 flex flex-col items-center text-center" style={{ backgroundColor: "#f3eee4", padding: "7cqw 6cqw 5cqw", gap: "2cqw" }}>
        <p style={{ color: "#1d3b2f", fontFamily: SERIF, fontSize: "7cqw", lineHeight: 1.08 }}>{c.headline}</p>
        {c.subhead && <p style={{ color: "#3c4a44", fontSize: "3.3cqw", lineHeight: 1.25 }}>{c.subhead}</p>}
        {c.callouts[0] && (
          <p className="font-bold uppercase" style={{ backgroundColor: "#b8f24a", color: "#16210f", fontSize: "3.1cqw", letterSpacing: "0.04em", padding: "0.8cqw 2.4cqw" }}>
            {c.callouts[0]}
          </p>
        )}
        <div className="relative flex-1 w-full" style={{ minHeight: "30cqw" }}>
          {showPack && <Pack url={pack} style={{ left: "30cqw", top: 0, width: "28cqw", bottom: 0 }} />}
        </div>
        {c.callouts.slice(1).length > 0 && <p style={{ color: "#3c4a44", fontSize: "3cqw", lineHeight: 1.25 }}>{c.callouts.slice(1).join("  ·  ")}</p>}
        {c.cta && (
          <p className="font-bold" style={{ backgroundColor: "#1d3b2f", color: "#fff", fontSize: "3.1cqw", padding: "1.6cqw 4cqw", borderRadius: "1.2cqw" }}>
            {c.cta}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-[4/5] overflow-hidden rounded-control border border-line" style={{ containerType: "inline-size", backgroundColor: "#22252b" }} aria-label={`Layout sketch: ${FORMAT_LABEL[c.format]}`}>
      {body}
    </div>
  );
}

/* ─── A concept card: the sketch, the reasoning, approve or rewrite ─── */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-xs text-fg leading-relaxed">
      <span className="text-muted">{label} </span>
      {children}
    </p>
  );
}

function ConceptCard({ concept: c, packUrl, brand, picked, onPick, onRevise, busy, locked }: { concept: OwnConcept; packUrl: string | null; brand: string; picked: boolean; onPick: () => void; onRevise: (note: string) => Promise<void>; busy: boolean; locked: boolean }) {
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState("");
  const done = !!c.run_id;
  const words = [c.headline, c.subhead, ...c.callouts, c.cta].filter(Boolean);
  const long = wordCount(c.headline) > 9;
  const send = async () => {
    await onRevise(note.trim());
    setNote("");
    setRevising(false);
  };
  return (
    <div className={`rounded-panel border p-3 ${picked && !done ? "border-accent bg-accent-soft" : "border-line bg-raised"}`}>
      <div className="flex items-start gap-2 mb-3">
        <button
          type="button"
          onClick={onPick}
          disabled={done || locked}
          aria-pressed={picked}
          title={done ? "Already generated" : picked ? "Approved: click to leave it out" : "Click to approve this concept"}
          className={`mt-0.5 shrink-0 w-5 h-5 rounded-control border flex items-center justify-center ${done ? "border-good bg-good text-good-ink cursor-default" : picked ? "border-accent bg-accent text-accent-ink cursor-pointer" : "border-line-strong text-transparent hover:border-accent cursor-pointer"}`}
        >
          <Check size={12} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{c.title}</p>
          <p className="text-[11px] text-muted mt-0.5">
            <span className="text-fg" title={APPROACH_HINT[c.approach]}>
              {APPROACH_LABEL[c.approach]}
            </span>{" "}
            · {FORMAT_LABEL[c.format]} · {c.polish === "native" ? "looks like a real post" : "designed layout"}
          </p>
        </div>
        {done && (
          <span className="text-[11px] text-good inline-flex items-center gap-1 whitespace-nowrap">
            <ArrowDown size={11} /> generated below
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-4 items-start">
        <div>
          <AdSketch concept={c} packUrl={packUrl} brand={brand} />
          <p className="text-[10px] text-dim mt-1">Layout sketch with the real words. The image is made only after you approve.</p>
        </div>
        <div className="space-y-1.5 min-w-0">
          <Row label="For">{c.audience}</Row>
          <Row label="Why this message">{c.insight}</Row>
          {c.authority && <Row label="Who they trust">{c.authority}</Row>}
          <div>
            <p className="text-xs text-muted">Words on the ad</p>
            <ul className="mt-0.5 space-y-0.5">
              {words.map((w, i) => (
                <li key={i} className={`text-xs ${i === 0 ? "text-fg font-semibold" : "text-fg"}`}>
                  “{w}”
                </li>
              ))}
            </ul>
            {long && (
              <p className="text-[11px] text-warn inline-flex items-center gap-1 mt-1">
                <AlertTriangle size={10} /> Headline is {wordCount(c.headline)} words; nine or fewer reads in a second.
              </p>
            )}
          </div>
          <Row label="The picture">{c.visual}</Row>
          <Row label="Why it should work">{c.why}</Row>
          {c.borrowed && <Row label="Borrowed idea">{c.borrowed}</Row>}
          {c.next_test && <Row label="If it gets spend, test next">{c.next_test}</Row>}
        </div>
      </div>

      {!done && (
        <div className="mt-3">
          {revising ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && note.trim() && !busy && void send()} placeholder='What should change? e.g. "gawing Taglish", "a lola instead of a coach", "headline: For dads who own too many caps"' className={`${field} flex-1 min-w-64 !py-1.5`} />
              <Button primary onClick={() => void send()} busy={busy} disabled={!note.trim() || locked} className="!px-2.5 !py-1 !text-xs">
                Rewrite concept
              </Button>
              <Button ghost onClick={() => setRevising(false)} className="!px-2.5 !py-1 !text-xs">
                Cancel
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setRevising(true)} disabled={locked} className="text-[11px] text-accent hover:text-fg inline-flex items-center gap-1 cursor-pointer disabled:opacity-50">
              <PenLine size={11} /> Change this concept
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── The mode: plan for a page, review, approve ─── */

interface OwnAnswer {
  id?: string;
  plans: OwnPlanRow[];
  runs?: RunView[];
}

export function OwnAds({ page, itemId, onChange, setError }: { page: StudioPage; itemId: string | null; onChange: (next: { plans: OwnPlanRow[]; runs?: RunView[] }) => void; setError: (e: string | null) => void }) {
  const [store, setStore] = useState(page.item?.store ?? (page.stores.includes("FOLIQ") ? "FOLIQ" : page.stores[0] ?? ""));
  const [product, setProduct] = useState("");
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(4);
  const [versions, setVersions] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  /** Concepts left out of a plan's approval; everything else not yet generated is approved by default. */
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  const products = useMemo(() => productsOf(page.sources.brand.filter((b) => b.store === store)), [page, store]);
  const pickedProduct = products.length > 1 ? (products.includes(product) ? product : products[0]) : null;

  const packFor = (plan: OwnPlanRow) => {
    const photos = page.sources.brand.filter((b) => b.store === plan.store && !isContents(b.kind) && (!plan.product || !b.product || b.product.toLowerCase() === plan.product.toLowerCase()));
    return photos[0]?.url ?? null;
  };

  const call = async (tag: string, init: RequestInit & { url?: string }) => {
    setBusy(tag);
    setError(null);
    try {
      const r = await api<OwnAnswer>(init.url ?? "/api/owner/image-studio/own", init);
      onChange({ plans: r.plans, runs: r.runs });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const makePlan = () => call("plan", { method: "POST", body: JSON.stringify({ action: "plan", store, product: pickedProduct, brief, count }) });
  const revise = (planId: string, conceptId: string, note: string) => call(`revise:${conceptId}`, { method: "POST", body: JSON.stringify({ action: "revise", plan_id: planId, concept_id: conceptId, note }) });
  const approve = (plan: OwnPlanRow, ids: string[]) => call(`approve:${plan.id}`, { method: "POST", body: JSON.stringify({ action: "approve", plan_id: plan.id, concept_ids: ids, versions, item_id: itemId }) });
  const remove = (id: string) => call(`delete:${id}`, { method: "DELETE", url: `/api/owner/image-studio/own?id=${id}` });

  return (
    <>
      <Panel>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5 items-start">
          <div>
            <Label>Page</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="The page these ads are for" className={select}>
                {page.stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {pickedProduct && (
                <select value={pickedProduct} onChange={(e) => setProduct(e.target.value)} aria-label="Which product the ads sell" className={select}>
                  {products.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-[11px] text-muted mt-2 leading-relaxed">The plan is written for this page only, from its Brand Kit profile, its product photos and the ads it already ran.</p>
            {!page.profiled.includes(store) && store && (
              <p className="text-[11px] text-warn mt-1">
                No brand profile for {store} yet, so the plan will only know what the product photos show.{" "}
                <Link href={`/owner/brand-kit?store=${encodeURIComponent(store)}`} className="text-accent hover:text-fg">
                  Add one in the Brand Kit
                </Link>
                .
              </p>
            )}
            {store && !page.sources.brand.some((b) => b.store === store) && (
              <p className="text-[11px] text-warn mt-1">
                No product photos for {store} yet, so the pack cannot be shown.{" "}
                <Link href={`/owner/brand-kit?store=${encodeURIComponent(store)}`} className="text-accent hover:text-fg">
                  Upload them in the Brand Kit
                </Link>
                .
              </p>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <Label>What should these ads do? · optional</Label>
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder='e.g. "for moms 35+ who gave up on diets", "push the 3-box bundle", "Taglish, funny, no price", or leave empty and let the planner choose' className={`${field} resize-none`} />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button primary onClick={() => void makePlan()} busy={busy === "plan"} disabled={!store || busy !== null}>
                <Sparkles size={13} /> Plan {count} ads for {store || "…"}
              </Button>
              <div className="flex items-center gap-1 rounded-control bg-canvas border border-line-strong p-0.5" title="How many concepts in the plan">
                {[3, 4, 6].map((n) => (
                  <button key={n} type="button" onClick={() => setCount(n)} className={`px-2.5 py-1 rounded-control text-xs font-semibold cursor-pointer ${count === n ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">{busy === "plan" ? "Writing the plan, about a minute…" : "About a minute. No image credits are used until you approve."}</span>
            </div>
          </div>
        </div>
      </Panel>

      {page.plans.length === 0 && busy !== "plan" && (
        <Panel>
          <p className="text-sm text-muted text-center my-6">No plans yet. Pick a page and plan its ads: you will see each concept sketched with its reasoning before anything is generated.</p>
        </Panel>
      )}
      {busy === "plan" && (
        <Panel>
          <p className="text-sm text-muted my-6 flex items-center justify-center gap-2">
            <Loader2 size={15} className="animate-spin" /> Studying {store}: why its buyer hesitates, who to speak to, what to show.
          </p>
        </Panel>
      )}

      {page.plans.map((plan) => {
        const open = plan.concepts.filter((c) => !c.run_id);
        const approved = open.filter((c) => !skipped[c.id]);
        const packUrl = packFor(plan);
        const locked = busy !== null;
        return (
          <Panel key={plan.id}>
            <div className="flex items-start gap-3 flex-wrap mb-3">
              <div className="flex-1 min-w-64">
                <p className="text-sm font-semibold text-fg">
                  Creative plan · {plan.store}
                  {plan.product ? ` · ${plan.product}` : ""}
                </p>
                <p className="text-[11px] text-muted mt-0.5">
                  {timeAgo(plan.created_at)} · {plan.concepts.length} concepts · {open.length === 0 ? "all generated" : plan.status === "approved" ? `${plan.concepts.length - open.length} generated, ${open.length} waiting` : "waiting for your approval"}
                  {plan.brief ? ` · brief: ${plan.brief}` : ""}
                </p>
              </div>
              <ConfirmButton question="Delete plan?" label="Delete plan" onConfirm={() => void remove(plan.id)} className="text-[11px] text-muted hover:text-bad inline-flex items-center gap-1 cursor-pointer">
                <Trash2 size={11} />
              </ConfirmButton>
            </div>
            {plan.diagnosis && (
              <p className="text-xs text-fg leading-relaxed border-l-2 border-accent pl-3 mb-4">
                <span className="text-muted">Why this buyer hesitates: </span>
                {plan.diagnosis}
              </p>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {plan.concepts.map((c) => (
                <ConceptCard key={c.id} concept={c} packUrl={packUrl} brand={plan.store} picked={!skipped[c.id]} onPick={() => setSkipped((s) => ({ ...s, [c.id]: !s[c.id] }))} onRevise={(note) => revise(plan.id, c.id, note)} busy={busy === `revise:${c.id}`} locked={locked} />
              ))}
            </div>
            {open.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap mt-4 pt-3 border-t border-line">
                <Button primary onClick={() => void approve(plan, approved.map((c) => c.id))} busy={busy === `approve:${plan.id}`} disabled={approved.length === 0 || locked}>
                  <Check size={13} /> Approve and generate {approved.length} {approved.length === 1 ? "ad" : "ads"} · {credits(approved.length * versions * STILL_CREDITS)}
                </Button>
                <div className="flex items-center gap-1 rounded-control bg-canvas border border-line-strong p-0.5" title="Versions of each approved ad">
                  {[1, 2].map((n) => (
                    <button key={n} type="button" onClick={() => setVersions(n)} className={`px-2.5 py-1 rounded-control text-xs font-semibold cursor-pointer ${versions === n ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
                      {n} {n === 1 ? "version" : "versions"}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted">Untick a concept to leave it out. Renders take about 3 min and appear below with a review.</span>
              </div>
            )}
          </Panel>
        );
      })}
    </>
  );
}
