import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  ILP_DECONSTRUCT_SYSTEM_PROMPT,
  DECONSTRUCT_ENGINE_VERSION,
} from "@/lib/ai/ilp-deconstruct-spec";
import { parseDeconstruction } from "@/lib/ai/ilp-deconstruct-parser";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 12_000;

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: Record<string, number>;
}

// POST /api/marketing/deconstructor/from-analysis
// body: { ad_id: string, ad_title?: string }
//
// Bridges the existing Gemini transcript pipeline (ad_creative_analyses)
// into the new ILP 8-zone format. Looks up the captured transcript for
// the given ad_id, dedupes against ilp_deconstructions by transcript
// hash so back-to-back clicks on the same ad don't re-bill Claude, and
// only runs a fresh Claude call when we've never seen this exact
// transcript before.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { ad_id, ad_title } = body as { ad_id?: string; ad_title?: string };
  if (!ad_id) {
    return Response.json({ error: "ad_id is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // 1. Pull the captured Gemini analysis for this ad.
  const { data: analysisRow } = await supabase
    .from("ad_creative_analyses")
    .select("analysis")
    .eq("ad_id", ad_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const transcript =
    (analysisRow?.analysis as { transcript?: string } | null)?.transcript ?? "";

  if (!transcript || !transcript.trim()) {
    return Response.json(
      {
        error:
          "No transcript captured for this ad yet. The auto-deconstruct cron will pick it up within 24h, or paste the transcript into /marketing/deconstructor directly.",
        no_transcript: true,
      },
      { status: 404 }
    );
  }

  const sourceText = transcript.trim();
  // Fold the engine version into the cache key so a prompt/spec change (e.g.
  // brand-aware GENERIC mode) invalidates stale ILP-framed results instead of
  // re-serving them.
  const sourceHash = crypto
    .createHash("sha256")
    .update(`${DECONSTRUCT_ENGINE_VERSION}\n${sourceText}`)
    .digest("hex");

  // 2. Have we already deconstructed this exact transcript? Return the
  //    cached result if so (instant + free).
  const { data: cached } = await supabase
    .from("ilp_deconstructions")
    .select(
      "id, zones, ad_origin, ad_title, compliance_flags_count, model, tokens_used, created_at"
    )
    .eq("source_text_hash", sourceHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return Response.json({
      id: cached.id,
      zones: cached.zones,
      ad_origin: cached.ad_origin,
      ad_title: cached.ad_title,
      compliance_flags_count: cached.compliance_flags_count,
      one_takeaway: null,
      model: cached.model,
      tokens_used: cached.tokens_used,
      cached: true,
    });
  }

  // 3. Cache miss — run Claude.
  const { data: keyRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();
  if (!keyRow?.value) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings." },
      { status: 400 }
    );
  }
  const apiKey = keyRow.value as string;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: ILP_DECONSTRUCT_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Here is the ad to deconstruct. Produce the 8-zone report per your spec.\n\n--- BEGIN AD ---\n${sourceText}\n--- END AD ---`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return Response.json(
      { error: `Claude API error (${res.status}): ${errText.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const json = (await res.json()) as ClaudeResponse;
  const markdown =
    json.content?.find((b) => b.type === "text" && b.text)?.text ?? "";
  if (!markdown) {
    return Response.json(
      { error: "Claude returned no text content" },
      { status: 502 }
    );
  }

  const parsed = parseDeconstruction(markdown);

  const { data: saved } = await supabase
    .from("ilp_deconstructions")
    .insert({
      employee_id: employee.id,
      source_text: sourceText,
      source_text_hash: sourceHash,
      ad_origin: parsed.ad_origin,
      ad_title: parsed.ad_title ?? ad_title ?? null,
      zones: parsed.zones,
      compliance_flags_count: parsed.compliance_flags_count,
      model: MODEL,
      tokens_used: json.usage ?? null,
    })
    .select("id")
    .single();

  return Response.json({
    id: saved?.id ?? null,
    zones: parsed.zones,
    ad_origin: parsed.ad_origin,
    ad_title: parsed.ad_title ?? ad_title ?? null,
    compliance_flags_count: parsed.compliance_flags_count,
    one_takeaway: parsed.one_takeaway,
    model: MODEL,
    tokens_used: json.usage ?? null,
    cached: false,
  });
}
