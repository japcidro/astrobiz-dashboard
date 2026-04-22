import { useCallback, useEffect, useState } from "react";
import type { CTAType } from "@/lib/facebook/types";

// ─── Types ───

export interface StoreInfo {
  id: string;
  name: string;
  store_url: string;
  is_active: boolean;
}

export interface StoreAdDefaults {
  id: string;
  shopify_store_id: string;
  ad_account_id: string | null;
  page_id: string | null;
  page_name: string | null;
  pixel_id: string | null;
  website_url: string | null;
  url_parameters: string | null;
  default_cta: CTAType | null;
  default_daily_budget: number | null;
  default_countries: string[];
  default_age_min: number | null;
  default_age_max: number | null;
  campaign_name_pattern: string | null;
  adset_name_pattern: string | null;
  ad_name_pattern: string | null;
}

export interface StoreWithDefaults extends StoreInfo {
  store_ad_defaults: StoreAdDefaults | StoreAdDefaults[] | null;
}

// ─── Name-pattern tokens ───
// {store} {date} {angle} {script_number} {creative_type}

export interface NamePatternContext {
  store?: string;
  date?: string;
  angle?: string;
  script_number?: string | number;
  creative_type?: string;
}

export function resolveNamePattern(
  pattern: string | null | undefined,
  ctx: NamePatternContext
): string {
  if (!pattern) return "";
  return pattern
    .replace(/\{store\}/g, ctx.store ?? "")
    .replace(/\{date\}/g, ctx.date ?? new Date().toISOString().split("T")[0])
    .replace(/\{angle\}/g, ctx.angle ?? "")
    .replace(/\{script_number\}/g, String(ctx.script_number ?? ""))
    .replace(/\{creative_type\}/g, ctx.creative_type ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// Supabase's nested select returns the child as an object when the FK is
// unique, but types can widen to array. Normalize to single-or-null.
export function unwrapStoreDefaults(
  raw: StoreAdDefaults | StoreAdDefaults[] | null | undefined
): StoreAdDefaults | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

// ─── Hook ───
//
// Fetches the full list of active stores with their saved defaults joined.
// Single round-trip — the wizard dropdown + autofill payload use the same data.

export function useStoreDefaults() {
  const [stores, setStores] = useState<StoreWithDefaults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/store-defaults");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load stores");
      setStores(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getDefaultsFor = useCallback(
    (storeId: string | null): StoreAdDefaults | null => {
      if (!storeId) return null;
      const store = stores.find((s) => s.id === storeId);
      if (!store) return null;
      return unwrapStoreDefaults(store.store_ad_defaults);
    },
    [stores]
  );

  const saveDefaults = useCallback(
    async (payload: Partial<StoreAdDefaults> & { shopify_store_id: string }) => {
      const res = await fetch("/api/marketing/store-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save defaults");
      await refresh();
      return json.data as StoreAdDefaults;
    },
    [refresh]
  );

  return { stores, loading, error, refresh, getDefaultsFor, saveDefaults };
}
