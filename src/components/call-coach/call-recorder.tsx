"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Mic, MicOff, RefreshCw, UploadCloud } from "lucide-react";
import { MIN_VOICE_SECONDS, SEGMENT_SECONDS, formatMinutes, type MicEventKind } from "@/lib/call-coach/shared";

/**
 * Records the employee's voice from the PC microphone while their timer is
 * running. Every SEGMENT_SECONDS the recorder closes a file; a file with at
 * least MIN_VOICE_SECONDS of speech is uploaded, anything quieter is dropped
 * on the laptop and only counted. Break pauses it, clocking out stops it.
 *
 * Speech detection is a loudness gate against a slowly tracked noise floor.
 * If the browser will not let the meter run (an AudioContext created before
 * the page was clicked stays suspended), every second counts as voice, so
 * nothing is lost while the meter is blind.
 */

type Phase = "off" | "starting" | "recording" | "lost" | "blocked" | "unsupported";
/** Why the mic could not start: Chrome blocked it, Chrome has not asked yet, or there is no mic. */
type BlockReason = "denied" | "prompt" | "nodevice" | "busy";

interface Props {
  entryId: string | null;
  entryStatus: "running" | "paused" | null;
  /** Seconds of speech already stored today, from the server. */
  initialVoiceSeconds: number;
}

interface Segment {
  startedAt: number;
  voiceMs: number;
  chunks: Blob[];
}

const TICK_MS = 100;
const RETRY_MS = [2_000, 6_000, 15_000];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

