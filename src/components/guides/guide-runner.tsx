"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GUIDE_PARAM, getGuide, guidesFor } from "@/lib/guides/registry";
import { dismissGuideOffer, finishGuide, saveGuideStep } from "@/lib/guides/actions";
import type { Guide, GuidePlace, GuideProgress, GuideStep } from "@/lib/guides/types";
import { GUIDE_START_EVENT } from "./start";

/**
 * Runs a guide on the page it is mounted in: the page darkens, a clear box
 * follows the step's element, and a card beside it says what to do. Starts
 * from `?guide=<id>`, from the page's "?" button (startGuide), or from the
 * one-time offer a marketer sees the first time they open a page that has
 * a guide. Progress is saved per employee as they go.
 */

interface Active {
  guide: Guide;
  step: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TipPos {
  left: number;
  top: number;
  place: GuidePlace;
  /** The arrow's offset along the card's edge. */
  arrow: number;
}

const PAD = 8;
const GAP = 14;
const MARGIN = 12;
const SCRIM = "rgb(0 0 0 / 0.62)";

const q = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-guide="${name}"]`);

/** Wait for a `data-guide` element to be on the page, up to `ms`. */
async function waitFor(name: string, ms: number): Promise<HTMLElement | null> {
  const until = Date.now() + ms;
  for (;;) {
    const el = q(name);
    if (el) return el;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 60));
  }
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);

/** `**text**` in a step body is bold. */
function Body({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <b key={i} className="font-semibold text-fg">{p}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

export function GuideRunner({ progress: initial }: { progress: GuideProgress[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [active, setActive] = useState<Active | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [tip, setTip] = useState<TipPos | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const progress = useRef<Map<string, GuideProgress>>(new Map(initial.map((p) => [p.guide_id, p])));
  const activeRef = useRef<Active | null>(null);
  const seq = useRef(0);
  const offered = useRef<string | null>(null);
  const offerToast = useRef<string | number | null>(null);

  const setActiveBoth = (a: Active | null) => {
    activeRef.current = a;
    setActive(a);
    if (!a) {
      setBox(null);
      setTip(null);
    }
  };

  const remember = (guideId: string, patch: Partial<GuideProgress>) => {
    const prev = progress.current.get(guideId) ?? { guide_id: guideId, last_step: 0, completed_at: null, dismissed_at: null };
    progress.current.set(guideId, { ...prev, ...patch });
  };

  const leaveStep = (a: Active) => {
    const s = a.guide.steps[a.step];
    if (s?.clickAfter) q(s.clickAfter)?.click();
  };

  const finish = useCallback((guide: Guide) => {
    setActiveBoth(null);
    remember(guide.id, { completed_at: new Date().toISOString(), last_step: 0 });
    finishGuide(guide.id).catch(() => {});
    toast.success("Guide finished", { description: guide.title });
  }, []);

  /**
   * Enter step `i`, or the next one in `dir` whose element is on the page.
   * Off the end going forward means the guide is finished.
   */
  const enter = useCallback(
    async (guide: Guide, i: number, dir: 1 | -1) => {
      const my = ++seq.current;
      let j = i;
      while (j >= 0 && j < guide.steps.length) {
        const s: GuideStep = guide.steps[j];
        if (s.clickBefore) q(s.clickBefore)?.click();
        const el = await waitFor(s.target, s.clickBefore ? 1500 : 0);
        if (my !== seq.current) return;
        if (el) {
          setActiveBoth({ guide, step: j });
          remember(guide.id, { last_step: j });
          saveGuideStep(guide.id, j).catch(() => {});
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          return;
        }
        if (s.clickAfter) q(s.clickAfter)?.click();
        j += dir;
      }
      if (dir === 1) finish(guide);
    },
    [finish]
  );

  const start = useCallback(
    (id: string) => {
      const guide = getGuide(id);
      if (!guide || guide.href !== pathname) return;
      if (offerToast.current !== null) {
        toast.dismiss(offerToast.current);
        offerToast.current = null;
      }
      const p = progress.current.get(id);
      const from = p && !p.completed_at && p.last_step < guide.steps.length ? p.last_step : 0;
      void enter(guide, from, 1);
    },
    [pathname, enter]
  );

  const stop = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    seq.current++;
    leaveStep(a);
    setActiveBoth(null);
  }, []);

  const next = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    leaveStep(a);
    void enter(a.guide, a.step + 1, 1);
  }, [enter]);

  const back = useCallback(() => {
    const a = activeRef.current;
    if (!a || a.step === 0) return;
    leaveStep(a);
    void enter(a.guide, a.step - 1, -1);
  }, [enter]);

  // ?guide=<id> on the page's URL starts it, then the parameter is dropped.
  const wanted = params.get(GUIDE_PARAM);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!wanted || handled.current === wanted) return;
    const guide = getGuide(wanted);
    if (!guide || guide.href !== pathname) return;
    handled.current = wanted;
    // Not cleared on cleanup: dropping the parameter re-runs this effect.
    setTimeout(() => start(wanted), 400);
    router.replace(pathname);
  }, [wanted, pathname, router, start]);

  // The page's "?" button.
  useEffect(() => {
    const onStart = (e: Event) => start((e as CustomEvent<string>).detail);
    window.addEventListener(GUIDE_START_EVENT, onStart);
    return () => window.removeEventListener(GUIDE_START_EVENT, onStart);
  }, [start]);

  // First visit to a page that has a guide: offer it once.
  useEffect(() => {
    const guide = guidesFor(pathname)[0];
    if (!guide || wanted || offered.current === guide.id) return;
    if (progress.current.has(guide.id)) return;
    offered.current = guide.id;
    const t = setTimeout(() => {
      if (activeRef.current) return;
      offerToast.current = toast(`New to ${guide.title.toLowerCase().startsWith("the ") ? guide.title.slice(4) : guide.title}?`, {
        description: `See how it works in ${guide.steps.length} steps, about ${guide.minutes} min.`,
        duration: Infinity,
        action: { label: "Show me", onClick: () => start(guide.id) },
        cancel: {
          label: "Not now",
          onClick: () => {
            remember(guide.id, { dismissed_at: new Date().toISOString() });
            dismissGuideOffer(guide.id).catch(() => {});
          },
        },
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [pathname, wanted, start]);

  // Leaving the page ends the guide.
  useEffect(() => {
    if (!activeRef.current || activeRef.current.guide.href === pathname) return;
    const t = setTimeout(stop, 0);
    return () => clearTimeout(t);
  }, [pathname, stop]);

  // Keys while a guide runs.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        return;
      }
      // Typing in the clear box keeps its keys; Enter on a focused button is already a click.
      if (isTyping(e.target) || (e.key === "Enter" && e.target instanceof HTMLButtonElement)) return;
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        back();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, stop, next, back]);

  // Follow the element: measured every frame while a guide runs, so scrolling,
  // resizing and the page's own changes keep the box on it.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = "";
    const step = active.guide.steps[active.step];
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = q(step.target);
      const t = tipRef.current;
      if (!el || !t) return;
      const r = el.getBoundingClientRect();
      const b: Box = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const tw = t.offsetWidth;
      const th = t.offsetHeight;
      const fits: Record<GuidePlace, boolean> = {
        bottom: b.y + b.h + GAP + th < vh - MARGIN,
        top: b.y - GAP - th > MARGIN,
        right: b.x + b.w + GAP + tw < vw - MARGIN,
        left: b.x - GAP - tw > MARGIN,
      };
      let place: GuidePlace = step.place ?? "bottom";
      if (!fits[place]) place = (["bottom", "top", "right", "left"] as GuidePlace[]).find((k) => fits[k]) ?? "bottom";
      let left = 0;
      let top = 0;
      if (place === "bottom") {
        left = b.x + b.w / 2 - tw / 2;
        top = b.y + b.h + GAP;
      } else if (place === "top") {
        left = b.x + b.w / 2 - tw / 2;
        top = b.y - GAP - th;
      } else if (place === "right") {
        left = b.x + b.w + GAP;
        top = b.y + b.h / 2 - th / 2;
      } else {
        left = b.x - GAP - tw;
        top = b.y + b.h / 2 - th / 2;
      }
      left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
      top = Math.max(MARGIN, Math.min(top, vh - th - MARGIN));
      const arrow =
        place === "bottom" || place === "top"
          ? Math.max(14, Math.min(b.x + b.w / 2 - left - 6, tw - 26))
          : Math.max(14, Math.min(b.y + b.h / 2 - top - 6, th - 26));
      const key = [b.x, b.y, b.w, b.h, left, top, place, arrow].map((n) => (typeof n === "number" ? Math.round(n) : n)).join(",");
      if (key === last) return;
      last = key;
      setBox(b);
      setTip({ left, top, place, arrow });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  const { guide, step } = active;
  const s = guide.steps[step];
  const last = step === guide.steps.length - 1;
  const hole = box
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.x}px ${box.y}px, ${box.x}px ${box.y + box.h}px, ${box.x + box.w}px ${box.y + box.h}px, ${box.x + box.w}px ${box.y}px, ${box.x}px ${box.y}px)`
    : undefined;
  const arrowSide: Record<GuidePlace, string> = {
    bottom: "-top-[7px] rotate-45",
    top: "-bottom-[7px] rotate-[225deg]",
    right: "-left-[7px] -rotate-45",
    left: "-right-[7px] rotate-[135deg]",
  };

  return createPortal(
    <>
      {/* The darkened page takes no clicks; the clear box does. */}
      <div className="fixed inset-0 z-[90]" style={{ clipPath: hole }} aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none fixed z-[91] rounded-panel transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={{
          left: box?.x ?? 0,
          top: box?.y ?? 0,
          width: box?.w ?? 0,
          height: box?.h ?? 0,
          visibility: box ? "visible" : "hidden",
          boxShadow: `0 0 0 100vmax ${SCRIM}, 0 0 0 1.5px var(--t-accent), 0 0 0 5px var(--t-accent-soft)`,
        }}
      />
      <div
        ref={tipRef}
        role="dialog"
        aria-label={s.title}
        className="fixed z-[92] grid w-[min(340px,calc(100vw-24px))] gap-2 rounded-panel border border-line-strong bg-panel px-4 pb-3 pt-3.5 text-fg shadow-float transition-[top,left] duration-300 ease-out motion-reduce:transition-none"
        style={{ left: tip?.left ?? 0, top: tip?.top ?? 0, visibility: tip ? "visible" : "hidden" }}
      >
        {tip && (
          <span
            aria-hidden
            className={`absolute h-3 w-3 border-l border-t border-line-strong bg-panel ${arrowSide[tip.place]}`}
            style={tip.place === "bottom" || tip.place === "top" ? { left: tip.arrow } : { top: tip.arrow }}
          />
        )}
        <div className="flex items-center gap-2.5 font-num text-[11.5px] text-muted">
          <span>
            Step {step + 1} of {guide.steps.length}
          </span>
          <span className="h-[3px] flex-1 overflow-hidden rounded-sm bg-raised">
            <span className="block h-full bg-accent transition-[width] duration-300" style={{ width: `${((step + 1) / guide.steps.length) * 100}%` }} />
          </span>
        </div>
        <h3 className="text-[15px] text-fg">{s.title}</h3>
        <p className="text-[13.5px] leading-relaxed text-muted">
          <Body text={s.body} />
        </p>
        {s.tryIt && <p className="rounded-control bg-accent-soft px-2.5 py-1.5 text-[12.5px] text-accent">{s.tryIt}</p>}
        <div className="mt-1 flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={stop} className="mr-auto">
            Skip guide
          </Button>
          {step > 0 && (
            <Button size="sm" variant="secondary" onClick={back}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={next} autoFocus>
            {last ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </>,
    document.body
  );
}
