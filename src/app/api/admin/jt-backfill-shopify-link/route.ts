import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  buildTrackingToOrderMap,
  lookupOrderForWaybill,
} from "@/lib/shopify/tracking-to-order";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Retroactively populates shopify_order_id / _name / _date / _customer_email
// on rows in jt_deliveries that pre-date the upload-time matching logic.
//
// Strategy: walk all rows where shopify_order_id IS NULL, build a single
// tracking_number → Shopify order map covering the full submission_date
// range of those rows (capped at 90 days back so a runaway query doesn't
// hammer Shopify), then UPDATE each unmatched row in chunks.
//
// Admin-only. POST so curl/refresh in browser doesn't accidentally trigger.
//
// Usage:
//   curl -X POST -H "Cookie: ..." https://.../api/admin/jt-backfill-shopify-link
//
// Response:
//   { total, matched, unmatched, daysScanned }

const MAX_LOOKBACK_DAYS = 90;
const UPDATE_CHUNK = 100;

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";

  // 1. Find earliest unmatched submission_date so we know how far back to fetch
  //    Shopify orders. If everything is already matched, exit early.
  const { data: oldest } = await supabase
    .from("jt_deliveries")
    .select("submission_date")
    .is("shopify_order_id", null)
    .order("submission_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!oldest?.submission_date) {
    return Response.json({
      total: 0,
      matched: 0,
      unmatched: 0,
      daysScanned: 0,
      message: "No unmatched rows — nothing to backfill.",
    });
  }

  const oldestMs = new Date(oldest.submission_date).getTime();
  const ageDays = Math.ceil((Date.now() - oldestMs) / (1000 * 60 * 60 * 24));
  const daysScanned = Math.min(ageDays + 2, MAX_LOOKBACK_DAYS);

  // 2. Build the tracking map from Shopify orders covering that window.
  const trackingMap = await buildTrackingToOrderMap(supabase, daysScanned);

  if (trackingMap.size === 0) {
    return Response.json(
      {
        error: "Could not build Shopify order map (no orders fetched). Check Shopify store credentials.",
      },
      { status: 500 }
    );
  }

  // 3. Walk unmatched rows in pages and apply updates.
  let total = 0;
  let matched = 0;
  let pageOffset = 0;
  const PAGE_SIZE = 500;

  while (true) {
    const { data: rows, error: fetchErr } = await supabase
      .from("jt_deliveries")
      .select("waybill")
      .is("shopify_order_id", null)
      .order("submission_date", { ascending: true })
      .range(pageOffset, pageOffset + PAGE_SIZE - 1);

    if (fetchErr) {
      return Response.json(
        { error: `fetch failed at offset ${pageOffset}: ${fetchErr.message}` },
        { status: 500 }
      );
    }

    if (!rows || rows.length === 0) break;
    total += rows.length;

    // Group updates by destination so we can chunk them.
    const updates: Array<{
      waybill: string;
      shopify_order_id: string;
      shopify_order_name: string;
      shopify_order_date: string;
      shopify_customer_email: string | null;
    }> = [];

    for (const row of rows) {
      const m = lookupOrderForWaybill(trackingMap, row.waybill);
      if (!m) continue;
      matched++;
      updates.push({
        waybill: row.waybill,
        shopify_order_id: m.shopify_order_id,
        shopify_order_name: m.shopify_order_name,
        shopify_order_date: m.shopify_order_date,
        shopify_customer_email: m.shopify_customer_email,
      });
    }

    // Apply updates one waybill at a time within a chunk transaction, since
    // Supabase upsert(onConflict: "waybill") would otherwise need every
    // jt_deliveries column. Per-row update keeps the write surface tight.
    if (!dryRun) {
      for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
        const chunk = updates.slice(i, i + UPDATE_CHUNK);
        await Promise.all(
          chunk.map((u) =>
            supabase
              .from("jt_deliveries")
              .update({
                shopify_order_id: u.shopify_order_id,
                shopify_order_name: u.shopify_order_name,
                shopify_order_date: u.shopify_order_date,
                shopify_customer_email: u.shopify_customer_email,
              })
              .eq("waybill", u.waybill)
          )
        );
      }
    }

    if (rows.length < PAGE_SIZE) break;
    pageOffset += PAGE_SIZE;
  }

  return Response.json({
    total,
    matched,
    unmatched: total - matched,
    daysScanned,
    trackingMapSize: trackingMap.size,
    dryRun,
  });
}
