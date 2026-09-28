"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Upload, Film, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { SKILLS, MAX_REFERENCE_SECONDS, type Skill } from "@/lib/hook-studio/engines";
import type { UgcView } from "@/lib/hook-studio/types";
import { Panel, Label, Button, api } from "./ui";

interface Probe {
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
}

export function NewHook({
  preselectUgc,
  onCreated,
  onCancel,
}: {
  preselectUgc: string | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [ugcItems, setUgcItems] = useState<UgcView[]>([]);
  const [ugcId, setUgcId] = useState<string | null>(preselectUgc);
  const [skill, setSkill] = useState<Skill>("motion");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number>(MAX_REFERENCE_SECONDS);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<{ items: UgcView[] }>("/api/owner/hook-studio/ugc")
      .then((r) => setUgcItems(r.items.filter((i) => i.status === "done" && i.result_url)))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load UGC images"));
  }, []);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Drop a video file (MP4 or MOV)");
      return;
    }
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const duration = Math.round(v.duration * 10) / 10;
      setProbe({ file, url, duration, width: v.videoWidth, height: v.videoHeight });
      setTrimStart(0);
      setTrimEnd(Math.min(duration, MAX_REFERENCE_SECONDS));
    };
    v.onerror = () => toast.error("That video could not be read. Try an MP4.");
    v.src = url;
  };

  const span = Math.max(0, Math.round((trimEnd - trimStart) * 10) / 10);
  const spanOk = span > 0 && span <= MAX_REFERENCE_SECONDS;
  const needsRef = SKILLS.find((s) => s.id === skill)?.needsReference ?? false;
  const canCreate = !!ugcId && (!needsRef || (!!probe && spanOk));

  const create = async () => {
    if (!ugcId) return;
    try {
      let referencePath: string | null = null;
      if (needsRef && probe) {
        setBusy("Uploading the reference…");
        const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>(
          "/api/owner/hook-studio/upload-url",
          { method: "POST", body: JSON.stringify({ kind: "reference", mime: probe.file.type }) }
        );
        const up = await createClient().storage.from(bucket).uploadToSignedUrl(path, token, probe.file, { contentType: probe.file.type });
        if (up.error) throw new Error(up.error.message);
        referencePath = path;
      }
      setBusy("Saving the hook…");
      const { id } = await api<{ id: string }>("/api/owner/hook-studio/hooks", {
        method: "POST",
        body: JSON.stringify({
          ugc_job_id: ugcId,
          skill,
          brief,
          duration: needsRef ? Math.round(span) : 5,
          reference_path: referencePath,
          reference_name: probe?.file.name ?? null,
          reference_duration: probe?.duration ?? null,
          width: probe?.width ?? null,
          height: probe?.height ?? null,
          trim_start: trimStart,
          trim_end: needsRef ? trimEnd : null,
        }),
      });
      setBusy("Claude is writing the prompt…");
      try {
        await api(`/api/owner/hook-studio/hooks/${id}/prompt`, { method: "POST" });
      } catch (err) {
        toast.error(`Prompt not written yet: ${err instanceof Error ? err.message : "unknown"}. Retry in the workspace.`);
      }
      onCreated(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the hook");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
      <Panel>
        <Label>1 · UGC image (the person and the scene)</Label>
        {ugcItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-sm text-gray-400">
            No UGC images yet.{" "}
            <Link href="/owner/ugc-generator" className="text-purple-300 hover:text-white font-semibold inline-flex items-center gap-1">
              <ImagePlus size={14} /> Make one in the UGC Generator
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {ugcItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setUgcId(it.id)}
                className={`relative rounded-lg overflow-hidden border-2 cursor-pointer ${ugcId === it.id ? "border-purple-500" : "border-transparent hover:border-gray-500"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL */}
                <img src={it.result_url ?? ""} alt="ugc" className="w-full aspect-[9/16] object-cover bg-gray-900" />
              </button>
            ))}
          </div>
        )}

        <Label>2 · Skill</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SKILLS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSkill(s.id)}
              className={`text-left rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${skill === s.id ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-500"}`}
            >
              <p className="text-sm font-semibold text-white">{s.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.blurb}</p>
            </button>
          ))}
        </div>

        {needsRef && (
          <>
            <Label>3 · Reference clip (the camera motion to copy)</Label>
            {!probe ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files?.[0]);
                }}
                onClick={() => inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragging ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-500"}`}
              >
                <Upload size={24} className="mx-auto text-gray-500" />
                <p className="text-sm text-gray-300 mt-3 font-medium">Drop the clip whose motion you want, or click to choose</p>
                <p className="text-xs text-gray-500 mt-1">MP4 or MOV. Up to {MAX_REFERENCE_SECONDS} seconds are copied; you pick the window.</p>
                <input ref={inputRef} id="hook-reference-file" type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              </div>
            ) : (
              <div className="grid grid-cols-[120px_1fr] gap-4 items-start">
                <video src={probe.url} controls muted playsInline className="w-full aspect-[9/16] rounded-xl bg-black object-contain border border-gray-700" />
                <div className="text-sm">
                  <p className="text-gray-200 truncate">
                    {probe.file.name} · {probe.duration}s
                  </p>
                  <Label>Copy from / to (seconds)</Label>
                  <div className="flex items-center gap-2">
                    <input id="hook-trim-start" type="number" min={0} max={probe.duration} step={0.5} value={trimStart} onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value) || 0))} className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                    <span className="text-gray-500">to</span>
                    <input id="hook-trim-end" type="number" min={0} max={probe.duration} step={0.5} value={trimEnd} onChange={(e) => setTrimEnd(Math.min(probe.duration, Number(e.target.value) || 0))} className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                    <span className={`text-xs ${spanOk ? "text-gray-500" : "text-red-400"}`}>
                      {span}s{!spanOk && ` · max ${MAX_REFERENCE_SECONDS}s`}
                    </span>
                  </div>
                  <div className="mt-3">
                    <Button ghost onClick={() => setProbe(null)}>
                      <Film size={14} /> Replace clip
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <Label>{needsRef ? "4" : "3"} · What happens (optional)</Label>
        <textarea
          id="hook-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder={needsRef ? "Anything the engine should know, e.g. \"she taps the phone then closes her eyes\"." : "Describe the beats, e.g. \"reaches for the phone, taps play, closes her eyes, settles back\"."}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />

        <div className="flex items-center justify-between gap-3 flex-wrap mt-5 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-500 max-w-md">Claude looks at the image and writes the prompt. You pick the engine, seconds and count on the next screen, with the cost shown.</p>
          <div className="flex gap-2">
            <Button ghost onClick={onCancel}>Cancel</Button>
            <Button primary onClick={create} busy={!!busy} disabled={!canCreate}>
              {busy ?? "Continue →"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="self-start">
        <p className="text-sm font-semibold text-white">The two skills</p>
        <ul className="text-sm text-gray-400 mt-2 space-y-2 list-disc pl-4">
          <li><b className="text-gray-200">Higgsfield motion transfer.</b> Exact copy of the reference&apos;s camera and action, performed by the person in your image, in your image&apos;s room. Needs the reference clip. About 35 credits per 5 s.</li>
          <li><b className="text-gray-200">Arcads-style, our version.</b> No reference. Claude writes a shot-by-shot prompt from the image and your brief; Kling or Seedance animates it. About 6 credits per 5 s on Kling.</li>
          <li>Both are silent, 9:16, and land in the library. Text and the SoulShot screen go on in CapCut or Meta.</li>
        </ul>
      </Panel>
    </div>
  );
}
