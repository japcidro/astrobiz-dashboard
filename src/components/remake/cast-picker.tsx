"use client";

import { Check, Loader2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { LibraryImage } from "@/lib/remake/types";
import { Button, api, timeAgo } from "@/components/hook-studio/ui";

/**
 * Full-screen chooser for the person who goes into every clip: the UGC
 * Generator library in a roomy grid, or an upload. One click selects, the
 * bottom bar confirms.
 */
export function CastPicker({
  projectId,
  current,
  onPick,
  onClose,
}: {
  projectId: string;
  /** Signed URL of the person already picked, if any. */
  current: string | null;
  onPick: (body: { ugc_job_id?: string; path?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pick" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ images: LibraryImage[] }>("/api/owner/remake/library").then((r) => setLibrary(r.images)).catch((e) => setError(e instanceof Error ? e.message : "Could not load the library"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (!chosen) return;
    setBusy("pick");
    setError(null);
    try {
      await onPick({ ugc_job_id: chosen });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use this image");
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);
    try {
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>("/api/owner/remake/upload-url", {
        method: "POST",
        body: JSON.stringify({ kind: "cast", mime: file.type, project_id: projectId }),
      });
      const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      await onPick({ path });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pick the person">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-gray-950 border border-gray-800 shadow-2xl">
        <div className="flex items-start gap-3 p-5 border-b border-gray-800">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-white">Pick the person</h2>
            <p className="text-sm text-gray-400 mt-0.5">They go into every clip&apos;s real frame. The still is generated from the frame with this person in it.</p>
          </div>
          {current && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current} alt="" className="w-8 aspect-[9/16] object-cover rounded border border-purple-500" />
              Current
            </div>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <p className="text-xs text-red-300 mb-3">{error}</p>}
          {library === null ? (
            <Loader2 size={20} className="mx-auto my-10 animate-spin text-gray-500" />
          ) : library.length === 0 ? (
            <p className="text-sm text-gray-500 text-center my-10">The UGC Generator library is empty. Upload a photo instead.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {library.map((img) => {
                const on = chosen === img.id;
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setChosen(on ? null : img.id)}
                    className={`group text-left rounded-xl p-1 transition-colors cursor-pointer ${on ? "bg-purple-600/30 ring-2 ring-purple-500" : "hover:bg-white/5"}`}
                  >
                    <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      {on && (
                        <span className="absolute top-1.5 right-1.5 bg-purple-600 text-white rounded-full p-1">
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5 truncate" title={img.note}>
                      {img.note || "UGC image"}
                    </p>
                    <p className="text-[10px] text-gray-600">{timeAgo(img.created_at)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 p-4 border-t border-gray-800">
          <Button onClick={() => fileRef.current?.click()} busy={busy === "upload"} disabled={busy !== null}>
            <Upload size={14} /> Upload a photo
          </Button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <span className="flex-1 text-xs text-gray-500">{chosen ? "1 selected" : "Click an image to select it"}</span>
          <Button ghost onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button primary onClick={confirm} busy={busy === "pick"} disabled={!chosen || busy !== null}>
            <Check size={14} /> Use this person
          </Button>
        </div>
      </div>
    </div>
  );
}
