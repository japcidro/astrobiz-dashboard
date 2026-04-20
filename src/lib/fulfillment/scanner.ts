import { useRef, useCallback, useEffect } from "react";

interface UseBarcodeScanOptions {
  onScan: (value: string) => void;
  minLength?: number;
  // Max gap between chars for input to still count as a scanner burst
  maxBurstGapMs?: number;
  // After last char, wait this long before auto-submitting a burst
  burstIdleMs?: number;
  // Called with the raw pre-normalized value whenever a scan fires
  onRawScan?: (raw: string) => void;
}

// AIM symbology prefix: "]" + letter + digit (e.g. "]Q1" for QR, "]C1" for CODE128)
const AIM_PREFIX_RE = /^\][A-Za-z]\d/;
// Control chars, zero-width chars, BOM — often emitted by scanner firmware
const INVISIBLE_RE = /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g;

export function normalizeScanValue(raw: string): string {
  let value = raw.trim();
  value = value.replace(AIM_PREFIX_RE, "");
  value = value.replace(INVISIBLE_RE, "");
  return value.trim();
}

export function useBarcodeScan({
  onScan,
  minLength = 3,
  maxBurstGapMs = 50,
  burstIdleMs = 100,
  onRawScan,
}: UseBarcodeScanOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastInputRef = useRef(0);
  // Whether current input session looks like a scanner burst (all gaps < maxBurstGapMs)
  const burstActiveRef = useRef(true);
  const inputCountRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const input = inputRef.current;
    if (!input) return;
    const raw = input.value;
    input.value = "";
    inputCountRef.current = 0;
    burstActiveRef.current = true;
    if (onRawScan) onRawScan(raw);
    const value = normalizeScanValue(raw);
    if (value.length >= minLength) {
      onScan(value);
    }
  }, [onScan, minLength, onRawScan]);

  // Instant submit on suffix keys; don't block other keys
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  // Fires on any value change — covers both per-keystroke scanners and
  // scanners that emit the whole value at once (paste-style)
  const handleInput = useCallback(() => {
    const now = Date.now();
    const gap = now - lastInputRef.current;

    // Session boundary: long pause = new input session
    if (gap > 500) {
      burstActiveRef.current = true;
      inputCountRef.current = 1;
    } else {
      inputCountRef.current += 1;
      // Gap between inputs too wide = human typing, don't auto-submit
      if (gap > maxBurstGapMs) {
        burstActiveRef.current = false;
      }
    }
    lastInputRef.current = now;

    // Schedule burst auto-submit after idle
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      const currentValue = inputRef.current?.value || "";
      if (burstActiveRef.current && normalizeScanValue(currentValue).length >= minLength) {
        submit();
      }
    }, burstIdleMs);
  }, [submit, maxBurstGapMs, burstIdleMs, minLength]);

  const refocus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    refocus();
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, [refocus]);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return { inputRef, handleKeyDown, handleInput, refocus };
}
