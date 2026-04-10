import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { matchSenderToStore } from "@/lib/profit/store-matching";
import { classifyJtDelivery, getProvinceCutoff } from "@/lib/profit/province-tiers";
import type { JtClassification } from "@/lib/profit/types";

export const dynamic = "force-dynamic";

interface JtUploadRow {
  waybill: string;
  order_status: string;
  cod: number | string;
  province: string;
  submission_time: string;
  item_name: string;
  num_items: number | string;
  sender_name: string;
  total_shipping_cost: number | string;
  receiver: string;
  city: string;
  rts_reason: string;
  item_value: number | string;
  payment_method: string;
  signing_time: string;
}

function parseJtDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  // Handle Excel serial date numbers (e.g., 46113.5 = some date)
  if (typeof value === "number") {
    // Excel epoch is 1899-12-30
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(value).trim();
  if (!str || str === "NaN" || str === "--") return null;

  // Handle "2026-04-01 14:30:00" format
  const d = new Date(str.replace(" ", "T") + (str.includes("+") || str.includes("Z") ? "" : "+08:00"));
  if (!isNaN(d.getTime())) return d;

  // Fallback: try native Date parse
  const d2 = new Date(str);
  return isNaN(d2.getTime()) ? null : d2;
}

function computeDaysSinceSubmit(submissionTime: string | Date | null | undefined): number | null {
  const submitDate = parseJtDate(submissionTime);
  if (!submitDate) return null;

  const now = new Date();
  const diffMs = now.getTime() - submitDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const rows: JtUploadRow[] = body.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: "rows array is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Process each row
  const dbRows = [];
  const errors: string[] = [];
  const summary: Record<string, number> = {
    delivered: 0,
    returned: 0,
    in_transit: 0,
    for_return: 0,
    returned_aged: 0,
    pending: 0,
  };

  for (const row of rows) {
    try {
      // Skip rows without waybill
      const waybill = String(row.waybill || "").trim();
      if (!waybill) {
        errors.push("Skipped row with empty waybill");
        continue;
      }
      const storeName = matchSenderToStore(row.sender_name || "");
      const daysSinceSubmit = computeDaysSinceSubmit(row.submission_time);
      const province = (row.province || "").trim();
      const classification = classifyJtDelivery(
        row.order_status || "",
        daysSinceSubmit ?? 0,
        province
      );

      const tierCutoff = province ? getProvinceCutoff(province) : null;
      const isDelivered = classification === "Delivered";
      const isReturned =
        classification === "Returned" ||
        classification === "For Return" ||
        classification === "Returned (Aged)";

      // Extract submission date (date only) for filtering
      const submitParsed = parseJtDate(row.submission_time);
      const submissionDate = submitParsed
        ? submitParsed.toISOString()
        : null;

      const signingParsed = parseJtDate(row.signing_time);

      dbRows.push({
        waybill,
        order_status: row.order_status || "",
        classification,
        submission_date: submissionDate,
        signing_time: signingParsed ? signingParsed.toISOString() : null,
        receiver: row.receiver || null,
        province: province || null,
        city: row.city || null,
        cod_amount: parseFloat(String(row.cod || 0)) || 0,
        shipping_cost: parseFloat(String(row.total_shipping_cost || 0)) || 0,
        item_name: row.item_name || null,
        num_items: parseInt(String(row.num_items || 0)) || 0,
        item_value: parseFloat(String(row.item_value || 0)) || 0,
        store_name: storeName || null,
        payment_method: row.payment_method || null,
        rts_reason: row.rts_reason || null,
        days_since_submit: daysSinceSubmit,
        tier_cutoff: tierCutoff,
        is_delivered: isDelivered,
        is_returned: isReturned,
      });

      // Update summary
      const classKey = classificationToKey(classification);
      summary[classKey] = (summary[classKey] || 0) + 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`Waybill ${row.waybill}: ${msg}`);
    }
  }

  if (dbRows.length === 0) {
    return Response.json(
      { error: "No valid rows to insert", errors },
      { status: 400 }
    );
  }

  // Upsert in chunks of 50 to avoid timeout
  const CHUNK_SIZE = 50;
  let totalUpserted = 0;

  for (let i = 0; i < dbRows.length; i += CHUNK_SIZE) {
    const chunk = dbRows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("jt_deliveries")
      .upsert(chunk, { onConflict: "waybill", ignoreDuplicates: false });

    if (error) {
      return Response.json({
        error: `Chunk ${Math.floor(i / CHUNK_SIZE) + 1} failed: ${error.message}`,
        partial: { upserted: totalUpserted, total: dbRows.length },
      }, { status: 500 });
    }
    totalUpserted += chunk.length;
  }

  return Response.json({
    inserted: totalUpserted,
    updated: 0,
    total: dbRows.length,
    summary,
    errors,
  });
}

function classificationToKey(classification: JtClassification): string {
  switch (classification) {
    case "Delivered":
      return "delivered";
    case "Returned":
      return "returned";
    case "In Transit":
      return "in_transit";
    case "For Return":
      return "for_return";
    case "Returned (Aged)":
      return "returned_aged";
    case "Pending":
      return "pending";
    default:
      return "pending";
  }
}
