"use client";

import Link from "next/link";
import { useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { AlertIcon } from "./alert-icon";
import type { AdminAlert } from "@/lib/alerts/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  alert: AdminAlert;
  onChanged?: () => void;
  compact?: boolean;
}

export function AlertCard({ alert, onChanged, compact = false }: Props) {
  const [isActing, setIsActing] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  async function handleAct() {
    if (!alert.action_url) return;
    setIsActing(true);
    try {
      await fetch("/api/alerts/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: alert.id }),
      });
      onChanged?.();
    } finally {
      setIsActing(false);
    }
  }

  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setIsDismissing(true);
    try {
      await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: alert.id }),
      });
      onChanged?.();
    } finally {
      setIsDismissing(false);
    }
  }

  const isUnread = !alert.read_at;

  return (
    <div
      className={`relative rounded-lg border p-3 transition-colors ${
        isUnread
          ? "border-gray-700 bg-gray-800/70"
          : "border-gray-800 bg-gray-900/30"
      } ${isDismissing ? "opacity-40" : ""}`}
    >
      <div className="flex gap-3">
        <AlertIcon
          type={alert.type}
          severity={alert.severity}
          size={compact ? "sm" : "md"}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3
              className={`text-sm font-medium leading-snug ${
                isUnread ? "text-white" : "text-gray-400"
              }`}
            >
              {alert.title}
            </h3>
            {!alert.dismissed_at && (
              <button
                onClick={handleDismiss}
                className="text-gray-600 hover:text-gray-300 transition-colors cursor-pointer flex-shrink-0"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {alert.body && !compact && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {alert.body}
            </p>
          )}
          <div className="flex items-center justify-between mt-2 gap-2">
            <span className="text-[10px] text-gray-600 uppercase tracking-wider">
              {timeAgo(alert.created_at)}
              {alert.acted_on_at && " • acted"}
              {alert.dismissed_at && !alert.acted_on_at && " • dismissed"}
            </span>
            {alert.action_url && !alert.acted_on_at && !alert.dismissed_at && (
              <Link
                href={alert.action_url}
                onClick={handleAct}
                className="inline-flex items-center gap-1 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded transition-colors"
              >
                {isActing ? "..." : "Review"}
                <ArrowRight size={12} />
              </Link>
            )}
          </div>
        </div>
      </div>
      {isUnread && (
        <div className="absolute top-3 right-8 w-1.5 h-1.5 rounded-full bg-blue-400" />
      )}
    </div>
  );
}
