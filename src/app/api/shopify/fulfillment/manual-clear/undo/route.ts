import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// Only rows written by the manual-clear path can be undone here.
// Real scan verifications stay untouched — those should not be deletable from the UI.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { ids?: string[] };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === "string" && x.length > 0)
    : [];

  if (ids.length === 0) {
    return Response.json({ error: "No ids provided" }, { status: 400 });
  }
  if (ids.length > 250) {
    return Response.json(
      { error: "Too many ids in one request (max 250)" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from("pack_verifications")
    .delete()
    .eq("source", "manual_clear")
    .in("id", ids)
    .select("id, order_number");

  if (error) {
    console.error(
      `[manual-clear/undo] Delete failed (employee=${employee.id}):`,
      error
    );
    return Response.json(
      { error: error.message, code: error.code, hint: error.hint },
      { status: 500 }
    );
  }

  const removed = deleted?.length ?? 0;
  const skipped = ids.length - removed;

  console.info(
    `[manual-clear/undo] employee=${employee.id} (${employee.full_name}) removed=${removed} skipped=${skipped} orders=${deleted?.map((d) => d.order_number).join(",")}`
  );

  return Response.json({
    success: true,
    removed,
    skipped,
  });
}
