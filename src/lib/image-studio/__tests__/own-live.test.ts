import { writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { planOwnAds, type BrandContext } from "../own";

/**
 * Live check of the "create your own" planner against the real Claude API,
 * with a page's real brand profile and pack description (no photos, so it
 * runs without Storage). Skipped unless OWN_ADS_LIVE names a store:
 *
 *   OWN_ADS_LIVE=FOLIQ OWN_ADS_OUT=/tmp/plan.json npx vitest run src/lib/image-studio/__tests__/own-live.test.ts
 */
const store = process.env.OWN_ADS_LIVE;

describe.skipIf(!store)("create your own: live plan", () => {
  it(
    "writes a varied plan from the page's profile",
    async () => {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        /* already loaded */
      }
      const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
      await client.connect();
      const key = (await client.query("select value from app_settings where key = 'anthropic_api_key'")).rows[0]?.value as string;
      const kit = (await client.query("select rules, profile from remake_brand_kits where store = $1", [store])).rows[0] as { rules: string; profile: string } | undefined;
      const spec = (await client.query("select pack_spec from remake_brand_images where store = $1 and pack_spec is not null order by (ad_use = 'main') desc nulls last, created_at limit 1", [store])).rows[0]?.pack_spec as string | undefined;
      await client.end();
      expect(key).toBeTruthy();
      // Only the API key is read through the client; everything else is passed in.
      const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: key } }) }) }) }) } as unknown as SupabaseClient;
      const pack = { id: "x", path: "x", kind: "bottle", description: null, pack_spec: spec ?? null, ad_use: "main", product: null };
      const ctx: BrandContext = { rules: kit?.rules ?? "", profile: kit?.profile ?? "", product: null, otherProducts: [], packRows: [pack], contentRows: [], packs: [{ row: pack, url: null, spec: spec ?? null }], contentUrl: null, productLock: spec ?? null, models: [] };
      const plan = await planOwnAds(db, ctx, { store: store!, brief: process.env.OWN_ADS_BRIEF ?? "", count: 4, avoid: [] });
      expect(plan).not.toBeNull();
      if (process.env.OWN_ADS_OUT) writeFileSync(process.env.OWN_ADS_OUT, JSON.stringify(plan, null, 2));
      expect(plan!.concepts.length).toBe(4);
      expect(new Set(plan!.concepts.map((c) => c.approach)).size).toBeGreaterThanOrEqual(3);
      for (const c of plan!.concepts) expect(c.headline.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(9);
    },
    300_000
  );
});
