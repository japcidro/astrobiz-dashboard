"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, ShieldCheck } from "lucide-react";
import { CONSENT_TEXT } from "@/lib/call-coach/shared";

/**
 * Shown in place of the timer until the employee signs. The exact wording
 * they agree to is stored with the signature, so later edits to CONSENT_TEXT
 * never change what someone already signed.
 */
export function ConsentForm({ fullName }: { fullName: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const ready = name.trim().length >= 2;

  const [micNote, setMicNote] = useState<string | null>(null);

  // Ask for the microphone inside the click, so Chrome shows its prompt right
  // here, tied to the VA's own action, instead of later when the timer starts.
  const sign = async () => {
    setError(null);
    setMicNote(null);
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        for (const t of stream.getTracks()) t.stop();
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setMicNote(
          name === "NotFoundError"
            ? "Walang nakitang microphone sa computer na ito. Pwede pa ring i-save ang consent; i-plug ang headset o mic bago mag-Start Work."
            : "Na-block ang microphone. Okay lang, na-save pa rin ang consent. Sa Time Tracker, i-click ang lock icon sa address bar, i-Allow ang Microphone, tapos Try again.",
        );
      }
    }
    startTransition(async () => {
      const res = await fetch("/api/call-coach/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_name: name.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not save your signature. Try again.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="bg-gray-800/50 border border-amber-700/50 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Mic size={18} className="text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Before your first shift: recording consent</h2>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Your shifts are recorded from this computer&apos;s microphone for quality and training. Read this once and sign to start your timer.
      </p>

      <div className="bg-gray-900/70 border border-gray-700 rounded-lg p-4 text-sm text-gray-300 whitespace-pre-line leading-relaxed max-h-64 overflow-y-auto">
        {CONSENT_TEXT}
      </div>

      <label htmlFor="consent-name" className="block text-xs uppercase tracking-wider text-gray-500 font-semibold mt-5 mb-2">
        Type your full name to sign
      </label>
      <input
        id="consent-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={fullName}
        autoComplete="off"
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500"
      />
      <p className="text-xs text-gray-500 mt-1.5">
        Signed as {fullName} on {new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" })}.
      </p>
      <p className="text-xs text-amber-200/80 mt-3">
        Pagka-click ng button, magtatanong si Chrome: &quot;astrobiz.live wants to use your microphone&quot;. I-click ang <strong>Allow</strong>. Isang beses lang ito.
      </p>
      {micNote && <p className="text-xs text-amber-300 mt-2">{micNote}</p>}

      {error && (
        <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      <button
        type="button"
        onClick={() => void sign()}
        disabled={!ready || pending}
        className="mt-5 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-medium py-2.5 px-5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      >
        <ShieldCheck size={18} />
        {pending ? "Saving…" : "I agree, let me start my shift"}
      </button>
    </div>
  );
}
