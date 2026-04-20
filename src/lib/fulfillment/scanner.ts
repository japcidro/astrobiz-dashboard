import { useRef, useCallback, useEffect } from "react";

interface UseBarcodeScanOptions {
  onScan: (value: string) => void;
  minLength?: number;
  // Max gap between chars for input to still count as a scanner burst
  maxBurstGapMs?: number;
  // After last char, wait this long before auto-submitting a burst
  burstIdleMs?: number;
}

export function useBarcodeScan({
  onScan,
  minLength = 3,
  maxBurstGapMs = 50,
  burstIdleMs = 100,
}: UseBarcodeScanOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeystrokeRef = useRef(0);
  // Whether current input session looks like a scanner burst (all gaps < maxBurstGapMs)
  const burstActiveRef = useRef(true);
  const charCountRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const input = inputRef.current;
    if (!input) return;
    const value = input.value.trim();
    input.value = "";
    charCountRef.current = 0;
    burstActiveRef.current = true;
    if (value.length >= minLength) {
      onScan(value);
    }
  }, [onScan, minLength]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Instant submit for common scanner suffix keys
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        submit();
        return;
      }

      // Only treat printable single-char keys as data
      if (e.key.length !== 1) return;

      const now = Date.now();
      const gap = now - lastKeystrokeRef.current;

      // Session boundary: long pause = new input session
      if (gap > 500) {
        burstActiveRef.current = true;
        charCountRef.current = 1;
      } else {
        charCountRef.current += 1;
        // Human typing detected (gaps between chars too large)
        if (gap > maxBurstGapMs) {
          burstActiveRef.current = false;
        }
      }
      lastKeystrokeRef.current = now;

      // Schedule burst auto-submit after idle
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (burstActiveRef.current && charCountRef.current >= minLength) {
          submit();
        }
      }, burstIdleMs);
    },
    [submit, maxBurstGapMs, burstIdleMs, minLength]
  );

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

  return { inputRef, handleKeyDown, refocus };
}
