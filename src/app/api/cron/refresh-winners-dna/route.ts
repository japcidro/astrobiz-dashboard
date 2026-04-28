// Daily cron — rebuild the `validated_winners_dna` ai_store_docs row per
// store from the latest validated-winner approved_scripts. The generator
// reads this row dynamically, so refreshing it daily keeps the smartness
// up to date without touching the runtime path.
//
// Honors admin overrides: rows where metadata.auto_managed is explicitly
// set to false are NEVER overwritten (admin took ownership). Rows with
// no metadata or metadata.auto_managed=true are managed by this cron.

import { createServiceClient } from "@/lib/supabase/service";
import { loadWinnersContext } from "@/lib/ai/winners-context";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DOC_TYPE = "validated_winners_dna";

interface StoreRow {
  store_name: string;
}

interface ExistingDocRow {
  id: string;
  metadata: { auto_managed?: boolean } | null;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();

  // 1. List every distinct store with at least one validated-winner script.
  //    We use the script-level marker (not deconstruction-level) because the
  //    cron can only emit a winners doc for stores that have v2-classified
  //    winners in approved_scripts.
  const { data: storeRows, error: storesErr } = await supabase
    .from("approved_scripts")
    .select("store_name")
    .eq("performance_status", "validated_winner")
    .order("store_name", { ascending: true });

  if (storesErr) {
    return Response.json(
      { error: `Failed to list stores: ${storesErr.message}`, refreshed: 0 },
      { status: 500 }
    );
  }

  const stores = Array.from(
    new Set(((storeRows || []) as StoreRow[]).map((r) => r.store_name))
  );

  if (stores.length === 0) {
    return Response.json({
      stores_with_winners: 0,
      refreshed: 0,
      skipped_admin_override: 0,
      elapsed_seconds: parseFloat(((Date.now() - startedAt) / 1000).toFixed(1)),
    });
  }

  let refreshed = 0;
  let skippedOverride = 0;
  let cleared = 0;
  const errors: string[] = [];

  for (const store of stores) {
    try {
      // Skip stores whose validated_winners_dna row was taken over by an admin.
      const { data: existingRows } = await supabase
        .from("ai_store_docs")
        .select("id, metadata")
        .eq("store_name", store)
        .eq("doc_type", DOC_TYPE)
        .limit(1);

      const existing =
        (existingRows && (existingRows[0] as ExistingDocRow)) || null;
      if (existing && existing.metadata?.auto_managed === false) {
        skippedOverride += 1;
        continue;
      }

      const ctx = await loadWinnersContext(supabase, store);

      // No qualifying winners (e.g., all stale / no v2 deconstruction yet) →
      // clear the doc by writing an empty placeholder. Keeps the row in the
      // store so the UI shows "0 validated winners — last refreshed today".
      const content =
        ctx?.text ??
        "## VALIDATED WINNERS\n_(No validated winners with v2.0 deconstruction in the last 45 days.)_";
      const winnerIds = ctx?.winner_ids ?? [];

      const { error: upsertErr } = await supabase
        .from("ai_store_docs")
        .upsert(
          {
            store_name: store,
            doc_type: DOC_TYPE,
            title: "Validated Winners DNA (auto-managed)",
            content,
            metadata: {
              auto_managed: true,
              generated_at: new Date().toISOString(),
              source_winner_ids: winnerIds,
              winner_count: ctx?.winner_count ?? 0,
            },
          },
          { onConflict: "store_name,doc_type" }
        );
      if (upsertErr) {
        errors.push(`${store}: ${upsertErr.message}`);
        continue;
      }

      if (ctx) refreshed += 1;
      else cleared += 1;
    } catch (err) {
      errors.push(
        `${store}: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  const elapsedSec = parseFloat(((Date.now() - startedAt) / 1000).toFixed(1));
  console.info(
    `[cron/refresh-winners-dna] stores=${stores.length} refreshed=${refreshed} cleared=${cleared} overrides=${skippedOverride} errors=${errors.length} elapsed=${elapsedSec}s`
  );

  return Response.json({
    stores_with_winners: stores.length,
    refreshed,
    cleared,
    skipped_admin_override: skippedOverride,
    elapsed_seconds: elapsedSec,
    errors,
  });
}
