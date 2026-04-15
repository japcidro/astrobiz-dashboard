"use client";

import { ScanLine } from "lucide-react";
import { useBarcodeScan } from "@/lib/fulfillment/scanner";

interface Props {
  onScan: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function BarcodeScannerInput({
  onScan,
  placeholder = "Scan barcode or type...",
  disabled = false,
  autoFocus = true,
}: Props) {
  const { inputRef, handleKeyDown, refocus } = useBarcodeScan({ onScan });

  return (
    <div className="relative">
      <ScanLine
        size={20}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onBlur={() => {
          if (autoFocus) setTimeout(refocus, 100);
        }}
        className="w-full bg-gray-900 border-2 border-gray-600 rounded-xl pl-10 pr-4 py-3 text-lg text-white font-mono placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
