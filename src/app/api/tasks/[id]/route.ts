import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { insertAlert } from "@/lib/alerts/insert";
import type { UpdateTaskInput, Task } from "@/lib/tasks/types";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as UpdateTaskInput;

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) {
      return Response.json({ error: "Title cannot be empty" }, { status: 400 });
    }
    updates.title = t;
  }
  if (body.description !== undefined) {
    updates.description = body.description?.trim() || null;
  }
  if (body.status !== undefined) {
    if (!TASK_STATUSES.includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(body.priority)) {
      return Response.json({ error: "Invalid priority" }, { status: 400 });
    }
    updates.priority = body.priority;
  }
  if (body.due_date !== undefined) updates.due_date = body.due_date || null;
  if (body.link_url !== undefined) updates.link_url = body.link_url?.trim() || null;

  // Only admin can reassign
  if (body.assigned_to !== undefined) {
    if (employee.role !== "admin") {
      return Response.json(
        { error: "Only admin can reassign tasks" },
        { status: 403 }
      );
    }
    updates.assigned_to = body.assigned_to;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = await createClient();

  // Load the pre-update row so we can detect status transitions (→ done) for
  // notifying the task creator.
  const { data: existing, error: loadErr } = await supabase
    .from("tasks")
    .select("id, title, status, created_by, assigned_to")
    .eq("id", id)
    .single();

  if (loadErr || !existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const justCompleted =
    body.status === "done" && existing.status !== "done";

  // Only fire the alert when the assignee finishes a cross-assigned task
  // (not when self-closing your own tasks — that'd be noise).
  if (justCompleted && existing.created_by !== existing.assigned_to) {
    void insertAlert(supabase, {
      type: "task_completed",
      severity: "info",
      title: `Task completed: ${existing.title.slice(0, 80)}`,
      body: `Marked done by ${employee.full_name ?? "assignee"}`,
      resource_type: "task",
      resource_id: id,
      action_url: `/tasks?id=${id}`,
      payload: {
        task_id: id,
        completed_by: employee.id,
        notify_employee_id: existing.created_by,
      },
      dedup_hours: 0,
    });
  }

  return Response.json({ task: data as Task });
}

// DELETE /api/tasks/[id]
// RLS enforces: admin OR creator only. Assignees should mark 'cancelled'.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
