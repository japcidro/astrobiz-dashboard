"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  CalendarClock,
  Pencil,
  Trash2,
  Send,
  X,
  Check,
  FileVideo,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

interface Attachment {
  media_type?: string;
  type?: string;
  url?: string;
  title?: string;
  media?: { image?: { src?: string } };
}

interface ScheduledPost {
  id: string;
  message?: string;
  scheduled_publish_time?: number;
  created_time?: string;
  permalink_url?: string;
  attachments?: { data?: Attachment[] };
}

interface ScheduledPostsListProps {
  pageId: string;
  pageName: string;
}

/** Unix seconds -> value for a datetime-local input (local time). */
function tsToLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function ScheduledPostsList({ pageId, pageName }: ScheduledPostsListProps) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [editWhen, setEditWhen] = useState("");

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/facebook/page-post/scheduled?pageId=${encodeURIComponent(pageId)}`
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || "Hindi makuha ang mga naka-schedule na post.");
        setPosts([]);
      } else {
        const data = (json?.data as ScheduledPost[]) || [];
        data.sort(
          (a, b) => (a.scheduled_publish_time || 0) - (b.scheduled_publish_time || 0)
        );
        setPosts(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hindi makuha ang mga post.");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(post: ScheduledPost) {
    setEditingId(post.id);
    setEditMessage(post.message || "");
    setEditWhen(
      post.scheduled_publish_time ? tsToLocalInput(post.scheduled_publish_time) : ""
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setEditMessage("");
    setEditWhen("");
  }

  async function saveEdit(post: ScheduledPost) {
    const body: {
      pageId: string;
      postId: string;
      message?: string;
      scheduledPublishTime?: number;
    } = { pageId, postId: post.id };

    if (editMessage !== (post.message || "")) body.message = editMessage;

    if (editWhen) {
      const ts = Math.floor(new Date(editWhen).getTime() / 1000);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts)) {
        toast.error("Hindi wasto ang petsa/oras.");
        return;
      }
      if (ts < now + 10 * 60) {
        toast.error("Ang schedule ay dapat hindi bababa sa 10 minuto mula ngayon.");
        return;
      }
      if (ts !== post.scheduled_publish_time) body.scheduledPublishTime = ts;
    }

    if (body.message === undefined && body.scheduledPublishTime === undefined) {
      cancelEdit();
      return;
    }

    setBusyId(post.id);
    try {
      const res = await fetch("/api/facebook/page-post/scheduled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || "Hindi na-update.");
        return;
      }
      toast.success("Na-update ang naka-schedule na post.");
      cancelEdit();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hindi na-update.");
    } finally {
      setBusyId(null);
    }
  }

  async function publishNow(post: ScheduledPost) {
    if (!confirm("I-publish na ngayon ang post na ito?")) return;
    setBusyId(post.id);
    try {
      const res = await fetch("/api/facebook/page-post/scheduled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, postId: post.id, publishNow: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || "Hindi na-publish.");
        return;
      }
      toast.success("Na-publish na ang post!");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hindi na-publish.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(post: ScheduledPost) {
    if (!confirm("Burahin ang naka-schedule na post na ito?")) return;
    setBusyId(post.id);
    try {
      const res = await fetch(
        `/api/facebook/page-post/scheduled?pageId=${encodeURIComponent(
          pageId
        )}&postId=${encodeURIComponent(post.id)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || "Hindi nabura.");
        return;
      }
      toast.success("Nabura ang naka-schedule na post.");
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hindi nabura.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {loading
            ? "Kinukuha ang mga naka-schedule na post..."
            : `${posts.length} naka-schedule na post sa ${pageName || "Page"}.`}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-600 disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          I-refresh
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {!loading && !error && posts.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
          <CalendarClock size={28} className="mx-auto mb-2 text-gray-600" />
          Wala pang naka-schedule na post. Gumawa sa &ldquo;Bagong Post&rdquo; tab.
        </div>
      )}

      <div className="space-y-3">
        {posts.map((post) => {
          const thumb = post.attachments?.data?.[0]?.media?.image?.src;
          const mediaType = post.attachments?.data?.[0]?.media_type;
          const isEditing = editingId === post.id;
          const busy = busyId === post.id;
          const when = post.scheduled_publish_time
            ? new Date(post.scheduled_publish_time * 1000).toLocaleString()
            : "—";

          return (
            <div
              key={post.id}
              className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
            >
              <div className="flex gap-3">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                  />
                ) : mediaType ? (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-black/40 text-gray-500">
                    {mediaType === "video" ? (
                      <FileVideo size={20} />
                    ) : (
                      <ImageIcon size={20} />
                    )}
                  </div>
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-300">
                    <CalendarClock size={13} className="text-gray-500" />
                    {when}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editMessage}
                        onChange={(e) => setEditMessage(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-gray-700 bg-black/30 p-2.5 text-sm text-white focus:border-white focus:outline-none resize-y"
                      />
                      <input
                        type="datetime-local"
                        value={editWhen}
                        onChange={(e) => setEditWhen(e.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-black/30 p-2.5 text-sm text-white focus:border-white focus:outline-none [color-scheme:dark]"
                      />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm text-gray-200">
                      {post.message || (
                        <span className="italic text-gray-500">(Walang text)</span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => saveEdit(post)}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-40 cursor-pointer"
                    >
                      {busy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Check size={13} />
                      )}
                      I-save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-600 disabled:opacity-40 cursor-pointer"
                    >
                      <X size={13} />
                      Kanselahin
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(post)}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-600 disabled:opacity-40 cursor-pointer"
                    >
                      <Pencil size={13} />
                      I-edit
                    </button>
                    <button
                      type="button"
                      onClick={() => publishNow(post)}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-600 disabled:opacity-40 cursor-pointer"
                    >
                      <Send size={13} />
                      I-publish na
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(post)}
                      disabled={busy}
                      className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-1.5 text-xs text-red-400 hover:border-red-800 disabled:opacity-40 cursor-pointer"
                    >
                      {busy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Burahin
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
