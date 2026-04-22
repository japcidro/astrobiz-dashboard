"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  Circle,
  ClipboardList,
  Plus,
  RefreshCw,
  X,
  AlertCircle,
  Trash2,
  ExternalLink,
  Pencil,
  ChevronDown,
  Calendar,
} from "lucide-react";
import type {
  TaskWithPeople,
  TaskStatus,
  TaskPriority,
  CreateTaskInput,
  UpdateTaskInput,
} from "@/lib/tasks/types";
import {
  TASK_PRIORITIES,
  STATUS_LABELS,
  PRIORITY_LABELS,
} from "@/lib/tasks/types";

interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

interface Props {
  currentEmployeeId: string;
  currentRole: string;
}

type Scope = "mine" | "assigned_by_me" | "all";

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-gray-800 text-gray-400 border-gray-700",
  med: "bg-blue-900/30 text-blue-300 border-blue-700/50",
  high: "bg-red-900/30 text-red-300 border-red-700/50",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "bg-gray-800 text-gray-300 border-gray-700",
  in_progress: "bg-yellow-900/30 text-yellow-300 border-yellow-700/50",
  done: "bg-emerald-900/30 text-emerald-300 border-emerald-700/50",
  cancelled: "bg-gray-900 text-gray-500 border-gray-800",
};

