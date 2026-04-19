"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCheck, RefreshCw } from "lucide-react";
import { AlertCard } from "./alert-card";
import type { AdminAlert } from "@/lib/alerts/types";

type Tab = "unread" | "acted" | "dismissed" | "all";

const TAB_LABELS: Record<Tab, string> = {
  unread: "Unread",
  acted: "Acted on",
  dismissed: "Dismissed",
  all: "All",
};

export function NotificationsInbox() {
  const [tab, setTab] = useState<Tab>("unread");
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadUrgent, setUnreadUrgent] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/alerts/list?status=${tab}&limit=100`, {
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
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function markAllRead() {
    await fetch("/api/alerts/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    load();
  }

  // Group alerts by severity bucket for unread tab
  const urgentAlerts = alerts.filter((a) => a.severity === "urgent");
  const actionAlerts = alerts.filter((a) => a.severity === "action");
  const infoAlerts = alerts.filter((a) => a.severity === "info");

  return (
    <div>
      {/* Top controls */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex gap-1 bg-gray-900/50 border border-gray-800 rounded-lg p-1">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                tab === t
                  ? "bg-white text-gray-900"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {TAB_LABELS[t]}
              {t === "unread" && unreadTotal > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">{unreadTotal}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {unreadTotal > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-300 bg-white/5 hover:bg-white/10 border border-gray-800 rounded-lg transition-colors cursor-pointer"
            >
              <CheckCheck size={12} />
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Severity summary card */}
      {tab === "unread" && unreadTotal > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-xs text-red-300 uppercase tracking-wider">Urgent</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{unreadUrgent}</p>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
            <p className="text-xs text-orange-300 uppercase tracking-wider">Action</p>
            <p className="text-2xl font-bold text-orange-400 mt-1">
              {actionAlerts.length}
            </p>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <p className="text-xs text-blue-300 uppercase tracking-wider">Info</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">
              {infoAlerts.length}
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && alerts.length === 0 && (
        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-10 text-center">
          <p className="text-gray-400">No notifications here.</p>
          <p className="text-xs text-gray-600 mt-2">
            The rule engine checks every 30 minutes. You&apos;re all caught up.
          </p>
        </div>
      )}

      {/* Alerts grouped by severity when on unread tab */}
      {tab === "unread" && !loading && alerts.length > 0 ? (
        <div className="space-y-6">
          {urgentAlerts.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">
                Urgent
              </h2>
              <div className="space-y-2">
                {urgentAlerts.map((a) => (
                  <AlertCard key={a.id} alert={a} onChanged={load} />
                ))}
              </div>
            </section>
          )}
          {actionAlerts.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2">
                Action
              </h2>
              <div className="space-y-2">
                {actionAlerts.map((a) => (
                  <AlertCard key={a.id} alert={a} onChanged={load} />
                ))}
              </div>
            </section>
          )}
          {infoAlerts.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">
                Info
              </h2>
              <div className="space-y-2">
                {infoAlerts.map((a) => (
                  <AlertCard key={a.id} alert={a} onChanged={load} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        !loading &&
        alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((a) => (
              <AlertCard key={a.id} alert={a} onChanged={load} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
