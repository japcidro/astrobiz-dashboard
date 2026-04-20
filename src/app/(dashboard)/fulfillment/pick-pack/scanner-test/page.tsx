"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { normalizeScanValue } from "@/lib/fulfillment/scanner";

interface ScanLog {
  at: string;
  raw: string;
  normalized: string;
  charCodes: number[];
}

export default function ScannerTestPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [liveKeys, setLiveKeys] = useState<string[]>([]);

  const refocus = useCallback(() => inputRef.current?.focus(), []);

  useEffect(() => {
    refocus();
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, [refocus]);

  const handleSubmit = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const raw = input.value;
    if (!raw) return;
    input.value = "";
    const normalized = normalizeScanValue(raw);
    const charCodes = Array.from(raw).map((c) => c.charCodeAt(0));
    const log: ScanLog = {
      at: new Date().toLocaleTimeString(),
      raw,
      normalized,
      charCodes,
    };
    setLogs((prev) => [log, ...prev].slice(0, 20));
    setLiveKeys([]);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      setLiveKeys((prev) => [...prev, e.key].slice(-30));
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Scanner Diagnostic</h1>
        <p className="text-gray-400 mt-1">
          Scan QR/barcode here — page will show exactly what the scanner emits.
          Press Enter to submit manually if scanner has no suffix.
        </p>
      </div>

      <div className="mb-4">
        <input
          ref={inputRef}
          type="text"
          autoFocus
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(refocus, 100)}
          placeholder="Scan here..."
          className="w-full bg-gray-900 border-2 border-emerald-500 rounded-xl px-4 py-4 text-xl text-white font-mono placeholder:text-gray-500 focus:outline-none"
        />
        <button
          onClick={handleSubmit}
          className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-lg cursor-pointer"
        >
          Submit now
        </button>
      </div>

      {liveKeys.length > 0 && (
        <div className="mb-4 p-3 bg-gray-800/50 border border-gray-700 rounded-xl">
          <p className="text-xs text-gray-400 mb-2">Live keystrokes (last 30):</p>
          <div className="font-mono text-sm text-yellow-300 break-all">
            {liveKeys.map((k, i) => (
              <span key={i} className="inline-block mr-1 px-1.5 py-0.5 bg-gray-900 rounded">
                {k === " " ? "⎵" : k}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">
          Scan log ({logs.length})
        </h2>
        {logs.length > 0 && (
          <button
            onClick={() => setLogs([])}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded-lg cursor-pointer"
          >
            <Trash2 size={12} />
            Clear
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-12 text-gray-500 border border-gray-700/50 rounded-xl">
          <p>No scans yet. Scan a QR/barcode to see output.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log, i) => (
            <div
              key={i}
              className="p-4 bg-gray-900/50 border border-gray-700/50 rounded-xl"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">{log.at}</span>
                <span className="text-xs text-gray-500">
                  {log.raw.length} chars
                </span>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-xs text-gray-500">Raw:</span>
                  <div className="font-mono text-emerald-300 break-all bg-black/30 px-2 py-1 rounded mt-0.5">
                    {log.raw || <em className="text-gray-600">empty</em>}
                  </div>
                </div>

                <div>
                  <span className="text-xs text-gray-500">
                    Normalized (AIM prefix + invisible chars stripped):
                  </span>
                  <div className="font-mono text-yellow-300 break-all bg-black/30 px-2 py-1 rounded mt-0.5">
                    {log.normalized || (
                      <em className="text-gray-600">empty</em>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-xs text-gray-500">
                    Char codes (decimal):
                  </span>
                  <div className="font-mono text-xs text-gray-400 break-all bg-black/30 px-2 py-1 rounded mt-0.5">
                    {log.charCodes.join(" ")}
                  </div>
                </div>

                {log.raw !== log.normalized && (
                  <p className="text-xs text-orange-300">
                    ⚠️ Raw value had prefix/invisible chars — normalization
                    cleaned it.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-blue-900/20 border border-blue-800/50 rounded-xl">
        <h3 className="text-sm font-semibold text-blue-300 mb-2">How to use</h3>
        <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
          <li>Scan a printed QR label — watch the live keystrokes light up</li>
          <li>
            If no keystrokes appear: scanner is not emitting via HID keyboard
            (wrong mode or serial port)
          </li>
          <li>
            If raw value differs from what you expect: your scanner is adding
            prefixes/suffixes. Reconfigure scanner, or rely on normalization
          </li>
          <li>
            If raw matches expected but scan doesn&apos;t submit: scanner is not
            sending an Enter/Tab suffix. Use the &quot;Submit now&quot; button or
            reconfigure scanner suffix
          </li>
          <li>
            Compare the &quot;Normalized&quot; value — this is what pick/verify
            will try to match against Shopify SKU or barcode field
          </li>
        </ol>
      </div>
    </div>
  );
}
