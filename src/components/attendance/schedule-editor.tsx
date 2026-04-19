"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, X, Check } from "lucide-react";
import type { EmployeeShift } from "@/lib/attendance/types";

interface EmployeeRow {
  id: string;
  full_name: string;
  role: string;
  email: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeek(d: Date): Date {
  // Monday as week start
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  const r = new Date(d);
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-PH", opts)} – ${end.toLocaleDateString("en-PH", opts)}, ${end.getFullYear()}`;
}

function roleColor(role: string): string {
  const map: Record<string, string> = {
    admin: "bg-purple-500/20 text-purple-400",
    va: "bg-blue-500/20 text-blue-400",
    fulfillment: "bg-green-500/20 text-green-400",
    marketing: "bg-orange-500/20 text-orange-400",
  };
  return map[role] ?? "bg-gray-500/20 text-gray-400";
}

function ShiftCell({
  shift,
  onClick,
}: {
  shift: EmployeeShift | undefined;
  onClick: () => void;
}) {
  if (!shift) {
    return (
      <button
        onClick={onClick}
        className="w-full h-full min-h-[52px] border border-dashed border-gray-800 rounded-md text-[10px] text-gray-600 hover:bg-white/5 hover:border-gray-700 transition-colors cursor-pointer"
      >
        + Set
      </button>
    );
  }
  if (shift.is_off_day) {
    return (
      <button
        onClick={onClick}
        className="w-full h-full min-h-[52px] border border-gray-800 rounded-md text-[11px] text-gray-500 bg-gray-900/30 hover:bg-gray-900 cursor-pointer"
      >
        Off
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="w-full h-full min-h-[52px] border border-gray-700 bg-gray-800/60 hover:bg-gray-800 rounded-md p-1 text-left cursor-pointer"
    >
      <p className="text-[11px] font-semibold text-white">
        {shift.start_time?.slice(0, 5)} – {shift.end_time?.slice(0, 5)}
      </p>
      <p className="text-[10px] text-gray-500">{shift.break_minutes}m break</p>
    </button>
  );
}

function ShiftModal({
  employeeName,
  dateLabel,
  initialShift,
  onSave,
  onClose,
  onDelete,
}: {
  employeeName: string;
  dateLabel: string;
  initialShift: EmployeeShift | undefined;
  onSave: (args: {
    start_time: string | null;
    end_time: string | null;
    break_minutes: number;
    is_off_day: boolean;
  }) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [startTime, setStartTime] = useState(initialShift?.start_time?.slice(0, 5) ?? "09:00");
  const [endTime, setEndTime] = useState(initialShift?.end_time?.slice(0, 5) ?? "18:00");
  const [breakMinutes, setBreakMinutes] = useState(initialShift?.break_minutes ?? 60);
  const [isOff, setIsOff] = useState(initialShift?.is_off_day ?? false);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-white">{employeeName}</p>
            <p className="text-xs text-gray-500">{dateLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isOff}
              onChange={(e) => setIsOff(e.target.checked)}
              className="accent-white"
            />
            <span className="text-sm text-gray-300">Day off</span>
          </label>

          {!isOff && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wider">
                    Start
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wider">
                    End
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-wider">
                  Break (minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={180}
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Number(e.target.value))}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 gap-2">
          {initialShift && onDelete ? (
            <button
              onClick={() => {
                if (confirm("Remove this shift?")) {
                  onDelete();
                  onClose();
                }
              }}
              className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
            >
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                onSave({
                  start_time: isOff ? null : `${startTime}:00`,
                  end_time: isOff ? null : `${endTime}:00`,
                  break_minutes: breakMinutes,
                  is_off_day: isOff,
                })
              }
              className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-white hover:bg-gray-100 rounded-md cursor-pointer flex items-center gap-1"
            >
              <Check size={12} /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScheduleEditor() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState<EmployeeShift[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{
    employee_id: string;
    shift_date: string;
    employee_name: string;
    date_label: string;
  } | null>(null);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = toISODate(weekStart);
      const end = toISODate(addDays(weekStart, 6));
      const res = await fetch(
        `/api/employee-shifts/list?start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        shifts: EmployeeShift[];
        employees: EmployeeRow[];
      };
      setShifts(data.shifts);
      setEmployees(data.employees);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  const shiftFor = (employeeId: string, date: Date): EmployeeShift | undefined => {
    const iso = toISODate(date);
    return shifts.find((s) => s.employee_id === employeeId && s.shift_date === iso);
  };

  async function handleSave(args: {
    start_time: string | null;
    end_time: string | null;
    break_minutes: number;
    is_off_day: boolean;
  }) {
    if (!editing) return;
    setSaving(true);
    try {
      await fetch("/api/employee-shifts/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: editing.employee_id,
          shift_date: editing.shift_date,
          ...args,
        }),
      });
      await load();
    } finally {
      setSaving(false);
      setEditing(null);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    await fetch("/api/employee-shifts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: editing.employee_id,
        shift_date: editing.shift_date,
      }),
    });
    await load();
  }

  async function copyLastWeek() {
    const sourceStart = toISODate(addDays(weekStart, -7));
    const sourceEnd = toISODate(addDays(weekStart, -1));
    const targetStart = toISODate(weekStart);
    const res = await fetch("/api/employee-shifts/copy-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_start: sourceStart,
        source_end: sourceEnd,
        target_start: targetStart,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.copied === 0) {
        alert("Walang shifts sa last week para i-copy.");
      } else {
        await load();
      }
    }
  }

  const initialShiftForEditing = editing
    ? shifts.find(
        (s) =>
          s.employee_id === editing.employee_id && s.shift_date === editing.shift_date
      )
    : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-[220px] text-center">
            <p className="text-sm font-semibold text-white">
              {formatRange(weekStart, addDays(weekStart, 6))}
            </p>
          </div>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="ml-1 px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-white border border-gray-800 rounded-md cursor-pointer"
          >
            This week
          </button>
        </div>
        <button
          onClick={copyLastWeek}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-300 bg-white/5 hover:bg-white/10 border border-gray-800 rounded-lg cursor-pointer"
        >
          <Copy size={12} /> Copy last week
        </button>
      </div>

      {loading ? (
        <div className="h-48 bg-gray-900/30 rounded-xl animate-pulse" />
      ) : employees.length === 0 ? (
        <p className="text-sm text-gray-500">No active employees.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 pb-3 pr-2 w-40">
                  Employee
                </th>
                {weekDates.map((d, i) => (
                  <th
                    key={i}
                    className="text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500 pb-3 px-1"
                  >
                    <div>{DAY_LABELS[i]}</div>
                    <div className="text-gray-600 font-normal mt-0.5">
                      {d.getDate()}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td className="pr-2 py-1">
                    <div className="text-sm text-white truncate">{emp.full_name}</div>
                    <span
                      className={`inline-block mt-0.5 px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded ${roleColor(emp.role)}`}
                    >
                      {emp.role}
                    </span>
                  </td>
                  {weekDates.map((d, i) => (
                    <td key={i} className="px-1 py-1">
                      <ShiftCell
                        shift={shiftFor(emp.id, d)}
                        onClick={() =>
                          setEditing({
                            employee_id: emp.id,
                            shift_date: toISODate(d),
                            employee_name: emp.full_name,
                            date_label: d.toLocaleDateString("en-PH", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            }),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ShiftModal
          employeeName={editing.employee_name}
          dateLabel={editing.date_label}
          initialShift={initialShiftForEditing}
          onSave={handleSave}
          onClose={() => !saving && setEditing(null)}
          onDelete={initialShiftForEditing ? handleDelete : undefined}
        />
      )}
    </div>
  );
}
