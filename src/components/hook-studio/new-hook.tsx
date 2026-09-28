"use client";

import { useRef, useState } from "react";
import { Upload, Film } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { LANES, CREATORS, SCREEN_MODES, type Lane, type ScreenMode } from "@/lib/hook-studio/presets";
import { MAX_REFERENCE_SECONDS } from "@/lib/hook-studio/engines";
import { Panel, Label, Chip, Button, api } from "./ui";

interface Probe {
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
}

export function NewHook({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [lane, setLane] = useState<Lane>("prayer");
  const [creator, setCreator] = useState<string>(CREATORS[0]);
  const [screen, setScreen] = useState<ScreenMode>("dark");
  const [brief, setBrief] = useState("");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number>(MAX_REFERENCE_SECONDS);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const create = async () => {
    if (!probe) return;
    if (!spanOk) {
      toast.error(`Keep between 1 and ${MAX_REFERENCE_SECONDS} seconds`);
      return;
    }
    try {
      setBusy("Uploading the reference…");
      const { path, token, bucket } = await api<{ path: string; token: string; bucket: string }>(
        "/api/owner/hook-studio/upload-url",
        { method: "POST", body: JSON.stringify({ kind: "reference", mime: probe.file.type }) }
      );
      const supabase = createClient();
      const up = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, probe.file, {
        contentType: probe.file.type,
      });
      if (up.error) throw new Error(up.error.message);

      setBusy("Saving the hook…");
      const { id } = await api<{ id: string }>("/api/owner/hook-studio/hooks", {
        method: "POST",
        body: JSON.stringify({
          lane,
          brief,
          creator,
          screen_mode: screen,
          reference_path: path,
          reference_name: probe.file.name,
          duration: probe.duration,
          width: probe.width,
          height: probe.height,
          trim_start: trimStart,
          trim_end: trimEnd,
        }),
      });

      setBusy("Claude is writing the prompt…");
      try {
        await api(`/api/owner/hook-studio/hooks/${id}/prompt`, { method: "POST" });
      } catch (err) {
        toast.error(`Prompt not written yet: ${err instanceof Error ? err.message : "unknown"}. You can retry in the workspace.`);
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
        <Label>Reference video</Label>
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
            className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
              dragging ? "border-purple-500 bg-purple-500/10" : "border-gray-700 hover:border-gray-500"
            }`}
          >
            <Upload size={26} className="mx-auto text-gray-500" />
            <p className="text-sm text-gray-300 mt-3 font-medium">Drop the UGC clip that works, or click to choose</p>
            <p className="text-xs text-gray-500 mt-1">MP4 or MOV, vertical. The first {MAX_REFERENCE_SECONDS} seconds are what the engines copy.</p>
            <input
              ref={inputRef}
              id="hook-reference-file"
              type="file"
              accept="video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className="grid grid-cols-[150px_1fr] gap-4 items-start">
            <video
              src={probe.url}
              controls
              muted
              playsInline
              className="w-full aspect-[9/16] rounded-xl bg-black object-contain border border-gray-700"
            />
            <div className="text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <span className="text-gray-500 font-medium">File</span>
                <span className="text-gray-200 truncate">
                  {probe.file.name} · {probe.duration}s · {probe.width}×{probe.height}
                </span>
                <span className="text-gray-500 font-medium">Sound</span>
                <span className="text-gray-200">Dropped. Remakes are silent.</span>
              </div>
              <Label>Keep from / to (seconds)</Label>
              <div className="flex items-center gap-2">
                <input
                  id="hook-trim-start"
                  type="number"
                  min={0}
                  max={probe.duration}
                  step={0.5}
                  value={trimStart}
                  onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value) || 0))}
                  className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
                <span className="text-gray-500">to</span>
                <input
                  id="hook-trim-end"
                  type="number"
                  min={0}
                  max={probe.duration}
                  step={0.5}
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(Math.min(probe.duration, Number(e.target.value) || 0))}
                  className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
                <span className={`text-xs ${spanOk ? "text-gray-500" : "text-red-400"}`}>
                  {span}s kept{!spanOk && ` · max ${MAX_REFERENCE_SECONDS}s`}
                </span>
              </div>
              <div className="mt-4">
                <Button ghost onClick={() => setProbe(null)}>
                  <Film size={14} /> Replace video
                </Button>
              </div>
            </div>
          </div>
        )}

        <Label>Lane</Label>
        <div className="flex flex-wrap gap-2">
          {LANES.map((l) => (
            <Chip key={l.id} on={lane === l.id} onClick={() => setLane(l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>

        <Label>What to keep, what to change (one line, Taglish is fine)</Label>
        <textarea
          id="hook-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder='Same bed, same morning light, same "reach for the phone, earphones in, press play" motion. New person. Walang text sa screen.'
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />

        <Label>New person</Label>
        <div className="flex flex-wrap gap-2">
          {CREATORS.map((c) => (
            <Chip key={c} on={creator === c} onClick={() => setCreator(c)}>
              {c}
            </Chip>
          ))}
        </div>

        <Label>Phone screen in the remake</Label>
        <div className="flex flex-wrap gap-2">
          {SCREEN_MODES.map((s) => (
            <Chip key={s.id} on={screen === s.id} onClick={() => setScreen(s.id)}>
              {s.label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap mt-5 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-500 max-w-md">
            Claude turns this into the edit prompt and three on-screen text options. You can edit them before any credits are spent.
          </p>
          <div className="flex gap-2">
            <Button ghost onClick={onCancel}>Cancel</Button>
            <Button primary onClick={create} busy={!!busy} disabled={!probe}>
              {busy ?? "Create hook →"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="self-start">
        <p className="text-sm font-semibold text-white">How this works</p>
        <ul className="text-sm text-gray-400 mt-2 space-y-2 list-disc pl-4">
          <li>Use the reference for its shot and motion. The remake always changes the person, removes the text, and controls the phone screen.</li>
          <li>Engines copy at most {MAX_REFERENCE_SECONDS} seconds. A hook is 5 to 8 seconds anyway.</li>
          <li>Rendering happens on the Mac with your creator credits. If the Mac is off, the job waits.</li>
          <li>Downloads are clean clips. Add the text and the SoulShot screen recording in CapCut or Meta.</li>
        </ul>
      </Panel>
    </div>
  );
}
