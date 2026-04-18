import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
const BATCH_SIZE = 50;
const FETCH_TIMEOUT_MS = 7000;

// Lightweight endpoint — fetches FB creative data (preview link +
// thumbnail) for a list of ad IDs. Kept separate from /all-ads so
// slow creative joins don't time out the main data fetch.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const idsRaw = searchParams.get("ids") || "";
  const adIds = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  if (adIds.length === 0) {
    return Response.json({ creatives: {} });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json(
      { error: "Facebook token not configured" },
      { status: 400 }
    );
  }

  const token = tokenSetting.value as string;

  // FB's batched-by-ids endpoint: /?ids=id1,id2,...
  // Returns { id1: {...}, id2: {...} }
  type RawCreativeNode = {
    creative?: {
      effective_object_story_id?: string;
      thumbnail_url?: string;
    };
  };

  const results: Record<string, { preview_url: string | null; thumbnail_url: string | null }> = {};

  const batches: string[][] = [];
  for (let i = 0; i < adIds.length; i += BATCH_SIZE) {
    batches.push(adIds.slice(i, i + BATCH_SIZE));
  }

  await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        access_token: token,
        ids: batch.join(","),
        fields: "creative{effective_object_story_id,thumbnail_url}",
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`${FB_API_BASE}/?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          console.error(
            `[ad-creatives] batch fetch ${res.status}`,
            await res.text().catch(() => "")
          );
          return;
        }
        const json = (await res.json()) as Record<string, RawCreativeNode>;
        for (const [adId, node] of Object.entries(json)) {
          const storyId = node?.creative?.effective_object_story_id;
          const postUrl = storyId
            ? `https://www.facebook.com/${storyId.replace("_", "/posts/")}`
            : null;
          results[adId] = {
            preview_url: postUrl,
            thumbnail_url: node?.creative?.thumbnail_url || null,
          };
        }
      } catch (e) {
        console.error(
          "[ad-creatives] batch failed:",
          e instanceof Error ? e.message : e
        );
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return Response.json({ creatives: results });
}
