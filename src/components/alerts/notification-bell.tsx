"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import type { AdminAlert } from "@/lib/alerts/types";
import { AlertCard } from "./alert-card";

interface Props {
  employeeRole: string;
}

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell({ employeeRole }: Props) {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadUrgent, setUnreadUrgent] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const loadAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/alerts/list?status=unread&limit=10", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        alerts: AdminAlert[];
        unread_total: number;
        unread_urgent: number;
      };
      setAlerts(data.alerts);
      setUnreadTotal(data.unread_total);
      setUnreadUrgent(data.unread_urgent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (employeeRole !== "admin") return;
    loadAlerts();
    const id = setInterval(loadAlerts, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [employeeRole, loadAlerts]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function markAllRead() {
    await fetch("/api/alerts/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    loadAlerts();
  }

  if (employeeRole !== "admin") return null;

  const badgeColor = unreadUrgent > 0 ? "bg-red-500" : "bg-blue-500";

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadTotal > 0 && (
          <span
            className={`absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full ${badgeColor} text-white text-[10px] font-bold flex items-center justify-center`}
          >
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-full ml-2 bottom-0 w-80 bg-gray-950 border border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div>
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              {unreadTotal > 0 && (
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {unreadTotal} unread
                  {unreadUrgent > 0 && ` • ${unreadUrgent} urgent`}
                </p>
              )}
            </div>
            {unreadTotal > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition-colors"
                title="Mark all as read"
              >
                <CheckCheck size={12} />
                Mark all
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto p-2 space-y-2">
            {loading && alerts.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-8">Loading…</p>
            )}
            {!loading && alerts.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-8">
                You&apos;re all caught up.
              </p>
            )}
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onChanged={loadAlerts}
                compact
              />
            ))}
          </div>

          <div className="px-4 py-2 border-t border-gray-800">
            <Link
              href="/admin/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs text-gray-400 hover:text-white transition-colors py-1"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
