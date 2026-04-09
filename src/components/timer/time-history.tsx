import { format } from "date-fns";
import { Clock, Edit3 } from "lucide-react";
import type { TimeEntry } from "@/lib/types";

interface TimeHistoryProps {
  entries: TimeEntry[];
}

export function TimeHistory({ entries }: TimeHistoryProps) {
  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  const groupedByDate = entries.reduce(
    (acc, entry) => {
      const date = entry.date;
      if (!acc[date]) acc[date] = [];
      acc[date].push(entry);
      return acc;
    },
    {} as Record<string, TimeEntry[]>
  );

  const sortedDates = Object.keys(groupedByDate).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Recent History</h2>

      {sortedDates.length === 0 ? (
        <p className="text-gray-500 text-sm">No time entries yet.</p>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((date) => {
            const dayEntries = groupedByDate[date];
            const dayTotal = dayEntries.reduce(
              (sum, e) => sum + e.total_seconds,
              0
            );

            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-300">
                    {format(new Date(date + "T00:00:00"), "EEE, MMM d")}
                  </span>
                  <span className="text-sm font-medium text-white">
                    {formatDuration(dayTotal)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {dayEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-3 py-2 bg-gray-700/30 rounded-lg"
                    >
                      {entry.is_manual ? (
                        <Edit3 size={14} className="text-yellow-400" />
                      ) : (
                        <Clock size={14} className="text-blue-400" />
                      )}
                      <span className="text-sm text-gray-300 flex-1">
                        {entry.is_manual ? "Manual entry" : "Timer session"}
                        {entry.notes && (
                          <span className="text-gray-500 ml-2">
                            — {entry.notes}
                          </span>
                        )}
                      </span>
                      <span className="text-sm text-white font-medium">
                        {formatDuration(entry.total_seconds)}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          entry.status === "completed"
                            ? "bg-green-900/50 text-green-400"
                            : entry.status === "running"
                              ? "bg-blue-900/50 text-blue-400"
                              : "bg-yellow-900/50 text-yellow-400"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
