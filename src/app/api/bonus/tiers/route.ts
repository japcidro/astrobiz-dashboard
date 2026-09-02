import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { BonusTier } from "@/lib/bonus/types";

export const dynamic = "force-dynamic";

type TierRow = {
  id: string;
  parcel_threshold: number;
  bonus_amount: number | string | null;
  label: string | null;
  is_active: boolean | null;
};

function toTier(row: TierRow): BonusTier {
  return {
    id: row.id,
    parcel_threshold: Number(row.parcel_threshold),
    bonus_amount: Number(row.bonus_amount ?? 0),
    label: row.label,
    is_active: row.is_active !== false,
  };
}

// Every signed-in employee reads the ladder — that is the point of the page.
export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("bonus_tiers")
    .select("id, parcel_threshold, bonus_amount, label, is_active")
    .order("parcel_threshold", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tiers: (data ?? []).map((r) => toTier(r as TierRow)) });
}

// Admin-only: replace the whole ladder in one shot. The editor sends the
// full list, so a PUT is simpler (and more predictable) than per-row CRUD.
export async function PUT(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { tiers?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.tiers)) {
    return Response.json({ error: "tiers must be an array" }, { status: 400 });
  }

  const seen = new Set<number>();
  const rows: {
    parcel_threshold: number;
    bonus_amount: number;
    label: string | null;
    is_active: boolean;
  }[] = [];

  for (const raw of body.tiers as Record<string, unknown>[]) {
    const threshold = Number(raw.parcel_threshold);
    const amount = Number(raw.bonus_amount);

    if (!Number.isFinite(threshold) || threshold <= 0) {
      return Response.json(
        { error: `Invalid parcel threshold: ${String(raw.parcel_threshold)}` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return Response.json(
        { error: `Invalid bonus amount for tier ${threshold}` },
        { status: 400 }
      );
    }
    // The table has a unique constraint on parcel_threshold — reject the
    // duplicate here so the user gets a readable message instead of a
    // Postgres constraint error.
    if (seen.has(Math.round(threshold))) {
      return Response.json(
        { error: `Duplicate tier threshold: ${Math.round(threshold)}` },
        { status: 400 }
      );
    }
    seen.add(Math.round(threshold));

    rows.push({
      parcel_threshold: Math.round(threshold),
      bonus_amount: Math.round(amount * 100) / 100,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : null,
      is_active: raw.is_active !== false,
    });
  }

  const supabase = createServiceClient();

  // Delete-then-insert: the editor owns the entire ladder, and removing a
  // tier has to actually remove it.
  const { error: delError } = await supabase
    .from("bonus_tiers")
    .delete()
    .not("id", "is", null);

  if (delError) {
    return Response.json({ error: delError.message }, { status: 500 });
  }

  if (rows.length === 0) {
    return Response.json({ tiers: [] });
  }

  const { data, error } = await supabase
    .from("bonus_tiers")
    .insert(rows)
    .select("id, parcel_threshold, bonus_amount, label, is_active");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tiers: (data ?? []).map((r) => toTier(r as TierRow)) });
}
