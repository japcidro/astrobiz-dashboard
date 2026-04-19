export interface EmployeeShift {
  id: string;
  employee_id: string;
  shift_date: string;   // YYYY-MM-DD
  start_time: string | null;  // HH:MM (24h)
  end_time: string | null;
  break_minutes: number;
  is_off_day: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeNotification {
  id: string;
  employee_id: string;
  type: string;
  severity: "urgent" | "action" | "info";
  title: string;
  body: string | null;
  action_url: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  emailed_at: string | null;
}
