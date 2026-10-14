"use client";

import { Film, Loader2, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BoardView } from "@/lib/marketing-board/types";
import type { ProjectSummary, ProjectView } from "@/lib/remake/types";
import { Button, Panel, Pill, api, timeAgo } from "@/components/hook-studio/ui";
import { SourceBadge } from "@/components/marketing-board/format";

const STATUS_TONE = { splitting: "run", classifying: "run", ready: "ok", failed: "bad" } as const;
const STATUS_LABEL = { splitting: "Cutting clips", classifying: "Labelling", ready: "Ready", failed: "Failed" } as const;

/** Every remake, and the two ways to start one: a board card or an upload. */
export function RemakeList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("/api/owner/remake/projects").then((r) => setProjects(r.projects)).catch((e) => setError(e.message));
    api<BoardView>("/api/owner/marketing-board").then(setBoard).catch(() => {});
  }, []);

  const start = async (body: Record<string, unknown>, label: string) => {
    setStarting(label);
    setError(null);
    try {
      const r = await api<{ project: ProjectView }>("/api/owner/remake/projects", { method: "POST", body: JSON.stringify(body) });
      router.push(`/owner/clipper/${r.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
      setStarting(null);
    }
  };

  const upload = async (file: File) => {
    setStarting("upload");
    setError(null);
    try {
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/remake/upload-url", {
        method: "POST",
        body: JSON.stringify({ kind: "source", mime: file.type }),
      });
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      await start({ source_path: path, title: file.name.replace(/\.[^.]+$/, "").slice(0, 120) }, "upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStarting(null);
    }
  };

  const readyCards = (board?.items ?? []).filter((i) => i.video_status === "ready" && i.video_url);
  const clippedTitles = new Set((projects ?? []).map((p) => p.title));

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Clipper</h1>
          <p className="text-sm text-gray-500 mt-1">Cut a real reference into clips. Keep them, or redo any clip from our still with our product and person.</p>
        </div>
        <div className="flex gap-2">
          <Button primary onClick={() => setPickOpen((v) => !v)} disabled={starting !== null}>
            <Plus size={14} /> From a board card
          </Button>
          <Button onClick={() => fileRef.current?.click()} busy={starting === "upload"} disabled={starting !== null}>
            <Upload size={14} /> Upload a video
          </Button>
          <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

      {pickOpen && (
        <Panel className="mt-4">
          <p className="text-sm text-gray-300 mb-3">Pick a reference that already has a saved copy.</p>
          {readyCards.length === 0 ? (
            <p className="text-xs text-gray-500">
              No board card has a saved copy yet. Add a link on the <Link href="/owner/marketing-board" className="text-purple-300">Marketing Board</Link> first.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {readyCards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={starting !== null}
                  onClick={() => start({ board_item_id: c.id }, c.id)}
                  className="text-left rounded-lg border border-gray-700 hover:border-purple-500 p-1.5 cursor-pointer disabled:opacity-50"
                >
                  <div className="aspect-[9/16] rounded-md bg-gray-950 overflow-hidden">
                    {c.thumb_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumb_url} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <SourceBadge type={c.source_type} />
                    {starting === c.id && <Loader2 size={11} className="animate-spin text-gray-400" />}
                  </div>
                  <p className="text-xs text-white mt-1 line-clamp-2">{c.title || c.source_url}</p>
                  {c.title && clippedTitles.has(c.title) && <p className="text-[10px] text-green-400 mt-0.5">Already clipped · opens it</p>}
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      {projects === null && !error && <Loader2 size={20} className="mt-10 mx-auto animate-spin text-gray-500" />}
      {projects && projects.length === 0 && !pickOpen && (
        <div className="mt-8 rounded-xl border border-dashed border-gray-800 p-10 text-center">
          <Film size={28} className="mx-auto text-gray-600" />
          <p className="text-sm text-gray-400 mt-3">Nothing clipped yet. Start from a board card or upload a reference.</p>
        </div>
      )}
      {projects && projects.length > 0 && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/owner/clipper/${p.id}`} className="flex gap-3 rounded-xl border border-gray-800 bg-gray-900/40 hover:bg-gray-800/60 p-3">
              <div className="w-16 shrink-0 aspect-[9/16] rounded-md bg-gray-950 overflow-hidden">
                {p.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cover_url} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{p.title || "Clip"}</p>
                <p className="text-xs text-gray-500 mt-0.5">{p.store ?? "No store"} · {timeAgo(p.created_at)}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
                  <span className="text-[11px] text-gray-500">
                    {p.clips_done}/{p.shots} clips
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
