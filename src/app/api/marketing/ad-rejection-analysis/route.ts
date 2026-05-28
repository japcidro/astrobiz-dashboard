import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { AD_REJECTION_SYSTEM_PROMPT } from "@/lib/ai/ad-rejection-spec";

export const dynamic = "force-dynamic";
// Claude Sonnet on a single transcript + policy list takes ~10–25s.
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4_000;

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: Record<string, number>;
}

interface PolicyInput {
  scope: string;
  policy: string;
  description: string;
}

// POST /api/marketing/ad-rejection-analysis
// body: { ad_id: string, policies: { scope, policy, description }[] }
//
// Runs Claude against the ad's transcript + the policy categories FB
// returned, producing a specific line-by-line inference of what
// triggered the rejection plus compliant rewrites. Labeled as AI
// inference (not Meta official) by the UI that consumes this.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ad_id?: string;
    policies?: PolicyInput[];
  };
  if (!body.ad_id) {
    return Response.json({ error: "ad_id required" }, { status: 400 });
  }
  const policies = body.policies ?? [];

  const supabase = await createClient();

  // 1. Pull the captured Gemini transcript for this ad.
  const { data: analysisRow } = await supabase
    .from("ad_creative_analyses")
    .select("analysis")
    .eq("ad_id", body.ad_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const transcript =
    (analysisRow?.analysis as { transcript?: string } | null)?.transcript ?? "";

  if (!transcript || !transcript.trim()) {
    return Response.json(
      {
        error:
          "No transcript captured for this ad yet. Click 'Deconstruct now' on the ad first, then come back to this analyzer.",
        no_transcript: true,
      },
      { status: 404 }
    );
  }

  // 2. Anthropic key
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

  // 3. Build user message
  const policyBlock =
    policies.length === 0
      ? "(Meta returned a DISAPPROVED status but no specific policy category. Treat as 'unspecified Health/Wellness or Misleading Claims' and analyze accordingly.)"
      : policies
          .map(
            (p, i) =>
              `${i + 1}. [${p.scope}] ${p.policy}\n   Meta description: ${p.description}`
          )
          .join("\n");

  const userMessage = `META POLICIES RETURNED:
${policyBlock}

AD TRANSCRIPT (verbatim, original language):
---
${transcript.trim()}
---

Produce the analysis per your spec. Most-likely triggers first.`;

  // 4. Call Claude
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
          text: AD_REJECTION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
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

  return Response.json({
    ad_id: body.ad_id,
    markdown,
    model: MODEL,
    tokens_used: json.usage ?? null,
  });
}
