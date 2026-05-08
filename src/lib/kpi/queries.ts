import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/lib/types";
import type { KpiSnapshot, KpiTarget, KpiTileData } from "./types";

interface DashboardData {
  targets: KpiTarget[];
  snapshots: KpiSnapshot[];
  employees: Employee[];
  tiles: KpiTileData[];
  asOf: string;
}

/**
 * Loads the latest KPI snapshot per (kpi, scope, employee) and joins with
 * targets + employee names to produce the tile list. Returns empty values
 * for KPIs that have no snapshot yet (so the dashboard renders a sensible
 * placeholder before the cron has populated data).
 */
export async function loadKpiDashboard(asOfDate?: string): Promise<DashboardData> {
  const supabase = await createClient();
  const targetDate = asOfDate ?? new Date().toISOString().slice(0, 10);

  const [{ data: targets }, { data: employees }, { data: snapshots }] = await Promise.all([
    supabase
      .from("kpi_targets")
      .select("*")
      .eq("is_active", true)
      .order("segment")
      .order("kpi_key"),
    supabase
      .from("employees")
      .select("*")
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("kpi_daily_snapshots")
      .select("*")
      .lte("snapshot_date", targetDate)
      .order("snapshot_date", { ascending: false })
      .limit(1000),
  ]);

  const targetList = (targets ?? []) as KpiTarget[];
  const employeeList = (employees ?? []) as Employee[];
  const snapshotList = (snapshots ?? []) as KpiSnapshot[];
  const employeeById = new Map(employeeList.map((e) => [e.id, e]));

  // Pick the most recent snapshot per (kpi_key, scope, employee_id)
  const latestKey = (s: KpiSnapshot) =>
    `${s.kpi_key}|${s.scope}|${s.employee_id ?? "team"}`;
  const latest = new Map<string, KpiSnapshot>();
  for (const snap of snapshotList) {
    const k = latestKey(snap);
    if (!latest.has(k)) latest.set(k, snap);
  }

  const tiles: KpiTileData[] = [];
  for (const t of targetList) {
    if (t.scope === "individual") {
      // One tile per (kpi, employee in matching segment)
      const segmentRoles = segmentToRoles(t.segment);
      const relevantEmployees = employeeList.filter((e) => segmentRoles.includes(e.role));
      for (const emp of relevantEmployees) {
        const snap = latest.get(`${t.kpi_key}|individual|${emp.id}`);
        tiles.push(buildTile(t, snap, emp));
      }
    } else {
      const snap = latest.get(`${t.kpi_key}|${t.scope}|team`);
      tiles.push(buildTile(t, snap, null));
    }
  }

  return {
    targets: targetList,
    snapshots: snapshotList,
    employees: employeeList,
    tiles,
    asOf: targetDate,
  };

  function buildTile(
    target: KpiTarget,
    snap: KpiSnapshot | undefined,
    employee: Employee | null,
  ): KpiTileData {
    const empFromSnap = snap?.employee_id ? employeeById.get(snap.employee_id) : null;
    return {
      kpi_key: target.kpi_key,
      display_name: target.display_name,
      segment: target.segment,
      scope: target.scope,
      unit: target.unit,
      direction: target.direction,
      red_threshold: Number(target.red_threshold),
      green_threshold: Number(target.green_threshold),
      value: snap ? Number(snap.value) : null,
      status: snap ? snap.status : null,
      employee_id: employee?.id ?? snap?.employee_id ?? null,
      employee_name: employee?.full_name ?? empFromSnap?.full_name ?? null,
      raw_data: snap?.raw_data ?? null,
      snapshot_date: snap?.snapshot_date ?? null,
    };
  }
}

function segmentToRoles(segment: KpiTarget["segment"]): Employee["role"][] {
  switch (segment) {
    case "marketing":
      return ["marketing"];
    case "sales_va":
      return ["va"];
    case "fulfillment":
      return ["fulfillment"];
    default:
      return [];
  }
}
