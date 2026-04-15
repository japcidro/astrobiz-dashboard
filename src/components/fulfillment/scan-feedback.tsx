"use client";

import { useEffect, useRef } from "react";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { playSuccess, playError, playWarning } from "@/lib/fulfillment/audio";

interface Props {
  type: "success" | "error" | "warning" | null;
  message: string;
  subMessage?: string;
  duration?: number;
  onDismiss?: () => void;
}

const CONFIG = {
  success: {
    bg: "bg-green-600",
    Icon: CheckCircle,
    play: playSuccess,
  },
  error: {
    bg: "bg-red-600",
    Icon: XCircle,
    play: playError,
  },
  warning: {
    bg: "bg-yellow-600",
    Icon: AlertTriangle,
    play: playWarning,
  },
} as const;

export function ScanFeedback({
  type,
  message,
  subMessage,
  duration = 1500,
  onDismiss,
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!type) return;

    CONFIG[type].play();

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [type, message, duration, onDismiss]);

  if (!type) return null;

  const { bg, Icon } = CONFIG[type];

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center ${bg} bg-opacity-95`}
      onClick={onDismiss}
    >
      <Icon size={120} className="text-white mb-6" />
      <p className="text-4xl md:text-6xl font-bold text-white text-center px-8">
        {message}
      </p>
      {subMessage && (
        <p className="text-xl md:text-2xl text-white/80 mt-4 text-center px-8">
          {subMessage}
        </p>
      )}
    </div>
  );
}
