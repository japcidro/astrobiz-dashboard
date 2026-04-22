// Action tools — these WRITE or TRIGGER side effects (Gemini API call,
// FB video download, DB upsert). Every action tool must:
//   1. Be explicitly allowlisted per role (admin-only default)
//   2. Enforce a per-session quota via ai_tool_calls count
//   3. Be idempotent where possible (re-running should be safe)
//
// Read-only tools live in marketing.ts / shopify.ts / etc.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdVideo } from "@/lib/facebook/video";
import { deconstructAdVideo } from "@/lib/gemini/deconstruct";
import { MAX_DECONSTRUCTIONS_PER_SESSION } from "./permissions";

// Keep freshness consistent with the main deconstruct route.
const STALE_AFTER_DAYS = 7;

async function getGeminiKey(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "gemini_api_key")
    .maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

async function countDeconstructionCalls(
  supabase: SupabaseClient,
  sessionId: string
): Promise<number> {
  const { count } = await supabase
    .from("ai_tool_calls")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("tool_name", "request_deconstruction")
    .eq("status", "ok");
  return count ?? 0;
}

// ─── request_deconstruction ───────────────────────────────────────────
// Kick off a creative deconstruction on the fly so the AI can fill in
// missing deconstructions when compiling winners. Idempotent — if the
// ad was already deconstructed within STALE_AFTER_DAYS, returns the
// cached row without burning a Gemini call.
export async function requestDeconstruction(
  input: { ad_id: string; account_id: string; force_refresh?: boolean },
  ctx: {
    supabase: SupabaseClient;
    fbToken: string;
    sessionId: string | null;
    employeeId: string;
  }
) {
  if (!input.ad_id || !input.account_id) {
    return { error: "ad_id and account_id are required" };
  }

  // Per-session quota (only enforced when we have a session_id; first
  // message of a new chat has none yet, which is fine — at worst it
  // gets 1 free deconstruction before the session is persisted).
  if (ctx.sessionId) {
    const used = await countDeconstructionCalls(ctx.supabase, ctx.sessionId);
    if (used >= MAX_DECONSTRUCTIONS_PER_SESSION) {
      return {
        error: `Session deconstruction quota reached (${used}/${MAX_DECONSTRUCTIONS_PER_SESSION}). Start a new chat to reset.`,
      };
    }
  }

  // Cached-and-fresh check (unless forced).
  if (!input.force_refresh) {
    const { data: cached } = await ctx.supabase
      .from("ad_creative_analyses")
      .select("*")
      .eq("ad_id", input.ad_id)
      .maybeSingle();
    if (cached) {
      const ageMs = Date.now() - new Date(cached.created_at).getTime();
      if (ageMs < STALE_AFTER_DAYS * 86400_000) {
        return {
          ad_id: input.ad_id,
          status: "cached",
          message:
            "Deconstruction already exists and is fresh — returning cached row instead of re-running Gemini.",
          analysis: cached.analysis,
          thumbnail_url: cached.thumbnail_url,
        };
      }
    }
  }

  const geminiKey = await getGeminiKey(ctx.supabase);
  if (!geminiKey) {
    return { error: "Gemini API key not configured. Admin → Settings." };
  }

  // 1. Resolve video URL
  let videoRef;
  try {
    videoRef = await resolveAdVideo(input.ad_id, ctx.fbToken, input.account_id);
  } catch (e) {
    return {
      error: `Could not resolve FB video: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }
  if (!videoRef.video_url) {
    return {
      ad_id: input.ad_id,
      status: "no_video",
      note: videoRef.source_note || "No playable video on this ad.",
    };
  }

  // 2. Run Gemini
  let result;
  try {
    result = await deconstructAdVideo(videoRef.video_url, geminiKey);
  } catch (e) {
    return {
      error: `Gemini analysis failed: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  // 3. Upsert
  const row = {
    ad_id: input.ad_id,
    account_id: input.account_id,
    creative_id: videoRef.creative_id,
    video_id: videoRef.video_id,
    video_url: null as string | null,
    thumbnail_url: videoRef.thumbnail_url,
    analysis: result.analysis as unknown as Record<string, unknown>,
    analyzed_by: ctx.employeeId,
    trigger_source: "on_demand",
    model: result.model,
    tokens_used: result.tokens_used,
    cost_usd: null as number | null,
  };
  const { data: saved, error } = await ctx.supabase
    .from("ad_creative_analyses")
    .upsert(row, { onConflict: "ad_id" })
    .select("*")
    .single();

  if (error) {
    return { error: `DB upsert failed: ${error.message}` };
  }

  return {
    ad_id: input.ad_id,
    status: "deconstructed",
    analysis: saved.analysis,
    thumbnail_url: saved.thumbnail_url,
    model: saved.model,
    tokens_used: saved.tokens_used,
  };
}
