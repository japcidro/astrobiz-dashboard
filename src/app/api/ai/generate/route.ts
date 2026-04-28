import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { DEFAULT_PROMPTS } from "@/lib/ai/default-prompts";
import { loadWinnersContext } from "@/lib/ai/winners-context";
import { TOOL_BY_TYPE } from "@/lib/ai/tools/generators";
import type {
  EmittedAnglesBatch,
  EmittedFormatsBatch,
  EmittedScriptsBatch,
} from "@/lib/ai/tools/generators";
import {
  validateAngleBatch,
  validateScriptBatch,
} from "@/lib/ai/validators/variation-gate";
import {
  renderAnglesMarkdown,
  renderFormatsMarkdown,
  renderScriptsMarkdown,
} from "@/lib/ai/structured-render";

export const dynamic = "force-dynamic";

type ToolType = "angles" | "scripts" | "formats";

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
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

const TOOL_TO_SYSTEM_DOC: Record<ToolType, string> = {
  angles: "system_angle_generator",
  scripts: "system_script_creator",
  formats: "system_format_expansion",
};

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, tool_type, messages } = body as {
    store_name: string;
    tool_type?: string;
    messages: ClientMessage[];
  };

  if (!store_name || !messages || messages.length === 0) {
    return Response.json(
      { error: "store_name and messages are required" },
      { status: 400 }
    );
  }

  const resolvedTool: ToolType =
    tool_type === "scripts" || tool_type === "formats" ? tool_type : "angles";
  const systemDocType = TOOL_TO_SYSTEM_DOC[resolvedTool];

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

  const { data: docs, error: docsError } = await supabase
    .from("ai_store_docs")
    .select("*")
    .eq("store_name", store_name);
  if (docsError) {
    return Response.json({ error: docsError.message }, { status: 500 });
  }

  // System prompt resolution: per-store custom override → v2 default → fallback.
  const systemDoc = docs?.find((d) => d.doc_type === systemDocType);
  const knowledgeDocs = (docs || []).filter(
    (d) =>
      !d.doc_type.startsWith("system_") &&
      d.doc_type !== "validated_winners_dna"
  );
  const systemPromptContent =
    systemDoc?.content ||
    DEFAULT_PROMPTS[systemDocType] ||
    "You are a creative ad strategist and copywriter.";

  const knowledgeContext = knowledgeDocs
    .map((doc) => `=== ${doc.title} ===\n${doc.content}`)
    .join("\n\n");

  // Admin override: if validated_winners_dna doc has auto_managed=false,
  // use the admin-edited content directly. Otherwise fall back to the
  // live winners query (the cron-managed default path).
  const overrideDoc = (docs || []).find(
    (d) =>
      d.doc_type === "validated_winners_dna" &&
      (d as { metadata?: { auto_managed?: boolean } }).metadata?.auto_managed === false
  );
  const winners = overrideDoc
    ? {
        text: overrideDoc.content,
        winner_count: 0, // unknown — admin override
        winner_ids: [] as string[],
      }
    : await loadWinnersContext(supabase, store_name);

  const systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }> = [{ type: "text", text: systemPromptContent }];

  if (knowledgeContext) {
    systemBlocks.push({
      type: "text",
      text: `Here is all the knowledge about this product/brand:\n\n${knowledgeContext}`,
      cache_control: { type: "ephemeral" },
    });
  } else {
    systemBlocks[0].cache_control = { type: "ephemeral" };
  }

  if (winners) {
    systemBlocks.push({
      type: "text",
      text: winners.text,
      cache_control: { type: "ephemeral" },
    });
  }

  const tool = TOOL_BY_TYPE[resolvedTool];

  // Initial call — string-content messages from the client. Anthropic
  // accepts these; tool_choice forces the model to emit via the tool.
  const initialMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const initial = await callClaude(
    apiKey,
    systemBlocks,
    initialMessages,
    tool
  );
  if (!initial.ok || !initial.body) {
    return errorResponse(initial);
  }

  const initialToolUse = findToolUse(initial.body, tool.name);
  if (!initialToolUse) {
    // Model returned prose instead of a tool call. Surface a graceful error
    // so the UI can ask the user to retry — this should never happen with
    // tool_choice forcing the tool, but we never trust a remote API.
    const fallbackText = findText(initial.body);
    return Response.json({
      text: fallbackText || "(model returned no tool output)",
      structured: null,
      validation: null,
      model: MODEL,
      tokens_used: initial.body.usage,
      context: {
        used_default_prompt: !systemDoc,
        winner_count: winners?.winner_count ?? 0,
        winner_ids: winners?.winner_ids ?? [],
        tool_type: resolvedTool,
        forced_fallback: true,
      },
    });
  }

  let structured = initialToolUse.input as Record<string, unknown>;
  let activeToolUse = initialToolUse;
  let validation = runValidation(resolvedTool, structured);
  let retried = false;

  // Auto-retry once if the variation gate fails. Subsequent failures are
  // returned to the client with a warning but still surfaced — user gets to
  // see the un-validated batch rather than a hard error.
  if (!validation.ok && validation.feedback) {
    retried = true;
    const retryMessages = [
      ...initialMessages,
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool_use",
            id: activeToolUse.id,
            name: activeToolUse.name,
            input: activeToolUse.input,
          },
        ],
      },
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result",
            tool_use_id: activeToolUse.id ?? "tu_0",
            is_error: true,
            content: validation.feedback,
          },
        ],
      },
    ];

    const retry = await callClaude(apiKey, systemBlocks, retryMessages, tool);
    if (retry.ok && retry.body) {
      const retryToolUse = findToolUse(retry.body, tool.name);
      if (retryToolUse) {
        activeToolUse = retryToolUse;
        structured = retryToolUse.input as Record<string, unknown>;
        validation = runValidation(resolvedTool, structured);
      }
    }
  }

  // Render markdown for the existing chat UI + script-parser. Defensive on
  // shape — if the structured payload is malformed, we still surface what
  // we have rather than 500.
  let markdown = "";
  try {
    markdown = renderMarkdown(resolvedTool, structured);
  } catch {
    markdown = "(structured output could not be rendered)";
  }

  return Response.json({
    text: markdown,
    structured,
    validation: {
      ok: validation.ok,
      enforced: validation.enforced,
      reasons: validation.reasons,
      retried,
    },
    model: MODEL,
    tokens_used: initial.body.usage,
    context: {
      used_default_prompt: !systemDoc,
      winner_count: winners?.winner_count ?? 0,
      winner_ids: winners?.winner_ids ?? [],
      tool_type: resolvedTool,
      forced_fallback: false,
    },
  });
}

