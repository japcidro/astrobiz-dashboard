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

function parseJtDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const str = String(value).trim();
  if (!str) return null;

  // Handle "2026-04-01 14:30:00" format
  const d = new Date(str.replace(" ", "T") + (str.includes("+") || str.includes("Z") ? "" : "+08:00"));
  return isNaN(d.getTime()) ? null : d;
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
        waybill: row.waybill,
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

  const { data, error } = await supabase
    .from("jt_deliveries")
    .upsert(dbRows, { onConflict: "waybill" })
    .select("waybill");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    inserted: data?.length || 0,
    updated: 0, // Supabase upsert doesn't distinguish; total is accurate
    total: dbRows.length,
    summary,
    errors: errors.length > 0 ? errors : undefined,
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
