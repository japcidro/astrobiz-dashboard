import { format } from "date-fns";
import type { TimeEntry } from "@/lib/types";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TimeHistoryProps {
  entries: TimeEntry[];
}

const statusPill: Record<TimeEntry["status"], { label: string; tone: PillTone }> = {
  completed: { label: "Completed", tone: "neutral" },
  running: { label: "Running", tone: "good" },
  paused: { label: "On break", tone: "warn" },
};

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
    <section>
      <h2 className="mb-3 text-base text-fg">Last 7 days</h2>

      {sortedDates.length === 0 ? (
        <EmptyState title="No time entries yet">
          Start the timer and your sessions show up here, day by day.
        </EmptyState>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Day</TableHeader>
              <TableHeader>Entry</TableHeader>
              <TableHeader num>Hours</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedDates.map((date) => {
              const dayEntries = groupedByDate[date];
              const dayTotal = dayEntries.reduce((sum, e) => sum + e.total_seconds, 0);

              return dayEntries.map((entry, i) => {
                const status = statusPill[entry.status];
                return (
                  <TableRow key={entry.id}>
                    {i === 0 && (
                      <TableCell rowSpan={dayEntries.length} className="align-top whitespace-nowrap">
                        <p>{format(new Date(date + "T00:00:00"), "EEE, MMM d")}</p>
                        <p className="font-num text-xs text-muted">{formatDuration(dayTotal)}</p>
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Tag tone={entry.is_manual ? "warn" : "neutral"}>
                          {entry.is_manual ? "Manual" : "Timer"}
                        </Tag>
                        {entry.notes && (
                          <span className="truncate text-xs text-muted">{entry.notes}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell num>{formatDuration(entry.total_seconds)}</TableCell>
                    <TableCell>
                      <Pill tone={status.tone}>{status.label}</Pill>
                    </TableCell>
                  </TableRow>
                );
              });
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
