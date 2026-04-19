"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ArrowRight } from "lucide-react";
import { AlertCard } from "./alert-card";
import type { AdminAlert } from "@/lib/alerts/types";

// Hero feed for the admin Decision Cockpit. Shows up to N unread
// urgent + action alerts. Dismissals and actions update live.
interface Props {
  limit?: number;
}

export function AlertsFeed({ limit = 6 }: Props) {
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/alerts/list?status=unread&limit=${limit * 2}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        alerts: AdminAlert[];
        unread_total: number;
      };
      // Prioritize urgent > action > info, take top N
      const sorted = [...data.alerts].sort((a, b) => {
        const order = { urgent: 0, action: 1, info: 2 } as const;
        if (order[a.severity] !== order[b.severity]) {
          return order[a.severity] - order[b.severity];
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setAlerts(sorted.slice(0, limit));
      setUnreadTotal(data.unread_total);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-6 animate-pulse">
        <div className="h-5 w-40 bg-gray-800 rounded mb-4" />
        <div className="space-y-2">
          <div className="h-16 bg-gray-800/50 rounded" />
          <div className="h-16 bg-gray-800/50 rounded" />
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-6 text-center">
        <Bell size={20} className="text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-400">All caught up</p>
        <p className="text-xs text-gray-600 mt-1">
          No pending decisions. The rule engine checks every 30 minutes.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Today&apos;s Decisions</h2>
          {unreadTotal > limit && (
            <span className="text-[10px] font-medium text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
              +{unreadTotal - limit} more
            </span>
          )}
        </div>
        <Link
          href="/admin/notifications"
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          View all
          <ArrowRight size={12} />
        </Link>
      </div>
      <div className="space-y-2">
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