export function TasksBoard({ currentEmployeeId, currentRole }: Props) {
  const isAdmin = currentRole === "admin";

  const [scope, setScope] = useState<Scope>("mine");
  const [tasks, setTasks] = useState<TaskWithPeople[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(true);
  const [selected, setSelected] = useState<TaskWithPeople | null>(null);

  // Quick add form
  const [quickTitle, setQuickTitle] = useState("");
  const [quickPriority, setQuickPriority] = useState<TaskPriority>("med");
  const [quickDue, setQuickDue] = useState("");
  const [quickAssignee, setQuickAssignee] = useState<string>(
    currentEmployeeId
  );
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?scope=${scope}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setTasks((json.tasks ?? []) as TaskWithPeople[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  // Admin-only: fetch employees once for the assignee picker
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/team")
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json.employees)) {
          setEmployees(
            (json.employees as Employee[]).filter((e) => e.is_active)
          );
        }
      })
      .catch(() => {});
  }, [isAdmin]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (hideDone && (t.status === "done" || t.status === "cancelled")) {
        return false;
      }
      return true;
    });
  }, [tasks, hideDone]);

  // Group by status so the board feels organized
  const groups = useMemo(() => {
    const g: Record<TaskStatus, TaskWithPeople[]> = {
      pending: [],
      in_progress: [],
      done: [],
      cancelled: [],
    };
    for (const t of filtered) g[t.status].push(t);
    return g;
  }, [filtered]);

  const handleCreate = async () => {
    if (!quickTitle.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const payload: CreateTaskInput = {
        title: quickTitle.trim(),
        priority: quickPriority,
        due_date: quickDue || null,
      };
      if (isAdmin && quickAssignee !== currentEmployeeId) {
        payload.assigned_to = quickAssignee;
      }
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create");
      setQuickTitle("");
      setQuickPriority("med");
      setQuickDue("");
      setQuickAssignee(currentEmployeeId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string, updates: UpdateTaskInput) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
      // Optimistic: patch the list in place
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...json.task } : t))
      );
      setSelected((prev) =>
        prev?.id === id ? { ...prev, ...json.task } : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete");
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const toggleDone = (task: TaskWithPeople) => {
    const next: TaskStatus = task.status === "done" ? "pending" : "done";
    handleUpdate(task.id, { status: next });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-800 rounded-lg">
            <ClipboardList size={20} className="text-gray-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Tasks</h1>
            <p className="text-gray-400 text-sm">
              Personal todos + tasks{isAdmin ? " you've assigned" : " assigned to you"}
            </p>
          </div>
        </div>
      </div>

      {/* Scope tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800">
        <ScopeTab active={scope === "mine"} onClick={() => setScope("mine")}>
          My Tasks
        </ScopeTab>
        {isAdmin && (
          <>
            <ScopeTab
              active={scope === "assigned_by_me"}
              onClick={() => setScope("assigned_by_me")}
            >
              Assigned by Me
            </ScopeTab>
            <ScopeTab active={scope === "all"} onClick={() => setScope("all")}>
              All Tasks
            </ScopeTab>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="w-3 h-3"
            />
            Hide done
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white cursor-pointer"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Quick add */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <input
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && quickTitle.trim()) handleCreate();
          }}
          placeholder="Add a task..."
          className="flex-1 min-w-[200px] bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <select
          value={quickPriority}
          onChange={(e) => setQuickPriority(e.target.value as TaskPriority)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={quickDue}
          onChange={(e) => setQuickDue(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {isAdmin && (
          <select
            value={quickAssignee}
            onChange={(e) => setQuickAssignee(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 max-w-[180px]"
          >
            <option value={currentEmployeeId}>Myself</option>
            {employees
              .filter((e) => e.id !== currentEmployeeId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
          </select>
        )}
        <button
          onClick={handleCreate}
          disabled={!quickTitle.trim() || creating}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Board */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw size={20} className="animate-spin text-gray-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500 text-sm">
            {tasks.length === 0
              ? "No tasks yet. Add one above."
              : hideDone
                ? "All tasks done. Nice."
                : "No tasks match your filter."}
          </div>
        ) : (
          <>
            <StatusGroup
              status="in_progress"
              tasks={groups.in_progress}
              currentEmployeeId={currentEmployeeId}
              isAdmin={isAdmin}
              onToggleDone={toggleDone}
              onClick={setSelected}
              onUpdate={handleUpdate}
            />
            <StatusGroup
              status="pending"
              tasks={groups.pending}
              currentEmployeeId={currentEmployeeId}
              isAdmin={isAdmin}
              onToggleDone={toggleDone}
              onClick={setSelected}
              onUpdate={handleUpdate}
            />
            {!hideDone && (
              <>
                <StatusGroup
                  status="done"
                  tasks={groups.done}
                  currentEmployeeId={currentEmployeeId}
                  isAdmin={isAdmin}
                  onToggleDone={toggleDone}
                  onClick={setSelected}
                  onUpdate={handleUpdate}
                />
                <StatusGroup
                  status="cancelled"
                  tasks={groups.cancelled}
                  currentEmployeeId={currentEmployeeId}
                  isAdmin={isAdmin}
                  onToggleDone={toggleDone}
                  onClick={setSelected}
                  onUpdate={handleUpdate}
                />
              </>
            )}
          </>
        )}
      </div>

      {selected && (
        <TaskDetailModal
          task={selected}
          employees={employees}
          isAdmin={isAdmin}
          currentEmployeeId={currentEmployeeId}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function ScopeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
        active
          ? "border-emerald-500 text-white"
          : "border-transparent text-gray-500 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function StatusGroup({
  status,
  tasks,
  currentEmployeeId,
  isAdmin,
  onToggleDone,
  onClick,
  onUpdate,
}: {
  status: TaskStatus;
  tasks: TaskWithPeople[];
  currentEmployeeId: string;
  isAdmin: boolean;
  onToggleDone: (task: TaskWithPeople) => void;
  onClick: (task: TaskWithPeople) => void;
  onUpdate: (id: string, updates: UpdateTaskInput) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          {STATUS_LABELS[status]}
        </h2>
        <span className="text-[11px] text-gray-600">{tasks.length}</span>
      </div>
      <div className="space-y-1.5">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            currentEmployeeId={currentEmployeeId}
            isAdmin={isAdmin}
            onToggleDone={onToggleDone}
            onClick={onClick}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  currentEmployeeId,
  isAdmin,
  onToggleDone,
  onClick,
  onUpdate,
}: {
  task: TaskWithPeople;
  currentEmployeeId: string;
  isAdmin: boolean;
  onToggleDone: (task: TaskWithPeople) => void;
  onClick: (task: TaskWithPeople) => void;
  onUpdate: (id: string, updates: UpdateTaskInput) => void;
}) {
  const isDone = task.status === "done";
  const isMine = task.assigned_to === currentEmployeeId;
  const assignedByOther = !isMine && task.created_by !== currentEmployeeId;
  const dueSoon = dueSoonFlag(task.due_date, task.status);

  return (
    <div
      className={`group bg-gray-800/40 hover:bg-gray-800/70 border border-gray-700/50 rounded-lg px-3 py-2 flex items-center gap-3 transition-colors ${
        isDone || task.status === "cancelled" ? "opacity-60" : ""
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone(task);
        }}
        className="flex-shrink-0 cursor-pointer text-gray-400 hover:text-emerald-400 transition-colors"
        title={isDone ? "Mark as pending" : "Mark as done"}
      >
        {isDone ? (
          <CheckCircle size={18} className="text-emerald-400" />
        ) : (
          <Circle size={18} />
        )}
      </button>

      <button
        onClick={() => onClick(task)}
        className="flex-1 min-w-0 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <p
            className={`text-sm truncate ${
              isDone ? "line-through text-gray-500" : "text-white"
            }`}
          >
            {task.title}
          </p>
          <span
            className={`flex-shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[task.priority]}`}
          >
            {PRIORITY_LABELS[task.priority]}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
          {task.due_date && (
            <span className={dueSoon ? "text-yellow-400" : ""}>
              <Calendar
                size={10}
                className="inline mr-0.5 -translate-y-px"
              />
              {formatDueDate(task.due_date)}
            </span>
          )}
          {assignedByOther && task.created_by_name && (
            <span>from {task.created_by_name}</span>
          )}
          {!isMine && task.assigned_to_name && (
            <span>→ {task.assigned_to_name}</span>
          )}
          {task.description && (
            <span className="truncate">
              {task.description.length > 80
                ? task.description.slice(0, 80) + "..."
                : task.description}
            </span>
          )}
        </div>
      </button>

      <div className="flex-shrink-0 flex items-center gap-1">
        <StatusSelect
          task={task}
          onUpdate={onUpdate}
          disabled={!isMine && !isAdmin}
        />
      </div>
    </div>
  );
}

function StatusSelect({
  task,
  onUpdate,
  disabled,
}: {
  task: TaskWithPeople;
  onUpdate: (id: string, updates: UpdateTaskInput) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={task.status}
        disabled={disabled}
        onChange={(e) =>
          onUpdate(task.id, { status: e.target.value as TaskStatus })
        }
        className={`appearance-none pl-2 pr-6 py-1 rounded-md border text-[10px] font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${STATUS_COLORS[task.status]}`}
      >
        <option value="pending">To do</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <ChevronDown
        size={10}
        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
    </div>
  );
}

function TaskDetailModal({
  task,
  employees,
  isAdmin,
  currentEmployeeId,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: TaskWithPeople;
  employees: Employee[];
  isAdmin: boolean;
  currentEmployeeId: string;
  onClose: () => void;
  onUpdate: (id: string, updates: UpdateTaskInput) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [linkUrl, setLinkUrl] = useState(task.link_url ?? "");
  const [assignedTo, setAssignedTo] = useState(task.assigned_to);
  const [editingTitle, setEditingTitle] = useState(false);

  const canEditCore = isAdmin || task.created_by === currentEmployeeId;
  const canDelete = canEditCore;

  const dirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    dueDate !== (task.due_date ?? "") ||
    priority !== task.priority ||
    linkUrl !== (task.link_url ?? "") ||
    assignedTo !== task.assigned_to;

  const save = () => {
    const updates: UpdateTaskInput = {};
    if (title !== task.title) updates.title = title;
    if (description !== (task.description ?? ""))
      updates.description = description;
    if (dueDate !== (task.due_date ?? "")) updates.due_date = dueDate || null;
    if (priority !== task.priority) updates.priority = priority;
    if (linkUrl !== (task.link_url ?? ""))
      updates.link_url = linkUrl || null;
    if (isAdmin && assignedTo !== task.assigned_to)
      updates.assigned_to = assignedTo;
    if (Object.keys(updates).length === 0) return;
    onUpdate(task.id, updates);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingTitle && canEditCore ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingTitle(false);
                }}
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            ) : (
              <button
                onClick={() => canEditCore && setEditingTitle(true)}
                className={`text-left text-lg font-bold text-white ${
                  canEditCore ? "hover:text-emerald-300 cursor-pointer" : ""
                }`}
              >
                {title}
                {canEditCore && (
                  <Pencil size={12} className="inline ml-2 text-gray-600" />
                )}
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-500 hover:text-white cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={canEditCore ? "Add more detail..." : "—"}
              readOnly={!canEditCore}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none disabled:opacity-60"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                disabled={!canEditCore}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={!canEditCore}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
              />
            </Field>
          </div>

          <Field label="Link (optional)">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://... or /marketing/ads"
              readOnly={!canEditCore}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
            />
            {task.link_url && (
              <a
                href={task.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <ExternalLink size={11} />
                Open
              </a>
            )}
          </Field>

          {isAdmin && (
            <Field label="Assigned to">
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value={currentEmployeeId}>Myself</option>
                {employees
                  .filter((e) => e.id !== currentEmployeeId)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          <div className="text-[10px] text-gray-600 pt-2 border-t border-gray-800">
            Created by {task.created_by_name ?? "—"} ·{" "}
            {new Date(task.created_at).toLocaleString()}
            {task.completed_at && (
              <> · Completed {new Date(task.completed_at).toLocaleString()}</>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-between gap-3">
          {canDelete ? (
            <button
              onClick={() => onDelete(task.id)}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 cursor-pointer"
            >
              <Trash2 size={12} />
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm text-gray-400 hover:text-white px-3 py-2 cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={!dirty}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function formatDueDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return `In ${diff}d`;
  if (diff < -1 && diff > -7) return `${Math.abs(diff)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dueSoonFlag(
  iso: string | null,
  status: TaskStatus
): boolean {
  if (!iso) return false;
  if (status === "done" || status === "cancelled") return false;
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diff <= 1;
}
