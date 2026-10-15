"use client";

import { CalendarClock, Download, ExternalLink, Film, Link2, Loader2, Paperclip, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  type BoardItem,
  type BoardStatus,
  type Person,
  type SubmittedAdOption,
} from "@/lib/marketing-board/types";
import { Button, ConfirmButton, Label, api, timeAgo } from "@/components/hook-studio/ui";
import { AdPicker } from "./ad-picker";
import { SourceBadge, fmtWhen, isFuture } from "./format";
import { FbAdPlayer, ReferencePlayer, UploadPlayer } from "./players";

/**
 * Supabase serves a signed URL as an attachment when `download=<name>` is
 * added, so the browser saves the file instead of playing it.
 */
function downloadHref(url: string, title: string | null): string {
  const base = (title || "reference").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "reference";
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${base}.mp4`)}`;
}

const field =
  "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500";

/**
 * The drawer for one card: the reference, who does it and by when, the
 * instruction notes, and the finished ads attached as outputs.
 */
export function ItemDetail({
  item,
  people,
  stores,
  onChange,
  onDeleted,
  onClose,
}: {
  item: BoardItem;
  people: Person[];
  stores: string[];
  onChange: (item: BoardItem) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [title, setTitle] = useState(item.title ?? "");
  const [remaking, setRemaking] = useState(false);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTitle(item.title ?? ""), [item.id, item.title]);

  const base = `/api/owner/marketing-board/items/${item.id}`;
  const call = async (fn: () => Promise<{ item: BoardItem }>) => {
    setError(null);
    try {
      const r = await fn();
      onChange(r.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };
  const patch = (body: Record<string, unknown>) =>
    call(() => api<{ item: BoardItem }>(base, { method: "PATCH", body: JSON.stringify(body) }));

  const postNote = async () => {
    if (!note.trim()) return;
    setPosting(true);
    await call(() => api<{ item: BoardItem }>(`${base}/comments`, { method: "POST", body: JSON.stringify({ body: note }) }));
    setNote("");
    setPosting(false);
  };

  const attachAd = (ad: SubmittedAdOption) =>
    call(() => api<{ item: BoardItem }>(`${base}/outputs`, { method: "POST", body: JSON.stringify({ kind: "fb_ad", draft_id: ad.draft_id }) }));

  const uploadOutput = async (file: File) => {
    setError(null);
    try {
      setUploading("Uploading…");
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>(
        "/api/owner/marketing-board/upload-url",
        { method: "POST", body: JSON.stringify({ item_id: item.id, mime: file.type }) }
      );
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      setUploading("Attaching…");
      const r = await api<{ item: BoardItem }>(`${base}/outputs`, {
        method: "POST",
        body: JSON.stringify({ kind: "upload", file_path: path, note: file.name.slice(0, 120) }),
      });
      onChange(r.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await api(base, { method: "DELETE" });
      onDeleted(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const startRemake = async () => {
    setRemaking(true);
    setError(null);
    try {
      const r = await api<{ project: { id: string } }>("/api/owner/remake/projects", { method: "POST", body: JSON.stringify({ board_item_id: item.id }) });
      router.push(`/owner/clipper/${r.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the Clipper");
      setRemaking(false);
    }
  };

  const attachedAdIds = new Set(item.outputs.map((o) => o.fb_ad_id).filter((x): x is string => !!x));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start gap-3 p-4 border-b border-gray-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SourceBadge type={item.source_type} />
            {item.author && <span className="text-xs text-gray-500 truncate">{item.author}</span>}
            <a href={item.source_url} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1">
              <ExternalLink size={11} /> original
            </a>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== (item.title ?? "") && patch({ title })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="Give this reference a name"
            className="mt-2 w-full bg-transparent text-base font-semibold text-white placeholder:text-gray-600 focus:outline-none border-b border-transparent focus:border-gray-600"
          />
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white cursor-pointer p-1">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {error && <p className="text-xs text-red-300 bg-red-900/30 border border-red-800/60 rounded-lg px-3 py-2">{error}</p>}

        {item.kind === "image" ? (
          <div>
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_url} alt="" className="max-h-80 mx-auto rounded-lg object-contain bg-black" />
            ) : (
              <div className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-xs text-gray-500">
                {item.video_status === "failed" ? (
                  <>
                    <p className="text-red-300">{item.video_error || "Could not save the image"}</p>
                    <button type="button" onClick={() => call(() => api<{ item: BoardItem }>(`${base}/refetch`, { method: "POST" }))} className="mt-2 text-purple-300 hover:text-white cursor-pointer">Try again</button>
                  </>
                ) : (
                  <p className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Saving the image on the Mac…</p>
                )}
              </div>
            )}
            {item.image_url && (
              <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-gray-500">
                <span>Saved image{item.width && item.height ? ` · ${item.width}×${item.height}` : ""}</span>
                <button type="button" onClick={() => router.push(`/owner/image-studio?item=${item.id}`)} className="inline-flex items-center gap-1 font-semibold text-purple-300 hover:text-white cursor-pointer">
                  <Sparkles size={11} /> Make ours
                </button>
                <a href={downloadHref(item.image_url, item.title)} className="inline-flex items-center gap-1 font-semibold text-gray-300 hover:text-white">
                  <Download size={11} /> Download
                </a>
              </div>
            )}
          </div>
        ) : (
          <ReferencePlayer
            item={item}
            onRetry={() => call(() => api<{ item: BoardItem }>(`${base}/refetch`, { method: "POST" }))}
          />
        )}
        {item.kind !== "image" && item.video_url && (
          <div className="-mt-3 flex items-center justify-center gap-3 text-[11px] text-gray-500">
            <span>
              Saved copy{item.height ? ` · ${item.height}p` : ""}{item.duration ? ` · ${Math.round(item.duration)}s` : ""}
            </span>
            <button type="button" onClick={startRemake} disabled={remaking} className="inline-flex items-center gap-1 font-semibold text-purple-300 hover:text-white cursor-pointer disabled:opacity-50">
              {remaking ? <Loader2 size={11} className="animate-spin" /> : <Film size={11} />} Open in Clipper
            </button>
            <a href={downloadHref(item.video_url, item.title)} className="inline-flex items-center gap-1 font-semibold text-gray-300 hover:text-white">
              <Download size={11} /> Download
            </a>
          </div>
        )}

        <div>
          <Label>Status</Label>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-900 p-1">
            {BOARD_STATUSES.map((s: BoardStatus) => (
              <button
                key={s}
                type="button"
                onClick={() => s !== item.status && patch({ status: s })}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  item.status === s
                    ? s === "done" ? "bg-green-600 text-white" : s === "in_progress" ? "bg-amber-600 text-white" : "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {item.done_at && <p className="text-[11px] text-gray-500 mt-1.5">Marked done {fmtWhen(item.done_at)}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Assigned to</Label>
            <select value={item.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || null })} className={field}>
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.role === "admin" ? " (admin)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Due</Label>
            <input type="date" value={item.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} className={field} />
          </div>
          <div className="col-span-2">
            <Label>Store</Label>
            <input
              list="board-stores"
              defaultValue={item.store ?? ""}
              key={`${item.id}-store`}
              onBlur={(e) => e.target.value.trim() !== (item.store ?? "") && patch({ store: e.target.value })}
              placeholder="Which store is this ad for?"
              className={field}
            />
            <datalist id="board-stores">
              {stores.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <Label>Notes & instructions</Label>
          <div className="space-y-3">
            {item.comments.length === 0 && <p className="text-xs text-gray-600">No notes yet. Write what the marketer should copy, change or avoid.</p>}
            {item.comments.map((c) => (
              <div key={c.id} className="group">
                <p className="text-[11px] text-gray-500 flex items-center gap-2">
                  <span className="font-semibold text-gray-300">{c.author_name ?? "Someone"}</span>
                  <span title={fmtWhen(c.created_at)}>{timeAgo(c.created_at)}</span>
                  <ConfirmButton onConfirm={() => call(() => api<{ item: BoardItem }>(`${base}/comments/${c.id}`, { method: "DELETE" }))} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-300 cursor-pointer">
                    <Trash2 size={11} />
                  </ConfirmButton>
                </p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 items-end">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void postNote();
              }}
              rows={2}
              placeholder="Add a note… (⌘↵ to post)"
              className={`${field} resize-none`}
            />
            <Button primary onClick={postNote} busy={posting} disabled={!note.trim()} title="Post note">
              <Send size={14} />
            </Button>
          </div>
        </div>

        <div>
          <Label>Output · what was made from this</Label>
          <div className="space-y-3">
            {item.outputs.length === 0 && !picking && (
              <p className="text-xs text-gray-600">Nothing attached yet. Attach the submitted ad or upload the finished video.</p>
            )}
            {item.outputs.map((o) => {
              const scheduled = isFuture(o.start_time);
              return (
                <div key={o.id} className="rounded-xl border border-gray-700/80 bg-gray-800/40 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate flex items-center gap-1.5">
                        {o.kind === "fb_ad" ? <Link2 size={12} className="text-blue-300 shrink-0" /> : <Paperclip size={12} className="text-gray-400 shrink-0" />}
                        {o.kind === "fb_ad" ? o.ad_name : o.note || (/\.(png|jpe?g|webp)$/i.test(o.file_path ?? "") ? "Uploaded image" : "Uploaded video")}
                      </p>
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 flex-wrap">
                        {o.added_by_name && <span>{o.added_by_name}</span>}
                        <span>· {timeAgo(o.created_at)}</span>
                        {o.start_time && (
                          <span className={`inline-flex items-center gap-1 ${scheduled ? "text-amber-300" : "text-green-400"}`}>
                            · <CalendarClock size={10} /> {scheduled ? "runs" : "started"} {fmtWhen(o.start_time)}
                          </span>
                        )}
                      </p>
                    </div>
                    <ConfirmButton question="Remove?" label="Remove" onConfirm={() => call(() => api<{ item: BoardItem }>(`${base}/outputs/${o.id}`, { method: "DELETE" }))} className="text-gray-500 hover:text-red-300 cursor-pointer p-1">
                      <Trash2 size={13} />
                    </ConfirmButton>
                  </div>
                  {o.kind === "fb_ad" ? <FbAdPlayer output={o} /> : <UploadPlayer output={o} />}
                </div>
              );
            })}
            {picking && <AdPicker attachedAdIds={attachedAdIds} onPick={attachAd} onClose={() => setPicking(false)} />}
          </div>
          {!picking && (
            <div className="mt-3 flex gap-2 flex-wrap">
              <Button onClick={() => setPicking(true)}>
                <Link2 size={14} /> Attach submitted ad
              </Button>
              <Button onClick={() => fileRef.current?.click()} disabled={uploading !== null}>
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploading ?? "Upload video"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadOutput(f);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-gray-800 flex items-center justify-between">
        <p className="text-[11px] text-gray-600">Added {timeAgo(item.created_at)}</p>
        <ConfirmButton onConfirm={remove} question="Delete this card and its files?" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-300 cursor-pointer">
          <Trash2 size={13} /> Delete
        </ConfirmButton>
      </div>
    </div>
  );
}
