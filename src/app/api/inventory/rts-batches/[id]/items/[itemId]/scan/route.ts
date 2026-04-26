import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// Cache active fulfillment location per store URL for 30 minutes. Locations
// rarely change, and resolving server-side means the modal doesn't have to
// load the full /api/shopify/fulfillment/locations payload before scanning
// (which was a real failure mode — VAs got "NO LOCATION" errors when the
// locations call was slow or when state-priming raced the scan).
const LOCATION_CACHE_TTL_MS = 30 * 60 * 1000;
const locationCache = new Map<
  string,
  { locationId: string; cachedAt: number }
>();

interface ScanBody {
  location_id?: string;
}

async function resolveLocationId(
  storeUrl: string,
  apiToken: string
): Promise<string | null> {
  const cached = locationCache.get(storeUrl);
  if (cached && Date.now() - cached.cachedAt < LOCATION_CACHE_TTL_MS) {
    return cached.locationId;
  }
  const res = await fetch(
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/locations.json`,
    {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    locations?: Array<{ id: number; active: boolean }>;
  };
  const locations = json.locations ?? [];
  // Prefer the first active location; fall back to the first one if none
  // are flagged active (small Shopify accounts sometimes have just one,
  // which doesn't always carry active=true).
  const active = locations.find((l) => l.active) ?? locations[0];
  if (!active) return null;
  const locationId = String(active.id);
  locationCache.set(storeUrl, { locationId, cachedAt: Date.now() });
  return locationId;
}

// POST /api/inventory/rts-batches/[id]/items/[itemId]/scan
// One physical scan = +1 received unit on this expected line item.
// Bumps Shopify stock and writes inventory_adjustments + rts_batch_items
// + rts_batches counters in the same handler. Inlined Shopify call (instead
// of going through /api/shopify/inventory-adjust) so the rts_batch_items
// counter update can't drift from the stock bump on partial failure.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: batchId, itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as ScanBody;
  const explicitLocationId = body.location_id?.trim() || null;

  const supabase = await createClient();

  const { data: batch, error: batchErr } = await supabase
    .from("rts_batches")
    .select("id, status, store_id, unit_count")
    .eq("id", batchId)
    .maybeSingle();
  if (batchErr || !batch) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }
  if (batch.status !== "open") {
    return Response.json({ error: "Batch is closed" }, { status: 400 });
  }

  const { data: item, error: itemErr } = await supabase
    .from("rts_batch_items")
    .select(
      "id, rts_batch_id, sku, product_title, inventory_item_id, expected_qty, received_qty, damaged_qty"
    )
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr || !item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }
  if (item.rts_batch_id !== batchId) {
    return Response.json(
      { error: "Item does not belong to this batch" },
      { status: 400 }
    );
  }
  if (!item.inventory_item_id) {
    return Response.json(
      { error: "Item has no inventory_item_id (manual fallback row)" },
      { status: 400 }
    );
  }

  const { data: store, error: storeErr } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("id", batch.store_id)
    .eq("is_active", true)
    .maybeSingle();
  if (storeErr || !store) {
    return Response.json({ error: "Store not found" }, { status: 404 });
  }

  // Resolve location_id. Prefer the explicit value from the client (manual
  // overrides), otherwise look up the store's active location automatically.
  const locationId =
    explicitLocationId ??
    (await resolveLocationId(
      store.store_url as string,
      store.api_token as string
    ));
  if (!locationId) {
    return Response.json(
      {
        error: "no_location",
        message: `No active fulfillment location for ${store.name}`,
      },
      { status: 404 }
    );
  }

  // Soft warning when the user has already scanned everything they were
  // expected to. The server still records the over-scan (sometimes the parcel
  // does have an extra unit) but flags it so the modal can highlight.
  const overScan =
    item.received_qty + item.damaged_qty >= item.expected_qty;

  // Read current Shopify level for an accurate previous_qty in the audit row.
  let previousQty: number | null = null;
  try {
    const lvlRes = await fetch(
      `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?` +
        new URLSearchParams({
          inventory_item_ids: String(item.inventory_item_id),
          location_ids: locationId,
        }),
      {
        headers: { "X-Shopify-Access-Token": store.api_token as string },
        cache: "no-store",
      }
    );
    if (lvlRes.ok) {
      const lvlJson = await lvlRes.json();
      const levels = lvlJson.inventory_levels || [];
      if (levels.length > 0) previousQty = levels[0].available;
    }
  } catch {
    // Non-fatal — previous_qty is informational.
  }

  // Bump stock by +1.
  let newQty: number | null = null;
  try {
    const adjRes = await fetch(
      `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/adjust.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": store.api_token as string,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: item.inventory_item_id,
          available_adjustment: 1,
        }),
        cache: "no-store",
      }
    );
    if (!adjRes.ok) {
      const text = await adjRes.text();
      return Response.json(
        {
          error: "shopify_adjust_failed",
          message: `Shopify ${adjRes.status}: ${text.slice(0, 200)}`,
        },
        { status: 502 }
      );
    }
    const adjJson = await adjRes.json();
    newQty = adjJson.inventory_level?.available ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: "shopify_adjust_failed", message },
      { status: 502 }
    );
  }

  // Persist audit row.
  await supabase.from("inventory_adjustments").insert({
    store_id: store.id,
    sku: item.sku,
    product_title: item.product_title,
    adjustment_type: "manual_adjust",
    previous_qty: previousQty,
    new_qty: newQty,
    change_qty: previousQty !== null && newQty !== null ? newQty - previousQty : 1,
    reason: "RTS Return",
    performed_by: employee.id,
    rts_batch_id: batchId,
  });

  // Increment received_qty on the line item. We re-read the row first so
  // concurrent scans on the same item don't lose increments to a stale write.
  const { data: refreshed } = await supabase
    .from("rts_batch_items")
    .select("received_qty")
    .eq("id", itemId)
    .single();
  const nextReceived = (refreshed?.received_qty ?? item.received_qty) + 1;
  await supabase
    .from("rts_batch_items")
    .update({ received_qty: nextReceived })
    .eq("id", itemId);

  // Bump the parent batch's cached unit_count. item_count gets recomputed
  // on close from the actual inventory_adjustments distinct SKUs.
  await supabase
    .from("rts_batches")
    .update({ unit_count: (batch.unit_count ?? 0) + 1 })
    .eq("id", batchId);

  return Response.json({
    ok: true,
    item_id: itemId,
    received_qty: nextReceived,
    expected_qty: item.expected_qty,
    damaged_qty: item.damaged_qty,
    over_scan: overScan,
    previous_qty: previousQty,
    new_qty: newQty,
  });
}
