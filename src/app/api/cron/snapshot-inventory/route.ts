import { createServiceClient } from "@/lib/supabase/service";
import type { InventoryRow } from "@/lib/shopify/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Captures a daily snapshot of per-SKU inventory across all stores.
// Feeds the rule engine (stock_restocked_winner, stock_depleting_winner).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cronSecret = process.env.CRON_SECRET!;
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const startTime = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch(`${baseUrl}/api/shopify/inventory?store=ALL&refresh=1`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      return Response.json(
        { error: "Failed to fetch inventory", status: res.status, body: body.slice(0, 500) },
        { status: 500 }
      );
    }

    const payload = (await res.json()) as { rows: InventoryRow[] };
    const rows = payload.rows ?? [];

    if (rows.length === 0) {
      return Response.json({ success: true, inserted: 0, note: "no rows" });
    }

    // Upsert by (snapshot_date, store_name, sku, variant_id)
    const records = rows
      .filter((r) => r.sku || r.variant_id)
      .map((r) => ({
        snapshot_date: today,
        store_name: r.store_name,
        store_id: String(r.store_id),
        product_id: String(r.product_id),
        product_title: r.product_title,
        sku: r.sku,
        variant_id: String(r.variant_id),
        variant_title: r.variant_title,
        stock: r.stock,
      }));

    // Chunk to avoid payload limits
    const chunks: typeof records[] = [];
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      chunks.push(records.slice(i, i + chunkSize));
    }

    let inserted = 0;
    for (const chunk of chunks) {
      const { error, count } = await supabase
        .from("inventory_snapshots")
        .upsert(chunk, {
          onConflict: "snapshot_date,store_name,sku,variant_id",
          count: "exact",
        });
      if (error) {
        console.error("[snapshot-inventory] upsert error:", error.message);
        continue;
      }
      inserted += count ?? chunk.length;
    }

    // Prune snapshots older than 60 days (cap storage)
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await supabase
      .from("inventory_snapshots")
      .delete()
      .lt("snapshot_date", cutoff);

    return Response.json({
      success: true,
      inserted,
      total_rows: rows.length,
      duration_seconds: Math.round((Date.now() - startTime) / 1000),
    });
  } catch (err) {
    return Response.json(
      {
        error: "Snapshot failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 }
    );
  }
}
