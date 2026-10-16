"use client";

import { useEffect, useRef, useState } from "react";

/** About one frame per this many CSS pixels: a 9:16 frame at the strip's 88px height. */
const SLOT_PX = 50;
const MAX_SLOTS = 120;
const SEEK_TIMEOUT_MS = 10_000;

/**
 * The Clipper timeline's pictures, laid out on the same time axis as the
 * clip lines and the drag range: slot i covers [i/n, (i+1)/n] of the
 * reference and shows the real frame from its middle, grabbed in the
 * browser from the reference video.
 *
 * Until a slot's frame is grabbed it borrows the worker's strip (one tile
 * per second, first `spriteCount` seconds), but only where that strip
 * has the right second; past it the slot stays dark rather than show a
 * frame from somewhere else.
 */
export function FilmStrip({
  src,
  duration,
  spriteUrl,
  spriteCount,
}: {
  src: string | null;
  duration: number;
  spriteUrl: string | null;
  spriteCount: number | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLVideoElement>(null);
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
  const [slots, setSlots] = useState(0);

  // One slot per ~SLOT_PX of width; recount only when the number changes.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSlots(Math.max(1, Math.min(MAX_SLOTS, Math.round(el.clientWidth / SLOT_PX))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Grab each slot's frame from a hidden copy of the reference, left to right.
  useEffect(() => {
    const v = probe.current;
    if (!v || !src || !duration || !slots) return;
    let cancelled = false;

    const waitFor = (ready: () => boolean, event: keyof HTMLMediaElementEventMap, start?: () => void) =>
      new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          v.removeEventListener(event, onOk);
          v.removeEventListener("error", onErr);
          resolve(ok);
        };
        const onOk = () => finish(true);
        const onErr = () => finish(false);
        const timer = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
        v.addEventListener(event, onOk);
        v.addEventListener("error", onErr);
        if (ready()) finish(true);
        else start?.();
      });

    const draw = (c: HTMLCanvasElement) => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (!v.videoWidth || !v.videoHeight) return;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      // Cover: fill the slot, crop the overflow evenly.
      const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
      const sw = w / scale;
      const sh = h / scale;
      ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, w, h);
    };

    void (async () => {
      if (!(await waitFor(() => v.readyState >= 1, "loadedmetadata"))) return;
      for (let i = 0; i < slots && !cancelled; i++) {
        const t = Math.min(duration - 0.05, ((i + 0.5) / slots) * duration);
        const ok = await waitFor(() => false, "seeked", () => {
          v.currentTime = t;
        });
        if (cancelled) return;
        const c = canvases.current[i];
        if (ok && c) draw(c);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, duration, slots]);

  const n = spriteCount ?? 0;
  return (
    <div ref={wrap} className="relative h-[88px] w-full flex">
      {Array.from({ length: slots }, (_, i) => {
        const second = Math.floor(((i + 0.5) / slots) * duration);
        const tile = spriteUrl && n > 0 && duration > 0 && second < n ? second : null;
        return (
          <div
            key={`${slots}-${i}`}
            className="relative h-full flex-1 min-w-0 bg-gray-950 border-r border-black/40 last:border-r-0"
            style={
              tile !== null
                ? { backgroundImage: `url(${spriteUrl})`, backgroundSize: `${n * 100}% 100%`, backgroundPosition: `${n > 1 ? (tile / (n - 1)) * 100 : 0}% 0` }
                : undefined
            }
          >
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }}
              className="absolute inset-0 w-full h-full"
            />
          </div>
        );
      })}
      {src && <video ref={probe} src={src} muted playsInline preload="auto" aria-hidden tabIndex={-1} className="absolute left-0 top-0 w-px h-px opacity-0 pointer-events-none" />}
    </div>
  );
}
