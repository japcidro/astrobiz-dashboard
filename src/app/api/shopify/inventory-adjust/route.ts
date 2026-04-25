import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { insertAlert } from "@/lib/alerts/insert";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

interface AdjustRequestBody {
  store_name: string;
  location_id: string;
  inventory_item_id: number;
  mode: "adjust" | "set";
  quantity: number;
  reason?: string;
  sku?: string;
  product_title?: string;
  // When set, this adjustment is part of an RTS batch. Forces
  // mode=adjust + quantity=1 (one scan = one unit), tags the
  // adjustment row, and suppresses the per-scan admin alert
  // (the batch-close handler emits one summary alert instead).
  rts_batch_id?: string;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as AdjustRequestBody;
  const {
    store_name,
    location_id,
    inventory_item_id,
    mode,
    quantity,
    reason,
    sku,
    product_title,
    rts_batch_id,
  } = body;

  if (!store_name || !location_id || !inventory_item_id || !mode) {
    return Response.json(
      { error: "store_name, location_id, inventory_item_id, and mode are required" },
      { status: 400 }
    );
  }

  if (mode !== "adjust" && mode !== "set") {
    return Response.json(
      { error: 'mode must be "adjust" or "set"' },
      { status: 400 }
    );
  }

  if (typeof quantity !== "number") {
    return Response.json(
      { error: "quantity must be a number" },
      { status: 400 }
    );
  }

