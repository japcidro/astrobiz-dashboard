import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

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

  const supabase = await createClient();

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
      reason: reason || null,
      performed_by: employee.id,
    });

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
