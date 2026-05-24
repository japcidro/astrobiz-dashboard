import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { ILP_DECONSTRUCT_SYSTEM_PROMPT } from "@/lib/ai/ilp-deconstruct-spec";
import { parseDeconstruction } from "@/lib/ai/ilp-deconstruct-parser";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
// 8-zone Sonnet output is typically 10-20s. 300s gives plenty of room
// for occasional slow runs.
export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 12_000;
const MAX_SOURCE_CHARS = 50_000;

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: Record<string, number>;
}

// GET /api/marketing/deconstructor?limit=20  → history list
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(
    50,
    Math.max(1, parseInt(new URL(request.url).searchParams.get("limit") ?? "20", 10))
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ilp_deconstructions")
    .select(
      "id, ad_origin, ad_title, compliance_flags_count, model, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ history: data ?? [] });
}

// POST /api/marketing/deconstructor   body: { source_text, ad_title? }
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { source_text } = body as { source_text?: string; ad_title?: string };

  if (!source_text || typeof source_text !== "string" || !source_text.trim()) {
    return Response.json(
      { error: "source_text is required (paste the ad transcript)." },
      { status: 400 }
    );
  }
  if (source_text.length > MAX_SOURCE_CHARS) {
    return Response.json(
      {
        error: `source_text is too long (${source_text.length.toLocaleString()} chars > ${MAX_SOURCE_CHARS.toLocaleString()} cap).`,
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Load Anthropic key (same pattern as the other AI surfaces).
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

  // Call Claude
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
          content: `Here is the ad to deconstruct. Produce the 8-zone report per your spec.\n\n--- BEGIN AD ---\n${source_text.trim()}\n--- END AD ---`,
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
  const sourceHash = crypto
    .createHash("sha256")
    .update(source_text.trim())
    .digest("hex");

  const { data: saved, error: saveErr } = await supabase
    .from("ilp_deconstructions")
    .insert({
      employee_id: employee.id,
      source_text: source_text.trim(),
      source_text_hash: sourceHash,
      ad_origin: parsed.ad_origin,
      ad_title: parsed.ad_title,
      zones: parsed.zones,
      compliance_flags_count: parsed.compliance_flags_count,
      model: MODEL,
      tokens_used: json.usage ?? null,
    })
    .select("id")
    .single();

  if (saveErr) {
    return Response.json(
      {
        error: `Generated but failed to save: ${saveErr.message}`,
        markdown,
        zones: parsed.zones,
      },
      { status: 500 }
    );
  }

  return Response.json({
    id: saved.id,
    markdown,
    zones: parsed.zones,
    ad_origin: parsed.ad_origin,
    ad_title: parsed.ad_title,
    compliance_flags_count: parsed.compliance_flags_count,
    one_takeaway: parsed.one_takeaway,
    model: MODEL,
    tokens_used: json.usage ?? null,
  });
}
