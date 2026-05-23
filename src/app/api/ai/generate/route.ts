import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeResponse {
  content: ClaudeContentBlock[];
  usage?: Record<string, number>;
  stop_reason?: string;
}

interface ClaudeApiResult {
  ok: boolean;
  status: number;
  body: ClaudeResponse | null;
  errorText: string;
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16384;
const TRANSPORT_RETRIES = 3;

const DEFAULT_SYSTEM_PROMPT =
  "You are a creative ad strategist and copywriter helping the user adapt and write ad scripts for their brand. " +
  "Match the brand voice and reference materials provided. " +
  "Be concrete and specific — never give generic advice.";

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, messages } = body as {
    store_name?: string;
    messages?: ClientMessage[];
  };

  if (!store_name || !messages || messages.length === 0) {
    return Response.json(
      { error: "store_name and messages are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: settingRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (!settingRow?.value) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings." },
      { status: 400 }
    );
  }
  const apiKey = settingRow.value as string;

  // Per-brand system prompt (one row per store, may be missing → use default)
  const { data: promptRow } = await supabase
    .from("brand_system_prompts")
    .select("system_prompt")
    .eq("store_name", store_name)
    .maybeSingle();

  const systemPromptContent =
    promptRow?.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  // Per-brand reference files — concat extracted_text, ordered oldest-first.
  // Category is no longer surfaced to the model (the upload UX dropped it
  // entirely); titles alone are enough labels for the AI.
  const { data: files, error: filesErr } = await supabase
    .from("brand_reference_files")
    .select("title, extracted_text")
    .eq("store_name", store_name)
    .order("created_at", { ascending: true });

  if (filesErr) {
    return Response.json({ error: filesErr.message }, { status: 500 });
  }

  const referenceContext = (files ?? [])
    .map((f) => `=== ${f.title} ===\n${f.extracted_text}`)
    .join("\n\n");

  const systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [{ type: "text", text: systemPromptContent }];

  if (referenceContext) {
    systemBlocks.push({
      type: "text",
      text: `Reference materials for this brand:\n\n${referenceContext}`,
      cache_control: { type: "ephemeral" },
    });
  } else {
    systemBlocks[0].cache_control = { type: "ephemeral" };
  }

  const result = await callClaude(apiKey, systemBlocks, messages);
  if (!result.ok || !result.body) {
    return errorResponse(result);
  }

  const text = findText(result.body) ?? "(model returned no text)";

  return Response.json({
    text,
    model: MODEL,
    tokens_used: result.body.usage,
    context: {
      file_count: files?.length ?? 0,
      has_custom_system_prompt: !!promptRow?.system_prompt?.trim(),
    },
  });
}

async function callClaude(
  apiKey: string,
  systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>,
  messages: ClientMessage[]
): Promise<ClaudeApiResult> {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < TRANSPORT_RETRIES; attempt++) {
    try {
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
          system: systemBlocks,
          messages,
        }),
      });

      if (res.ok) {
        const json = (await res.json()) as ClaudeResponse;
        return { ok: true, status: res.status, body: json, errorText: "" };
      }

      lastStatus = res.status;
      lastBody = await res.text();

      const retryable = lastStatus === 429 || lastStatus >= 500;
      if (!retryable || attempt === TRANSPORT_RETRIES - 1) break;

      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : 0;
      const backoffMs = Math.max(
        retryAfterMs,
        1000 * 2 ** attempt + Math.floor(Math.random() * 500)
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    } catch (err) {
      if (attempt === TRANSPORT_RETRIES - 1) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          ok: false,
          status: 0,
          body: null,
          errorText: `Claude API call failed: ${message}`,
        };
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }

  return { ok: false, status: lastStatus, body: null, errorText: lastBody };
}

function findText(body: ClaudeResponse): string | null {
  for (const block of body.content || []) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return null;
}

function errorResponse(result: ClaudeApiResult): Response {
  if (result.status === 429) {
    return Response.json(
      { error: "Rate limited by Claude API. Please try again in a moment." },
      { status: 429 }
    );
  }
  if (result.status === 0) {
    return Response.json({ error: result.errorText }, { status: 500 });
  }
  return Response.json(
    { error: `Claude API error (${result.status}): ${result.errorText}` },
    { status: 502 }
  );
}
