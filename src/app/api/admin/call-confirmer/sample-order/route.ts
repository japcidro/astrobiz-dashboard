import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import type { OrderContext } from "@/lib/call-confirmer/assistant";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

interface RawOrder {
  id: number;
  name: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string | null;
  gateway?: string;
  customer: {
    first_name?: string;
    last_name?: string;
    phone?: string | null;
  } | null;
  shipping_address: {
    first_name?: string;
    last_name?: string;
    address1?: string;
    address2?: string | null;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
  } | null;
  line_items: {
    title: string;
    variant_title: string | null;
    quantity: number;
  }[];
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "no phone on file";
  // Keep first 4 + last 2 digits, mask middle for display
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  return `${digits.slice(0, 4)}***${digits.slice(-2)}`;
}

function formatOrderContext(
  raw: RawOrder,
  storeName: string
): OrderContext {
  const customerName =
    [raw.customer?.first_name, raw.customer?.last_name]
      .filter(Boolean)
      .join(" ") ||
    [raw.shipping_address?.first_name, raw.shipping_address?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "Customer";

  // Send RAW Shopify data to Maria. The LLM (gpt-4o-mini) is responsible
  // for translating "1x Glow Up Patches (GLP1-patches)" → "isang Glow Up
  // Patches" and "990.00" → "nine hundred ninety" naturally during the call.
  // This is what we're paying OpenAI for — no manual pre-formatting.
  const items =
    raw.line_items
      .map((li) => {
        const variant =
          li.variant_title &&
          li.variant_title.toLowerCase() !== "default title"
            ? ` (${li.variant_title})`
            : "";
        return `${li.quantity}x ${li.title}${variant}`;
      })
      .join(", ") || "your order";

  const addr = raw.shipping_address;
  const addressParts = addr
    ? [addr.address1, addr.address2, addr.city, addr.province, addr.country]
        .filter(Boolean)
        .join(", ")
    : "your shipping address";

  const paymentMethod =
    raw.financial_status === "paid"
      ? "already paid online"
      : raw.gateway?.toLowerCase().includes("cash") ||
        raw.gateway?.toLowerCase().includes("cod") ||
        raw.financial_status === "pending"
      ? "Cash on Delivery"
      : raw.gateway || "Cash on Delivery";

  return {
    customer_name: customerName,
    order_name: raw.name,
    order_items: items,
    total: raw.total_price,
    address: addressParts,
    payment_method: paymentMethod,
    store_name: storeName,
  };
}

export async function GET(req: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const storeId = url.searchParams.get("store_id");
  if (!storeId) {
    return Response.json({ error: "store_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: store, error: storeErr } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("id", storeId)
    .maybeSingle();

  if (storeErr) return Response.json({ error: storeErr.message }, { status: 500 });
  if (!store)
    return Response.json({ error: "Store not found" }, { status: 404 });
  if (!store.api_token || !store.store_url) {
    return Response.json(
      { error: "Store not connected to Shopify yet" },
      { status: 400 }
    );
  }

  // Fetch recent orders — last 30 days, limit 50
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const shopifyUrl =
    `https://${store.store_url}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` +
    new URLSearchParams({
      status: "any",
      created_at_min: since.toISOString(),
      limit: "50",
      fields:
        "id,name,total_price,financial_status,fulfillment_status,gateway,customer,shipping_address,line_items",
    }).toString();

  const shopifyRes = await fetch(shopifyUrl, {
    headers: { "X-Shopify-Access-Token": store.api_token },
    cache: "no-store",
  });

  if (!shopifyRes.ok) {
    const text = await shopifyRes.text();
    return Response.json(
      {
        error: `Shopify error ${shopifyRes.status}: ${text.slice(0, 200)}`,
      },
      { status: 502 }
    );
  }

  const json = (await shopifyRes.json()) as { orders: RawOrder[] };
  const orders = json.orders ?? [];

  if (orders.length === 0) {
    // Fallback: synthetic sample using the store name
    return Response.json({
      order: {
        customer_name: "Juan Cruz",
        order_name: "#TEST-001",
        order_items: "1x Sample Product",
        total: "499.00",
        address: "123 Sample Street, Quezon City, Metro Manila, Philippines",
        payment_method: "Cash on Delivery",
        store_name: store.name,
      } satisfies OrderContext,
      source: "synthetic",
      reason: "No recent orders in Shopify for this store",
    });
  }

  // Pick a random order from the recent batch
  const picked = orders[Math.floor(Math.random() * orders.length)];
  const order = formatOrderContext(picked, store.name);

  return Response.json({
    order,
    source: "shopify",
    masked_customer_phone: maskPhone(picked.customer?.phone),
  });
}
