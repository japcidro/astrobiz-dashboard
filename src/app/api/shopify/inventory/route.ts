import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type {
  InventoryProduct,
  InventoryRow,
  InventorySummary,
} from "@/lib/shopify/types";

export const dynamic = "force-dynamic";

const SHOPIFY_API_VERSION = "2024-01";

// In-memory cache — survives across requests while server is running
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface RawShopifyProduct {
  id: number;
  title: string;
  status: string;
  product_type: string;
  vendor: string;
  images: { src: string }[];
  variants: {
    id: number;
    title: string;
    sku: string | null;
    barcode: string | null;
    price: string;
    inventory_quantity: number;
    inventory_item_id: number;
    position: number;
  }[];
}

async function shopifyFetchProducts(
  storeUrl: string,
  apiToken: string
): Promise<RawShopifyProduct[]> {
  const allProducts: RawShopifyProduct[] = [];
  let url: string =
    `https://${storeUrl}/admin/api/${SHOPIFY_API_VERSION}/products.json?` +
    new URLSearchParams({
      status: "active",
      limit: "250",
      fields:
        "id,title,status,product_type,vendor,images,variants",
    });

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Shopify API error (${res.status}): ${text.slice(0, 200)}`
      );
    }
    const json = await res.json();
    allProducts.push(...(json.products || []));

    // Handle pagination via Link header
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : "";
  }
  return allProducts;
}

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "fulfillment"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const storeFilter = searchParams.get("store") || "ALL";
  const forceRefresh = searchParams.get("refresh") === "1";

  // Check cache first (ignore _t timestamp param for cache key)
  const cacheKey = `inventory-${storeFilter}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json({
      ...(cached.data as Record<string, unknown>),
      role: employee.role,
      cached: true,
    });
  }

  const supabase = await createClient();

  // Fetch active stores from shopify_stores table
  const { data: storesData, error: storesError } = await supabase
    .from("shopify_stores")
    .select("id, name, store_url, api_token")
    .eq("is_active", true);

  if (storesError || !storesData || storesData.length === 0) {
    return Response.json(
      {
        error: storesError
          ? "Failed to load stores"
          : "No active Shopify stores configured. Go to Settings.",
      },
      { status: 400 }
    );
  }

  // Filter to specific store if requested
  const targetStores =
    storeFilter === "ALL"
      ? storesData
      : storesData.filter((s) => s.id === storeFilter);

  if (targetStores.length === 0) {
    return Response.json({
      rows: [],
      products: [],
      summary: {
        total_products: 0,
        total_variants: 0,
        out_of_stock_count: 0,
        low_stock_count: 0,
        total_units: 0,
      } satisfies InventorySummary,
      stores: storesData.map((s) => ({ id: s.id, name: s.name })),
      productTypes: [],
      warnings: [],
      role: employee.role,
    });
  }

  const warnings: string[] = [];
  const allProducts: InventoryProduct[] = [];

  // Fetch products from all stores in parallel
  await Promise.all(
    targetStores.map(async (store) => {
      try {
        const rawProducts = await shopifyFetchProducts(
          store.store_url,
          store.api_token
        );

        for (const raw of rawProducts) {
          const totalInventory = (raw.variants || []).reduce(
            (sum, v) => sum + v.inventory_quantity,
            0
          );

          const product: InventoryProduct = {
            id: raw.id,
            title: raw.title,
            status: raw.status,
            product_type: raw.product_type || "",
            vendor: raw.vendor || "",
            image_url: raw.images?.[0]?.src || null,
            store_name: store.name,
            store_id: store.id,
            variants: (raw.variants || []).map((v) => ({
              id: v.id,
              title: v.title,
              sku: v.sku || null,
              barcode: v.barcode || null,
              price: v.price,
              inventory_quantity: v.inventory_quantity,
              inventory_item_id: v.inventory_item_id,
              position: v.position,
            })),
            total_inventory: totalInventory,
          };

          allProducts.push(product);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[Shopify] Failed to fetch products for store "${store.name}":`,
          message
        );
        warnings.push(`${store.name}: ${message}`);
      }
    })
  );

  // Flatten to InventoryRow[] (one row per variant)
  const allRows: InventoryRow[] = [];
  for (const product of allProducts) {
    for (const variant of product.variants) {
      const stock = variant.inventory_quantity;
      let stockStatus: "in_stock" | "low_stock" | "out_of_stock";
      if (stock === 0) {
        stockStatus = "out_of_stock";
      } else if (stock >= 1 && stock <= 9) {
        stockStatus = "low_stock";
      } else {
        stockStatus = "in_stock";
      }

      allRows.push({
        product_id: product.id,
        product_title: product.title,
        variant_id: variant.id,
        variant_title:
          variant.title === "Default Title" ? "Default" : variant.title,
        sku: variant.sku,
        barcode: variant.barcode,
        price: variant.price,
        stock,
        stock_status: stockStatus,
        store_name: product.store_name,
        store_id: product.store_id,
        product_type: product.product_type,
        vendor: product.vendor,
        image_url: product.image_url,
        status: product.status,
      });
    }
  }

  // Compute summary from all rows (before any client-side filtering)
  const summary: InventorySummary = {
    total_products: allProducts.length,
    total_variants: allRows.length,
    out_of_stock_count: allRows.filter(
      (r) => r.stock_status === "out_of_stock"
    ).length,
    low_stock_count: allRows.filter(
      (r) => r.stock_status === "low_stock"
    ).length,
    total_units: allRows.reduce((sum, r) => sum + r.stock, 0),
  };

  // Collect unique product types for filter dropdown
  const productTypes = [
    ...new Set(
      allProducts
        .map((p) => p.product_type)
        .filter((t) => t && t.trim() !== "")
    ),
  ].sort();

  // Sort rows by stock ascending (lowest first)
  allRows.sort((a, b) => a.stock - b.stock);

  const responseData = {
    rows: allRows,
    products: allProducts,
    summary,
    stores: storesData.map((s) => ({ id: s.id, name: s.name })),
    productTypes,
    warnings,
  };

  // Cache the response (without role — role is added per-request)
  cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

  return Response.json({ ...responseData, role: employee.role });
}
