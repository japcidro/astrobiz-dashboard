import { createServiceClient } from "@/lib/supabase/service";

const cache = new Map<string, { value: string | null; at: number }>();
const TTL_MS = 60_000;

export async function injectBrandDNA(
  storeName: string | null | undefined,
  basePrompt: string
): Promise<string> {
  if (!storeName) return basePrompt;
  const base = basePrompt || "";

  const cached = cache.get(storeName);
  let modifier: string | null;
  if (cached && Date.now() - cached.at < TTL_MS) {
    modifier = cached.value;
  } else {
    try {
      const admin = createServiceClient();
      const { data } = await admin
        .from("shopify_stores")
        .select("prompt_modifier")
        .eq("name", storeName)
        .single();
      modifier = ((data?.prompt_modifier as string | null) || "").trim() || null;
    } catch {
      modifier = null;
    }
    cache.set(storeName, { value: modifier, at: Date.now() });
  }

  if (!modifier) return base;
  return `${modifier}\n\n${base}`.trim();
}