  // RTS batch scans are strict scan-per-unit. Reject any client
  // that tries to inflate the quantity or use mode=set.
  if (rts_batch_id) {
    if (mode !== "adjust" || quantity !== 1) {
      return Response.json(
        { error: "RTS batch scans must be mode=adjust with quantity=1" },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();

  // If this scan belongs to an RTS batch, validate the batch is
  // open and the actor owns it (or is admin).
  let resolvedReason = reason;
  if (rts_batch_id) {
    const { data: batch, error: batchErr } = await supabase
      .from("rts_batches")
      .select("id, status, opened_by, store_id")
      .eq("id", rts_batch_id)
      .single();
    if (batchErr || !batch) {
      return Response.json({ error: "RTS batch not found" }, { status: 404 });
    }
    if (batch.status !== "open") {
      return Response.json(
        { error: "RTS batch is closed" },
        { status: 400 }
      );
    }
    if (employee.role !== "admin" && batch.opened_by !== employee.id) {
      return Response.json(
        { error: "Cannot scan into another user's batch" },
        { status: 403 }
      );
    }
    resolvedReason = "RTS Return";
  }

  // Get store credentials
  const { data: store, error: storeError } = await supabase
    .from("shopify_stores")
    .select("id, store_url, api_token")
    .eq("name", store_name)
    .eq("is_active", true)
    .single();

  if (storeError || !store) {
    return Response.json(
      { error: `Store "${store_name}" not found` },
      { status: 404 }
    );
  }

  // RTS scans must stay within the store the batch was opened against.
  if (rts_batch_id) {
    const { data: batchStore } = await supabase
      .from("rts_batches")
      .select("store_id")
      .eq("id", rts_batch_id)
      .single();
    if (batchStore && batchStore.store_id !== store.id) {
      return Response.json(
        { error: "Scanned item does not belong to this batch's store" },
        { status: 400 }
      );
    }
  }

  try {
    // Get current inventory level first (for logging previous_qty)
    const currentRes = await fetch(
      `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?` +
        new URLSearchParams({
          inventory_item_ids: String(inventory_item_id),
          location_ids: location_id,
        }),
      {
        headers: { "X-Shopify-Access-Token": store.api_token },
        cache: "no-store",
      }
    );

    let previousQty: number | null = null;
    if (currentRes.ok) {
      const currentJson = await currentRes.json();
      const levels = currentJson.inventory_levels || [];
      if (levels.length > 0) {
        previousQty = levels[0].available;
      }
    }

    // Perform the adjustment or set
    let apiUrl: string;
    let apiBody: Record<string, unknown>;

    if (mode === "adjust") {
      apiUrl = `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/adjust.json`;
      apiBody = {
        location_id,
        inventory_item_id,
        available_adjustment: quantity,
      };
    } else {
      apiUrl = `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`;
      apiBody = {
        location_id,
        inventory_item_id,
        available: quantity,
      };
    }

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": store.api_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(apiBody),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Shopify inventory ${mode} failed (${res.status}): ${text.slice(0, 300)}`
      );
    }

    const resJson = await res.json();
    const newQty: number = resJson.inventory_level?.available ?? null;

    // Log to inventory_adjustments table
    const adjustmentType =
      mode === "adjust" ? "manual_adjust" : "manual_set";
    const changeQty =
      previousQty !== null && newQty !== null
        ? newQty - previousQty
        : mode === "adjust"
          ? quantity
          : null;

    await supabase.from("inventory_adjustments").insert({
      store_id: store.id,
      sku: sku || null,
      product_title: product_title || null,
      adjustment_type: adjustmentType,
      previous_qty: previousQty,
      new_qty: newQty,
      change_qty: changeQty,
      reason: resolvedReason || null,
      performed_by: employee.id,
      rts_batch_id: rts_batch_id || null,
    });

    // Bump cached counters on the parent RTS batch. unit_count is
    // a running total of change_qty; item_count is the count of
    // distinct SKUs touched (recomputed on close to be exact).
    if (rts_batch_id && typeof changeQty === "number" && changeQty > 0) {
      const { data: existingScans } = await supabase
        .from("inventory_adjustments")
        .select("sku")
        .eq("rts_batch_id", rts_batch_id);
      const distinctSkus = new Set(
        (existingScans ?? [])
          .map((r) => (r.sku as string | null) ?? "")
          .filter((s) => s.length > 0)
      );
      const { data: batchRow } = await supabase
        .from("rts_batches")
        .select("unit_count")
        .eq("id", rts_batch_id)
        .single();
      const nextUnit = (batchRow?.unit_count ?? 0) + changeQty;
      await supabase
        .from("rts_batches")
        .update({
          item_count: distinctSkus.size,
          unit_count: nextUnit,
        })
        .eq("id", rts_batch_id);
    }

    // Notify admin when team members add stock (positive change only,
    // skip admin's own adjustments to avoid self-notifying). Per-scan
    // alerts are suppressed when the change is part of an RTS batch —
    // the batch-close handler emits a single summary alert instead.
    if (
      !rts_batch_id &&
      employee.role !== "admin" &&
      typeof changeQty === "number" &&
      changeQty > 0
    ) {
      const skuLabel = sku || product_title || "unknown SKU";
      const productLabel = product_title
        ? `${product_title}${sku ? ` (${sku})` : ""}`
        : sku || "unknown item";
      const newQtyText = newQty !== null ? ` New stock: ${newQty}.` : "";
      await insertAlert(supabase, {
        type: "stock_added_by_team",
        severity: "info",
        title: `Stock added: ${skuLabel} +${changeQty}`,
        body: `${employee.full_name} added ${changeQty} to ${productLabel} in ${store_name}.${newQtyText}${reason ? ` Reason: ${reason}.` : ""}`,
        resource_type: "sku",
        resource_id: sku || undefined,
        action_url: "/fulfillment/pick-pack/audit",
        payload: {
          store_name,
          store_id: store.id,
          sku: sku || null,
          product_title: product_title || null,
          previous_qty: previousQty,
          new_qty: newQty,
          change_qty: changeQty,
          reason: reason || null,
          performed_by: employee.id,
          performed_by_name: employee.full_name,
          performed_by_role: employee.role,
        },
        dedup_hours: 0,
      });
    }

    return Response.json({
      success: true,
      previous_qty: previousQty,
      new_qty: newQty,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Inventory Adjust]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
