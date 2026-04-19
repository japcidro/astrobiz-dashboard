"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  UserX,
  TimerOff,
  RefreshCw,
  CalendarPlus,
} from "lucide-react";

interface Issue {
  type: "not_clocked_in" | "long_running" | "auto_closed_yesterday" | "missed_clockout";
  employee_id: string;
  employee_name: string;
  employee_role: string;
  detail: string;
  severity: "urgent" | "action" | "info";
}

const TYPE_META: Record<
  Issue["type"],
  { label: string; icon: React.ReactNode }
> = {
  not_clocked_in: { label: "Not clocked in", icon: <UserX size={14} /> },
  long_running: { label: "Long running session", icon: <Clock size={14} /> },
  missed_clockout: { label: "Missed clock-out", icon: <TimerOff size={14} /> },
  auto_closed_yesterday: { label: "Auto-closed yesterday", icon: <AlertTriangle size={14} /> },
};

const SEVERITY_STYLES: Record<Issue["severity"], string> = {
  urgent: "border-red-500/30 bg-red-500/5",
  action: "border-orange-500/30 bg-orange-500/5",
  info: "border-gray-800 bg-gray-900/30",
};

const SEVERITY_DOT: Record<Issue["severity"], string> = {
  urgent: "bg-red-400",
  action: "bg-orange-400",
  info: "bg-gray-500",
};

export function AttendanceIssues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/attendance-issues", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { issues: Issue[] };
      setIssues(data.issues);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Attendance Issues</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Live check · updates every minute
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/attendance/schedule"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-300 bg-white/5 hover:bg-white/10 border border-gray-800 rounded-lg cursor-pointer"
          >
            <CalendarPlus size={12} /> Schedule
          </Link>
          <button
            onClick={load}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading && issues.length === 0 ? (
        <div className="h-20 bg-gray-800/30 rounded-xl animate-pulse" />
      ) : issues.length === 0 ? (
        <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-5 text-center">
          <p className="text-sm text-gray-400">No attendance issues right now.</p>
          <p className="text-xs text-gray-600 mt-1">
            Everyone scheduled is clocked in correctly.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue, i) => {
            const meta = TYPE_META[issue.type];
            return (
              <div
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg border ${SEVERITY_STYLES[issue.severity]}`}
              >
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEVERITY_DOT[issue.severity]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-gray-400">{meta.icon}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      {meta.label}
                    </span>
                    <span className="text-xs text-white font-medium">
                      {issue.employee_name}
                    </span>
                    <span className="text-[10px] text-gray-600 uppercase">
                      {issue.employee_role}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{issue.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
