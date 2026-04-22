export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "med" | "high";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null; // YYYY-MM-DD
  created_by: string;
  assigned_to: string;
  link_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// Joined view with employee names used by the UI layer
export interface TaskWithPeople extends Task {
  created_by_name: string | null;
  assigned_to_name: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
  assigned_to?: string | null; // defaults to self; admin can override
  link_url?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  link_url?: string | null;
  assigned_to?: string;
}

export const TASK_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "done",
  "cancelled",
];

export const TASK_PRIORITIES: TaskPriority[] = ["low", "med", "high"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};
