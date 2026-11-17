import { writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { loadPageEvidence } from "../evidence";
import { planOwnAds, type BrandContext } from "../own";

/**
 * Live check of the "create your own" planner against the real Facebook,
 * Gemini and Claude APIs: reads the page's winners (and watches winning
 * videos nobody has analysed yet, saving the analysis like the app does),
 * then writes a plan from the page's real profile and pack description
 * (no pack photos, so it runs without Storage). Skipped unless OWN_ADS_LIVE
 * names a store:
 *
 *   OWN_ADS_LIVE=FOLIQ OWN_ADS_OUT=/tmp/plan.json npx vitest run src/lib/image-studio/__tests__/own-live.test.ts
 */
const store = process.env.OWN_ADS_LIVE;

/** The few Supabase calls the evidence loader and the Claude helper make, answered from Postgres. */
function pgClient(client: pg.Client): SupabaseClient {
  const from = (table: string) => {
    let cols = "*";
    const where: string[] = [];
    const args: unknown[] = [];
    const run = async () => ({ data: (await client.query(`select ${cols} from ${table}${where.length ? ` where ${where.join(" and ")}` : ""}`, args)).rows, error: null });
    const q = {
      select: (c: string) => {
        cols = c;
        return q;
      },
      eq: (c: string, v: unknown) => {
        args.push(v);
        where.push(`${c} = $${args.length}`);
        return q;
      },
      in: (c: string, v: unknown[]) => {
        args.push(v);
        where.push(`${c} = any($${args.length})`);
        return q;
      },
      maybeSingle: async () => ({ data: (await run()).data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad),
      upsert: async (row: Record<string, unknown>, opts: { onConflict: string }) => {
        const keys = Object.keys(row);
        const sets = keys.filter((k) => k !== opts.onConflict).map((k) => `${k} = excluded.${k}`);
        await client.query(
          `insert into ${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) on conflict (${opts.onConflict}) do update set ${sets.join(",")}`,
          keys.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]))
        );
        return { error: null };
      },
    };
    return q;
  };
  const rpc = async (fn: string, params: Record<string, unknown> = {}) => {
    const keys = Object.keys(params);
    const res = await client.query(`select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")})`, keys.map((k) => params[k]));
    return { data: res.rows, error: null };
  };
  return { from, rpc } as unknown as SupabaseClient;
}

describe.skipIf(!store)("create your own: live plan", () => {
  it(
    "reads the page's winners and writes a varied plan on them",
    async () => {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        /* already loaded */
      }
      const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
      await client.connect();
      const db = pgClient(client);
      const kit = (await client.query("select rules, profile from remake_brand_kits where store = $1", [store])).rows[0] as { rules: string; profile: string } | undefined;
      const spec = (await client.query("select pack_spec from remake_brand_images where store = $1 and pack_spec is not null order by (ad_use = 'main') desc nulls last, created_at limit 1", [store])).rows[0]?.pack_spec as string | undefined;

      const evidence = await loadPageEvidence(db, store!);
      if (process.env.OWN_ADS_OUT) writeFileSync(process.env.OWN_ADS_OUT.replace(/\.json$/, "-evidence.json"), JSON.stringify(evidence, null, 2));

      const pack = { id: "x", path: "x", kind: "bottle", description: null, pack_spec: spec ?? null, ad_use: "main", product: null };
      const ctx: BrandContext = { rules: kit?.rules ?? "", profile: kit?.profile ?? "", product: null, otherProducts: [], packRows: [pack], contentRows: [], packs: [{ row: pack, url: null, spec: spec ?? null }], contentUrl: null, productLock: spec ?? null, models: [] };
      const plan = await planOwnAds(db, ctx, { store: store!, brief: process.env.OWN_ADS_BRIEF ?? "", count: 4, avoid: [], evidence });
      await client.end();
      expect(plan).not.toBeNull();
      if (process.env.OWN_ADS_OUT) writeFileSync(process.env.OWN_ADS_OUT, JSON.stringify(plan, null, 2));
      expect(plan!.concepts.length).toBe(4);
      expect(new Set(plan!.concepts.map((c) => c.approach)).size).toBeGreaterThanOrEqual(3);
      for (const c of plan!.concepts) expect(c.headline.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(9);
      if (evidence?.winners.length) expect(plan!.concepts.some((c) => c.evidence && !/^new angle/i.test(c.evidence))).toBe(true);
    },
    420_000
  );
});