export function CallRecorder({ entryId, entryStatus, initialVoiceSeconds }: Props) {
  const [phase, setPhase] = useState<Phase>("off");
  const [level, setLevel] = useState(0);
  const [voiceToday, setVoiceToday] = useState(initialVoiceSeconds);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [meterBlind, setMeterBlind] = useState(false);
  const [blockReason, setBlockReason] = useState<BlockReason>("denied");

  const wantRef = useRef(false);
  const entryIdRef = useRef(entryId);
  entryIdRef.current = entryId;
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentRef = useRef<Segment | null>(null);
  const tickRef = useRef<number | null>(null);
  const segTimerRef = useRef<number | null>(null);
  const floorRef = useRef(0.004);
  const blindRef = useRef(false);

  const postEvent = useCallback((kind: MicEventKind, detail?: string) => {
    void fetch("/api/call-coach/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, time_entry_id: entryIdRef.current, detail: detail ?? null, at: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const upload = useCallback(async (blob: Blob, startedAt: number, endedAt: number, voiceSeconds: number) => {
    setUploading((n) => n + 1);
    const form = new FormData();
    form.append("file", blob, "segment");
    form.append("started_at", new Date(startedAt).toISOString());
    form.append("ended_at", new Date(endedAt).toISOString());
    form.append("voice_seconds", voiceSeconds.toFixed(1));
    if (entryIdRef.current) form.append("time_entry_id", entryIdRef.current);

    let lastError = "Upload failed";
    for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
      try {
        const res = await fetch("/api/call-coach/segments", { method: "POST", body: form });
        if (res.ok) {
          setVoiceToday((v) => v + voiceSeconds);
          setUploadError(null);
          setUploading((n) => n - 1);
          return;
        }
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        lastError = json.error || `Upload failed (${res.status})`;
        if (res.status >= 400 && res.status < 500) break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Network error";
      }
      if (attempt < RETRY_MS.length) await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
    }
    setUploading((n) => n - 1);
    setUploadError(lastError);
  }, []);

  const finishSegment = useCallback(
    (seg: Segment, mime: string) => {
      const endedAt = Date.now();
      const voiceSeconds = blindRef.current ? (endedAt - seg.startedAt) / 1000 : seg.voiceMs / 1000;
      if (voiceSeconds < MIN_VOICE_SECONDS || seg.chunks.length === 0) {
        postEvent("silent", `${Math.round((endedAt - seg.startedAt) / 1000)}s`);
        return;
      }
      const blob = new Blob(seg.chunks, { type: mime || "audio/webm" });
      void upload(blob, seg.startedAt, endedAt, voiceSeconds);
    },
    [postEvent, upload],
  );

  const startSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !stream.active) return;
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
    const seg: Segment = { startedAt: Date.now(), voiceMs: 0, chunks: [] };
    segmentRef.current = seg;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) seg.chunks.push(e.data);
    };
    rec.onstop = () => {
      finishSegment(seg, rec.mimeType);
      if (recorderRef.current === rec) recorderRef.current = null;
      if (wantRef.current && streamRef.current?.active) startSegment();
    };
    rec.start();
    recorderRef.current = rec;
    if (segTimerRef.current) window.clearTimeout(segTimerRef.current);
    segTimerRef.current = window.setTimeout(() => {
      if (recorderRef.current === rec && rec.state === "recording") rec.stop();
    }, SEGMENT_SECONDS * 1000);
  }, [finishSegment]);

  const teardown = useCallback(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    if (segTimerRef.current) window.clearTimeout(segTimerRef.current);
    segTimerRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state === "recording") {
      // onstop still fires and uploads what it has; wantRef is already false
      // (or the stream is gone), so it will not start a new segment.
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(
    async (reason: "started" | "resumed") => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setPhase("unsupported");
        return;
      }
      setPhase("starting");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          video: false,
        });
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        let reason: BlockReason = name === "NotFoundError" || name === "OverconstrainedError" ? "nodevice" : name === "NotReadableError" ? "busy" : "denied";
        if (reason === "denied") {
          // Dismissed prompt vs. a real block: the Permissions API knows.
          try {
            const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
            if (status?.state === "prompt") reason = "prompt";
          } catch {
            /* Permissions API unavailable; treat as denied */
          }
        }
        setBlockReason(reason);
        setPhase("blocked");
        postEvent("blocked", name || "getUserMedia failed");
        return;
      }
      if (!wantRef.current) {
        // The timer stopped while the permission prompt was open.
        for (const t of stream.getTracks()) t.stop();
        setPhase("off");
        return;
      }
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.onended = () => {
          if (!wantRef.current) return;
          teardown();
          setPhase("lost");
          postEvent("lost", "track ended");
        };
      }

      // Loudness meter. A context made without a click may sit suspended;
      // then the meter is blind and every second counts as voice.
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const refreshBlind = () => {
        blindRef.current = ctx.state !== "running";
        setMeterBlind(blindRef.current);
      };
      await ctx.resume().catch(() => {});
      refreshBlind();
      ctx.onstatechange = refreshBlind;
      if (ctx.state !== "running") {
        const wake = () => {
          void ctx.resume().then(refreshBlind).catch(() => {});
        };
        document.addEventListener("pointerdown", wake, { once: true });
        document.addEventListener("keydown", wake, { once: true });
      }

      let last = performance.now();
      tickRef.current = window.setInterval(() => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        if (blindRef.current) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const floor = floorRef.current;
        if (rms < floor * 2.5) floorRef.current = floor * 0.97 + rms * 0.03;
        const voiced = rms > Math.max(0.012, floorRef.current * 4);
        if (voiced && segmentRef.current) segmentRef.current.voiceMs += dt;
        setLevel(Math.min(1, rms * 5));
      }, TICK_MS);

      setPhase("recording");
      postEvent(reason);
      startSegment();
    },
    [postEvent, startSegment, teardown],
  );

  const stopAll = useCallback(
    (kind: "paused" | "stopped") => {
      teardown();
      setPhase("off");
      postEvent(kind);
    },
    [postEvent, teardown],
  );

  // Follow the timer: running records, paused or no session does not.
  const prevStatus = useRef<Props["entryStatus"]>(null);
  useEffect(() => {
    const should = entryStatus === "running";
    const was = prevStatus.current;
    prevStatus.current = entryStatus;
    if (should && !wantRef.current) {
      wantRef.current = true;
      void start(was === "paused" ? "resumed" : "started");
    } else if (!should && wantRef.current) {
      wantRef.current = false;
      stopAll(entryStatus === "paused" ? "paused" : "stopped");
    }
  }, [entryStatus, start, stopAll]);

  // Leaving the page while recording: warn, then let the last file go.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!wantRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      wantRef.current = false;
      teardown();
    };
  }, [teardown]);

  const resume = () => {
    if (!wantRef.current) wantRef.current = true;
    void start("resumed");
  };

  if (entryStatus === null && phase === "off") {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center gap-3">
        <MicOff size={18} className="text-gray-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-300">Call recording is off</p>
          <p className="text-xs text-gray-500">It starts when you click Start Work. Keep this tab open during your shift.</p>
        </div>
        {voiceToday > 0 && <span className="text-xs text-gray-500 font-mono">{formatMinutes(voiceToday)} saved today</span>}
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <StatusPill phase={phase} />
        <div className="flex-1 min-w-0 text-xs text-gray-500">
          {phase === "recording" && (meterBlind ? "Click anywhere on the page to turn on the voice meter" : "Only the minutes with your voice are kept")}
          {phase === "starting" && "Asking the browser for your microphone…"}
          {phase === "off" && entryStatus === "paused" && "Paused with your break. Resume Work turns it back on."}
          {phase === "lost" && "Your microphone disconnected or the laptop slept. Your timer is still running."}
          {phase === "blocked" && blockReason === "denied" && "Na-block ang microphone sa Chrome. Sundin ang steps sa baba."}
          {phase === "blocked" && blockReason === "prompt" && "Hindi pa na-Allow ang microphone. I-click ang button sa baba, tapos Allow."}
          {phase === "blocked" && blockReason === "nodevice" && "Walang nakitang microphone. I-plug ang headset o mic, tapos i-click ang button sa baba."}
          {phase === "blocked" && blockReason === "busy" && "May ibang app na gumagamit ng microphone (Zoom, Meet, Viber?). Isara muna yun, tapos i-click ang button sa baba."}
          {phase === "unsupported" && "This browser cannot record. Use Chrome or Edge on the laptop."}
        </div>
        <span className="text-xs text-gray-400 font-mono whitespace-nowrap">{formatMinutes(voiceToday)} saved today</span>
      </div>

      {phase === "recording" && <LevelMeter level={level} blind={meterBlind} />}

      {phase === "blocked" && blockReason === "denied" && (
        <ol className="text-xs text-gray-300 space-y-1.5 bg-gray-900/60 border border-amber-800/40 rounded-lg p-3 list-decimal pl-7">
          <li>
            Sa taas ng Chrome, sa <strong>kaliwa ng address</strong> (astrobiz.live), i-click ang maliit na icon: <span className="font-mono">🔒</span> o{" "}
            <span className="font-mono">ⓘ</span> o <span className="font-mono">⚙</span>.
          </li>
          <li>
            Hanapin ang <strong>Microphone</strong> at i-switch sa <strong>Allow</strong>. Kung wala, i-click ang <strong>Site settings</strong>, tapos hanapin doon.
          </li>
          <li>Bumalik dito at i-click ang <strong>Try the microphone again</strong>. Dapat lumabas ang pulang REC.</li>
        </ol>
      )}

      {(phase === "lost" || phase === "blocked") && (
        <button
          type="button"
          onClick={resume}
          className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer"
        >
          <RefreshCw size={16} />
          {phase === "lost" ? "Resume recording" : blockReason === "prompt" ? "Allow the microphone" : "Try the microphone again"}
        </button>
      )}

      {(uploading > 0 || uploadError) && (
        <div className="flex items-center gap-2 text-xs">
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1.5 text-gray-400">
              <UploadCloud size={14} className="animate-pulse" />
              Saving {uploading} {uploading === 1 ? "minute" : "minutes"}…
            </span>
          )}
          {uploadError && (
            <span className="inline-flex items-center gap-1.5 text-red-300">
              <AlertTriangle size={14} />
              {uploadError}. Recording continues; the next minute will retry.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ phase }: { phase: Phase }) {
  if (phase === "recording") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-400 text-xs font-semibold border border-red-800/60 bg-red-900/30 rounded-full px-2.5 py-1">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        REC · mic on
      </span>
    );
  }
  if (phase === "starting") {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-300 text-xs font-semibold border border-gray-700 rounded-full px-2.5 py-1">
        <Mic size={12} /> Starting…
      </span>
    );
  }
  if (phase === "lost" || phase === "blocked" || phase === "unsupported") {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-300 text-xs font-semibold border border-amber-800/60 bg-amber-900/30 rounded-full px-2.5 py-1">
        <AlertTriangle size={12} /> {phase === "lost" ? "Mic lost" : phase === "blocked" ? "Mic blocked" : "Not supported"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-400 text-xs font-semibold border border-gray-700 rounded-full px-2.5 py-1">
      <MicOff size={12} /> Mic off
    </span>
  );
}

function LevelMeter({ level, blind }: { level: number; blind: boolean }) {
  const bars = 16;
  const lit = Math.round(level * bars);
  return (
    <div className="flex items-end gap-[3px] h-6" aria-label="Microphone level">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-1.5 rounded-sm transition-colors ${blind ? "bg-gray-700" : i < lit ? (i > bars * 0.8 ? "bg-amber-400" : "bg-green-400") : "bg-gray-700"}`}
          style={{ height: `${30 + (i % 4) * 15}%` }}
        />
      ))}
    </div>
  );
}