// ─── Helpers ───

async function callClaude(
  apiKey: string,
  systemBlocks: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>,
  messages: unknown[],
  tool: { name: string }
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
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name },
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

  return {
    ok: false,
    status: lastStatus,
    body: null,
    errorText: lastBody,
  };
}

function findToolUse(
  body: ClaudeResponse,
  expectedName: string
): ClaudeContentBlock | null {
  for (const block of body.content || []) {
    if (block.type === "tool_use" && block.name === expectedName) {
      return block;
    }
  }
  return null;
}

function findText(body: ClaudeResponse): string | null {
  for (const block of body.content || []) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return null;
}

function runValidation(toolType: ToolType, structured: Record<string, unknown>) {
  if (toolType === "angles") {
    const batch = structured as unknown as EmittedAnglesBatch;
    return validateAngleBatch(batch.angles ?? []);
  }
  if (toolType === "scripts") {
    const batch = structured as unknown as EmittedScriptsBatch;
    return validateScriptBatch(batch.scripts ?? []);
  }
  // formats — no variation gate (it's an expansion, not a divergent batch)
  return { ok: true, enforced: false, reasons: [], feedback: null, duplicate_indices: [] };
}

function renderMarkdown(
  toolType: ToolType,
  structured: Record<string, unknown>
): string {
  if (toolType === "angles") {
    return renderAnglesMarkdown(structured as unknown as EmittedAnglesBatch);
  }
  if (toolType === "scripts") {
    return renderScriptsMarkdown(structured as unknown as EmittedScriptsBatch);
  }
  return renderFormatsMarkdown(structured as unknown as EmittedFormatsBatch);
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
