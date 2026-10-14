"use client";

import { AlertTriangle, ExternalLink, Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { BoardItem, OutputView, VideoSource } from "@/lib/marketing-board/types";
import { api } from "@/components/hook-studio/ui";

const FRAME = "max-h-[55vh] w-auto max-w-full mx-auto rounded-xl bg-black";

/**
 * The reference itself. The saved copy plays in our own player; until the
 * Mac has saved it, TikTok and YouTube fall back to their embeds, and
 * everything else shows the saving state with a link to the original.
 */
export function ReferencePlayer({ item, onRetry }: { item: BoardItem; onRetry: () => void }) {
  if (item.video_url) {
    return (
      <video
        key={item.video_url}
        src={item.video_url}
        poster={item.thumb_url ?? undefined}
        controls
        playsInline
        preload="metadata"
        className={FRAME}
      />
    );
  }
  if (item.embed_id && item.source_type === "tiktok") {
    return (
      <iframe
        src={`https://www.tiktok.com/embed/v2/${item.embed_id}`}
        title="TikTok"
        allow="encrypted-media; fullscreen"
        className="w-full max-w-[325px] mx-auto h-[575px] rounded-xl bg-black border-0"
      />
    );
  }
  if (item.embed_id && item.source_type === "youtube") {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${item.embed_id}`}
        title="YouTube"
        allow="encrypted-media; fullscreen"
        allowFullScreen
        className="w-full aspect-video rounded-xl bg-black border-0"
      />
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-6 text-center">
      {item.external_thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.external_thumbnail_url} alt="" className="max-h-64 mx-auto rounded-lg mb-4 object-contain" />
      )}
      {item.video_status === "failed" ? (
        <>
          <AlertTriangle size={22} className="mx-auto text-red-400" />
          <p className="text-sm text-red-300 mt-2">Could not save a copy</p>
          <p className="text-xs text-gray-500 mt-1 break-words">{item.video_error}</p>
          <button type="button" onClick={onRetry} className="mt-3 text-xs font-semibold text-purple-300 hover:text-white cursor-pointer">
            Try again
          </button>
        </>
      ) : (
        <>
          <Loader2 size={22} className="mx-auto text-gray-500 animate-spin" />
          <p className="text-sm text-gray-400 mt-2">
            {item.video_status === "saving" ? "Saving a high-quality copy on the Mac…" : "Waiting for the Mac worker…"}
          </p>
          <p className="text-xs text-gray-600 mt-1">The preview appears here once the copy is saved.</p>
        </>
      )}
      <a
        href={item.source_url}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-gray-300 hover:text-white"
      >
        <ExternalLink size={12} /> Open original
      </a>
    </div>
  );
}

/** An attached Facebook ad: the video is resolved from Facebook when opened. */
export function FbAdPlayer({ output }: { output: OutputView }) {
  const [state, setState] = useState<{ loading: boolean; src: VideoSource | null; error: string | null }>({
    loading: false,
    src: null,
    error: null,
  });

  const open = async () => {
    setState({ loading: true, src: null, error: null });
    const q = new URLSearchParams();
    if (output.fb_video_id) q.set("video_id", output.fb_video_id);
    if (output.fb_ad_id) q.set("fb_ad_id", output.fb_ad_id);
    if (output.ad_account_id) q.set("account_id", output.ad_account_id);
    try {
      const src = await api<VideoSource>(`/api/owner/marketing-board/video-source?${q}`);
      setState({ loading: false, src, error: null });
    } catch (e) {
      setState({ loading: false, src: null, error: e instanceof Error ? e.message : "Could not load the video" });
    }
  };

  if (state.src?.source) {
    return <video src={state.src.source} poster={state.src.thumbnail ?? undefined} controls playsInline autoPlay className={FRAME} />;
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={state.loading}
      className="w-full rounded-xl border border-gray-700 bg-gray-900 hover:bg-gray-800 p-5 text-center cursor-pointer disabled:cursor-wait"
    >
      {state.loading ? (
        <Loader2 size={20} className="mx-auto text-gray-400 animate-spin" />
      ) : (
        <Play size={20} className="mx-auto text-gray-300" />
      )}
      <p className="text-xs text-gray-400 mt-2">{state.loading ? "Asking Facebook for the video…" : "Play the ad's video"}</p>
      {state.error && <p className="text-xs text-red-300 mt-2 break-words">{state.error}</p>}
    </button>
  );
}

/** An uploaded output file. */
export function UploadPlayer({ output }: { output: OutputView }) {
  if (!output.file_url) return <p className="text-xs text-gray-500">File missing</p>;
  return <video src={output.file_url} controls playsInline preload="metadata" className={FRAME} />;
}
