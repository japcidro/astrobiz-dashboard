"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Pause, Loader2, RefreshCw, Check } from "lucide-react";

interface VoiceOption {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string | null;
  labels?: Record<string, string>;
  description?: string;
}

interface Props {
  value: string | null;
  agentName: string;
  storeName: string;
  onChange: (voiceId: string) => void;
}

export function VoicePicker({ value, agentName, storeName, onChange }: Props) {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadVoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/call-confirmer/voices");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load voices");
      setVoices(data.voices ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load voices");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVoices();
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const playPreview = async (voice: VoiceOption) => {
    if (playingId === voice.voice_id) {
      stopAudio();
      return;
    }
    stopAudio();

    // Use the user's actual greeting context so audition feels real
    const text = `Hello po Sir, si ${agentName} po ito from ${storeName}. Tinawagan po kita para i-confirm ang order ninyo.`;

    setPreviewing(voice.voice_id);
    try {
      const res = await fetch("/api/admin/call-confirmer/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voice.voice_id, text }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? "Preview failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(voice.voice_id);
      audio.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        Loading voices from ElevenLabs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3">
        <p className="text-sm text-red-300 mb-2">{error}</p>
        <button
          onClick={loadVoices}
          className="text-xs text-red-200 underline hover:text-white flex items-center gap-1"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">
          {voices.length} voice{voices.length !== 1 ? "s" : ""} available. Click
          play to audition with your store&apos;s greeting.
        </p>
        <button
          type="button"
          onClick={loadVoices}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto bg-gray-900/40 border border-gray-700/50 rounded-lg divide-y divide-gray-800">
        {voices.length === 0 && (
          <div className="p-4 text-sm text-gray-500 text-center">
            No voices found in your ElevenLabs account.
          </div>
        )}
        {voices.map((voice) => {
          const isSelected = voice.voice_id === value;
          const isPlaying = playingId === voice.voice_id;
          const isLoading = previewing === voice.voice_id;
          return (
            <div
              key={voice.voice_id}
              className={`flex items-center gap-3 p-3 hover:bg-gray-800/50 transition-colors ${
                isSelected ? "bg-emerald-900/20" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => playPreview(voice)}
                disabled={isLoading}
                className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white disabled:opacity-50 cursor-pointer"
                title={isPlaying ? "Stop" : "Play preview"}
              >
                {isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : isPlaying ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} className="ml-0.5" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium truncate">
                    {voice.name}
                  </span>
                  {voice.category && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                      {voice.category}
                    </span>
                  )}
                </div>
                {voice.labels && Object.keys(voice.labels).length > 0 && (
                  <p className="text-xs text-gray-500 truncate">
                    {Object.entries(voice.labels)
                      .slice(0, 4)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onChange(voice.voice_id)}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                }`}
              >
                {isSelected ? (
                  <span className="flex items-center gap-1">
                    <Check size={12} /> Selected
                  </span>
                ) : (
                  "Select"
                )}
              </button>
            </div>
          );
        })}
      </div>

      {value && (
        <p className="text-xs text-gray-500 mt-1">
          Voice ID: <code className="text-gray-400">{value}</code>
        </p>
      )}
    </div>
  );
}
