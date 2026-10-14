"use client";

import { Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * A clip that plays by itself: muted and looping as soon as it is on screen,
 * sound on click. No play button to hunt for.
 */
export function ClipVideo({
  src,
  poster,
  className = "",
  autoplay = true,
  hoverOnly = false,
  videoRef,
  label,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  autoplay?: boolean;
  /** Tray thumbnails: still until hovered. */
  hoverOnly?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  label?: string;
}) {
  const inner = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? inner;
  const [muted, setMuted] = useState(true);

  // Only play while visible; a page of a dozen clips should not all decode at once.
  useEffect(() => {
    const el = ref.current;
    if (!el || !autoplay || hoverOnly) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoplay, hoverOnly, ref, src]);

  return (
    <div className={`relative group ${className}`}>
      <video
        ref={ref}
        key={src}
        src={src}
        poster={poster ?? undefined}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onMouseEnter={hoverOnly ? (e) => void e.currentTarget.play().catch(() => {}) : undefined}
        onMouseLeave={hoverOnly ? (e) => e.currentTarget.pause() : undefined}
        onClick={(e) => {
          const v = e.currentTarget;
          setMuted((m) => !m);
          void v.play().catch(() => {});
        }}
        className="w-full h-full object-cover rounded-lg bg-black cursor-pointer"
      />
      {label && <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">{label}</span>}
      <span className="absolute bottom-1.5 right-1.5 text-white/90 bg-black/50 rounded-full p-1 opacity-70 group-hover:opacity-100">
        {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
      </span>
      {hoverOnly && <Play size={16} className="absolute inset-0 m-auto text-white/80 pointer-events-none group-hover:opacity-0" />}
    </div>
  );
}

/** Reference and ours side by side, with one button that starts both from zero (ours carries the sound). */
export function ComparePlayer({ refSrc, ourSrc, ourLabel }: { refSrc: string | null; ourSrc: string | null; ourLabel: string }) {
  const a = useRef<HTMLVideoElement | null>(null);
  const b = useRef<HTMLVideoElement | null>(null);
  const playBoth = () => {
    for (const v of [a.current, b.current]) {
      if (!v) continue;
      v.currentTime = 0;
      void v.play().catch(() => {});
    }
    if (b.current) b.current.muted = false;
    if (a.current) a.current.muted = true;
  };
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div className="aspect-[9/16]">
          {refSrc ? <ClipVideo src={refSrc} videoRef={a} label="Reference" className="h-full" /> : <div className="h-full rounded-lg bg-gray-950 border border-dashed border-gray-800" />}
        </div>
        <div className="aspect-[9/16]">
          {ourSrc ? <ClipVideo src={ourSrc} videoRef={b} label={ourLabel} className="h-full" /> : <div className="h-full rounded-lg bg-gray-950 border border-dashed border-gray-800 flex items-center justify-center text-[11px] text-gray-600 p-3 text-center">Ours appears here</div>}
        </div>
      </div>
      {refSrc && ourSrc && (
        <button type="button" onClick={playBoth} className="mt-1.5 text-[11px] text-purple-300 hover:text-white inline-flex items-center gap-1 cursor-pointer">
          <Play size={11} /> Play both in sync
        </button>
      )}
    </div>
  );
}
