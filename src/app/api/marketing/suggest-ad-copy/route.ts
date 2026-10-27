import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  prepareImage,
  suggestAdCopy,
  type SuggestContext,
} from "@/lib/ai/suggest-ad-copy";
import type { SuggestCopyLanguage } from "@/lib/marketing/store-defaults";
import { loadWinningCopy, type WinningCopy } from "@/lib/marketing/winning-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGES: SuggestCopyLanguage[] = ["taglish", "english", "tagalog"];

// A store's best-selling copy, kept for half an hour so a drop of twenty
// images reads it once: the promise is cached, so requests that arrive
// together share one load.
const winningCache = new Map<string, { at: number; winning: Promise<WinningCopy | null> }>();
const WINNING_TTL = 30 * 60 * 1000;

function winningCopy(db: SupabaseClient, storeName: string): Promise<WinningCopy | null> {
  const hit = winningCache.get(storeName);
  if (hit && Date.now() - hit.at < WINNING_TTL) return hit.winning;
  // The best sellers are a nice-to-have; the suggestion goes on without them.
  const winning = loadWinningCopy(db, storeName).catch(() => null);
  winningCache.set(storeName, { at: Date.now(), winning });
  return winning;
}

// POST multipart/form-data
//   image       the creative file (image/*)
//   store_id    shopify store uuid (optional: no store, no product facts)
//   language    taglish | english | tagalog
//   use_winners "1" to write to the bar of the store's best-selling ads
//   instruction free text: what to do differently (optional)
//   previous    JSON {primary_text, headline, description} being replaced (optional)
// → { suggestion } or { error }
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart form with an image" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return Response.json({ error: "Attach an image file" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return Response.json({ error: "Image is larger than 25 MB" }, { status: 400 });
  }
  const storeIdRaw = form.get("store_id");
  const storeId = typeof storeIdRaw === "string" && UUID.test(storeIdRaw) ? storeIdRaw : null;
  const langRaw = form.get("language");
  const language = LANGUAGES.includes(langRaw as SuggestCopyLanguage) ? (langRaw as SuggestCopyLanguage) : "taglish";
  const useWinners = form.get("use_winners") === "1";
  const instructionRaw = form.get("instruction");
  const instruction = typeof instructionRaw === "string" && instructionRaw.trim() ? instructionRaw.trim().slice(0, 400) : null;
  let previous: SuggestContext["previous"] = null;
  const previousRaw = form.get("previous");
  if (typeof previousRaw === "string" && previousRaw) {
    try {
      const p = JSON.parse(previousRaw) as Record<string, unknown>;
      previous = {
        primary_text: String(p.primary_text ?? "").slice(0, 1000),
        headline: String(p.headline ?? "").slice(0, 255),
        description: String(p.description ?? "").slice(0, 255),
      };
    } catch {
      previous = null;
    }
  }

  const supabase = await createClient();
  const { data: keyRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .maybeSingle();
  const apiKey = keyRow?.value as string | undefined;
  if (!apiKey) {
    return Response.json({ error: "Anthropic API key not configured. Go to Settings." }, { status: 400 });
  }

  // Gather what the store knows in parallel with shrinking the image.
  const db = createServiceClient();
  const imageP = prepareImage(Buffer.from(await file.arrayBuffer()), file.type);

  let storeName: string | null = null;
  let brandProfile: string | null = null;
  let brandRules: string | null = null;
  let defaultCopy: SuggestContext["defaultCopy"] = null;
  let presets: SuggestContext["presets"] = [];
  let winning: WinningCopy | null = null;

  if (storeId) {
    const [{ data: store }, { data: defaults }, { data: presetRows }] = await Promise.all([
      db.from("shopify_stores").select("name").eq("id", storeId).maybeSingle(),
      db
        .from("store_ad_defaults")
        .select("default_primary_text, default_headline, default_description")
        .eq("shopify_store_id", storeId)
        .maybeSingle(),
      db
        .from("ad_copy_presets")
        .select("kind, content")
        .eq("shopify_store_id", storeId)
        .in("kind", ["primary_text", "headline", "description"])
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    storeName = (store?.name as string | undefined) ?? null;
    if (defaults) {
      defaultCopy = {
        primary_text: (defaults.default_primary_text as string | null) ?? "",
        headline: (defaults.default_headline as string | null) ?? "",
        description: (defaults.default_description as string | null) ?? "",
      };
    }
    presets = ((presetRows ?? []) as Array<{ kind: string; content: string }>).filter((p) => p.content?.trim());
    if (storeName) {
      const [{ data: kit }, w] = await Promise.all([
        db.from("remake_brand_kits").select("profile, rules").eq("store", storeName).maybeSingle(),
        useWinners ? winningCopy(db, storeName) : Promise.resolve(null),
      ]);
      brandProfile = (kit?.profile as string | null) ?? null;
      brandRules = (kit?.rules as string | null) ?? null;
      winning = w;
    }
  }

  const image = await imageP;
  if (!image) return Response.json({ error: "Could not read this image" }, { status: 400 });

  const result = await suggestAdCopy(apiKey, image, {
    storeName,
    brandProfile,
    brandRules,
    defaultCopy,
    presets,
    winning,
    language,
    instruction,
    previous,
  });
  if (!result.suggestion) {
    return Response.json({ error: result.error ?? "Could not suggest copy" }, { status: 502 });
  }
  return Response.json({
    suggestion: result.suggestion,
    context: {
      store: storeName,
      brand_profile: !!brandProfile?.trim(),
      winners: winning?.ads ?? 0,
    },
  });
}
