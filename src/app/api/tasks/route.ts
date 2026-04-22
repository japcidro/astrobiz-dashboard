import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { insertAlert } from "@/lib/alerts/insert";
import type {
  CreateTaskInput,
  TaskPriority,
  Task,
} from "@/lib/tasks/types";
import { TASK_PRIORITIES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

// GET /api/tasks?scope=mine|assigned_by_me|all&status=pending
// RLS handles the real filtering; `scope` is a UX convenience filter.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "mine";
  const statusFilter = searchParams.get("status");

  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select(
      `
      id, title, description, status, priority, due_date,
      created_by, assigned_to, link_url,
      created_at, updated_at, completed_at,
      creator:created_by ( full_name ),
      assignee:assigned_to ( full_name )
    `
    )
    .order("status", { ascending: true })
    .order("priority", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (scope === "mine") {
    query = query.eq("assigned_to", employee.id);
  } else if (scope === "assigned_by_me") {
    query = query.eq("created_by", employee.id).neq("assigned_to", employee.id);
  } else if (scope === "all") {
    if (employee.role !== "admin") {
      query = query.or(
        `assigned_to.eq.${employee.id},created_by.eq.${employee.id}`
      );
    }
  }

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Flatten the join into the shape the UI expects (TaskWithPeople)
  type Row = Task & {
    creator: { full_name: string | null } | { full_name: string | null }[] | null;
    assignee: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const tasks = (data || []).map((r) => {
    const row = r as Row;
    const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
    const assignee = Array.isArray(row.assignee) ? row.assignee[0] : row.assignee;
    return {
      ...row,
      creator: undefined,
      assignee: undefined,
      created_by_name: creator?.full_name ?? null,
      assigned_to_name: assignee?.full_name ?? null,
    };
  });

  return Response.json({ tasks });
}

// POST /api/tasks — create a task
//  - Anyone can self-assign (assigned_to omitted or = own id)
//  - Only admin can assign to someone else
//  - Fires a task_assigned alert if assignee != creator
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreateTaskInput;
  if (!body.title || !body.title.trim()) {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }

  const assignedTo = body.assigned_to || employee.id;
  const isCrossAssignment = assignedTo !== employee.id;

  if (isCrossAssignment && employee.role !== "admin") {
    return Response.json(
      { error: "Only admin can assign tasks to others" },
      { status: 403 }
    );
  }

  const priority: TaskPriority = TASK_PRIORITIES.includes(
    body.priority as TaskPriority
  )
    ? (body.priority as TaskPriority)
    : "med";

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: body.title.trim(),
      description: body.description?.trim() || null,
      status: "pending",
      priority,
      due_date: body.due_date || null,
      created_by: employee.id,
      assigned_to: assignedTo,
      link_url: body.link_url?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Notify the assignee when admin hands off a task
  if (isCrossAssignment) {
    const { data: assignee } = await supabase
      .from("employees")
      .select("full_name")
      .eq("id", assignedTo)
      .single();
    void insertAlert(supabase, {
      type: "task_assigned",
      severity: "action",
      title: `New task: ${body.title.trim().slice(0, 80)}`,
      body: body.description?.trim().slice(0, 200) ?? undefined,
      resource_type: "task",
      resource_id: (data as Task).id,
      action_url: `/tasks?id=${(data as Task).id}`,
      payload: {
        task_id: (data as Task).id,
        assigned_by: employee.id,
        assigned_to: assignedTo,
        assignee_name: assignee?.full_name ?? null,
      },
      dedup_hours: 0, // every assignment notifies; no dedup needed
    });
  }

  return Response.json({ task: data });
}
