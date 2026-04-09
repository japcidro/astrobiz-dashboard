export type UserRole = "admin" | "va" | "fulfillment" | "marketing";
export type TimeEntryStatus = "running" | "paused" | "completed";

export interface Employee {
  id: string;
  auth_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  employee_id: string;
  date: string;
  status: TimeEntryStatus;
  started_at: string;
  ended_at: string | null;
  total_seconds: number;
  is_manual: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimePause {
  id: string;
  time_entry_id: string;
  paused_at: string;
  resumed_at: string | null;
  created_at: string;
}
