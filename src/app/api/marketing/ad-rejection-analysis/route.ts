import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { AD_REJECTION_SYSTEM_PROMPT } from "@/lib/ai/ad-rejection-spec";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
// Claude Sonnet on a single transcript + policy list takes ~10–25s.
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4_000;

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Canonicalize policies for hashing so reorderings / FB description
// whitespace tweaks don't bust the cache unnecessarily.
function hashPolicies(policies: PolicyInput[]): string {
  const canonical = policies
    .map((p) => ({
      scope: (p.scope ?? "").trim(),
      policy: (p.policy ?? "").trim(),
      description: (p.description ?? "").trim(),
    }))
    .sort((a, b) =>
      `${a.scope}|${a.policy}`.localeCompare(`${b.scope}|${b.policy}`)
    );
  return sha256(JSON.stringify(canonical));
}

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
    // force=true bypasses the cache and re-runs Claude. Used by the
    // 'Re-run' link inside the modal.
    force?: boolean;
    // check_only=true returns the cached result if one exists and a 404
    // (not_cached: true) otherwise. NEVER fires Claude. Used by the
    // modal to surface a prior analysis on open without re-billing.
    check_only?: boolean;
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

  // 1b. Cache lookup. Re-runs against the same (ad, transcript, policy
  // set) are instant + free — same hash, return the stored markdown.
  // Forced re-runs from the UI pass `force=true` to bypass.
  const transcriptHash = sha256(transcript.trim());
  const policiesHash = hashPolicies(policies);
  const force = body.force === true;

  if (!force) {
    const { data: cached } = await supabase
      .from("ad_rejection_inferences")
      .select("markdown, model, tokens_used, created_at")
      .eq("ad_id", body.ad_id)
      .eq("transcript_hash", transcriptHash)
      .eq("policies_hash", policiesHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached) {
      return Response.json({
        ad_id: body.ad_id,
        markdown: cached.markdown,
        model: cached.model ?? MODEL,
        tokens_used: cached.tokens_used ?? null,
        cached: true,
        cached_at: cached.created_at,
      });
    }
    // check_only: never fire Claude. The modal uses this on open to
    // surface a prior cached analysis without re-billing the user.
    if (body.check_only) {
      return Response.json(
        {
          not_cached: true,
          error: "No cached analysis for this ad + transcript + policy set.",
        },
        { status: 404 }
      );
    }
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

  // Write-through cache so the next click on this same ad is free.
  // upsert on the unique (ad_id, transcript_hash, policies_hash) key —
  // a force=true re-run replaces the prior cached markdown rather than
  // accumulating duplicates.
  await supabase
    .from("ad_rejection_inferences")
    .upsert(
      {
        ad_id: body.ad_id,
        transcript_hash: transcriptHash,
        policies_hash: policiesHash,
        markdown,
        model: MODEL,
        tokens_used: json.usage ?? null,
        employee_id: employee.id,
      },
      { onConflict: "ad_id,transcript_hash,policies_hash" }
    );

  return Response.json({
    ad_id: body.ad_id,
    markdown,
    model: MODEL,
    tokens_used: json.usage ?? null,
    cached: false,
  });
}
