import { useRef, useCallback, useEffect } from "react";

interface UseBarcodeScanOptions {
  onScan: (value: string) => void;
  minLength?: number;
  maxDelay?: number;
}

export function useBarcodeScan({
  onScan,
  minLength = 3,
  maxDelay = 50,
}: UseBarcodeScanOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeystrokeRef = useRef(0);
  const bufferRef = useRef("");

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const now = Date.now();

      if (e.key === "Enter") {
        e.preventDefault();
        const value = (e.target as HTMLInputElement).value.trim();
        if (value.length >= minLength) {
          onScan(value);
        }
        (e.target as HTMLInputElement).value = "";
        bufferRef.current = "";
        return;
      }

      if (now - lastKeystrokeRef.current > maxDelay) {
        bufferRef.current = "";
      }
      lastKeystrokeRef.current = now;
    },
    [onScan, minLength, maxDelay]
  );

  const refocus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    refocus();
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, [refocus]);

  return { inputRef, handleKeyDown, refocus };
}
