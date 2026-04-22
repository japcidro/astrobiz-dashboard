// Anthropic tool-use agent loop for the AI Analytics chat panel.
//
// Flow per user turn:
//   1. Call /v1/messages (non-streaming) with tools + messages.
//   2. If response has tool_use blocks → execute each handler
//      (in parallel when safe), append tool_result blocks, call again.
//   3. Repeat up to MAX_TOOL_ITERATIONS.
//   4. On the final turn where the model returns text-only, re-issue the
//      same call with stream=true and pipe the SSE out to the client.
//
// The client sees a single SSE stream with two kinds of events:
//   - `event: tool_call`  → {id, name, input}   (emitted before tool runs)
//   - `event: tool_result`→ {id, name, preview, duration_ms, status}
//   - Standard Anthropic streaming frames (content_block_delta etc.)
//
// Cost is tracked after each Anthropic call and the loop refuses to
// start another iteration once SESSION_COST_CAP_USD is breached.

import {
  MAX_TOOL_ITERATIONS,
  SESSION_COST_CAP_USD,
  SESSION_COST_SOFT_WARN_USD,
  estimateCostUsd,
} from "./tools/permissions";
import type { ToolContext, ToolDefinition } from "./tools/registry";

// Sonnet 4.6 is 5× cheaper than Opus ($3/$15 vs $15/$75 per MTok) and plenty
// capable for tool-use + compilation chat. Opus stays reserved for the
// Compare & Strategize panel's deep creative analysis.
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
// 4096 was too small for retrospective compilations with full transcripts —
// users hit mid-sentence cutoffs at "🔑 Winner DNA (". 16k is generous
// but still bounded; cost guard still lives in SESSION_COST_CAP_USD.
const MAX_TOKENS = 16_384;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type Handler = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => Promise<unknown>;

export interface AgentMessage {
  role: "user" | "assistant";
  // For the agent loop we use Anthropic's block format so tool_use /
  // tool_result round-trip cleanly. Incoming user messages from the UI
  // arrive as plain strings and are normalized in the route.
  content: string | AnthropicBlock[];
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  role: "assistant";
  content: AnthropicBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: AnthropicUsage;
  model: string;
}

export interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output_preview: string | null;
  duration_ms: number;
  status: "ok" | "error";
  error_message?: string;
  result_rows?: number;
}

export interface AgentRunResult {
  messages: AgentMessage[];
  toolTraces: ToolCallTrace[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  finalText: string;
  hitCostCap: boolean;
  iterations: number;
}

interface RunAgentLoopArgs {
  messages: AgentMessage[];
  systemPrompt: string;
  tools: ToolDefinition[];
  handlers: Record<string, Handler>;
  toolContext: ToolContext;
  anthropicKey: string;
  sessionBaseCostUsd: number;
  // Emitters: the route writes SSE frames as these fire.
  onToolCallStart?: (trace: Omit<ToolCallTrace, "output_preview" | "duration_ms" | "status">) => void;
  onToolCallEnd?: (trace: ToolCallTrace) => void;
  onTextDelta?: (text: string) => void;
  onCostCap?: (message: string) => void;
  onCostWarn?: (projectedUsd: number) => void;
}

function previewJson(value: unknown, max = 500): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}

function countRows(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  for (const key of [
    "ads",
    "deconstructions",
    "reports",
    "scaling_campaigns",
    "actions",
  ]) {
    const arr = v[key];
    if (Array.isArray(arr)) return arr.length;
  }
  return undefined;
}

async function callAnthropic(args: {
  apiKey: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  messages: AgentMessage[];
  stream: boolean;
}): Promise<Response> {
  // Cache the system prompt and the tools array — these are stable
  // across turns, so setting cache_control on them is free tokens saved.
  const cachedSystem = [
    {
      type: "text" as const,
      text: args.systemPrompt,
      cache_control: { type: "ephemeral" as const },
    },
  ];
  // Stamp cache_control on the last tool so the whole array is cached.
  const toolsPayload = args.tools.map((t, i) =>
    i === args.tools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" as const } }
      : t
  );

  return fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: cachedSystem,
      tools: toolsPayload,
      messages: args.messages,
      stream: args.stream,
    }),
  });
}

export async function runAgentLoop(
  args: RunAgentLoopArgs
): Promise<AgentRunResult> {
  const messages: AgentMessage[] = [...args.messages];
  const toolTraces: ToolCallTrace[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCostThisRun = 0;
  let iterations = 0;
  let finalText = "";
  let hitCostCap = false;

  let softWarnFired = false;
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    iterations++;

    // Budget check BEFORE spending on another Anthropic call.
    const projected = args.sessionBaseCostUsd + totalCostThisRun;
    if (projected >= SESSION_COST_CAP_USD) {
      hitCostCap = true;
      args.onCostCap?.(
        `Naabot na yung session cost cap ($${SESSION_COST_CAP_USD.toFixed(2)}). Mag-start ka ng bagong chat para tumuloy.`
      );
      break;
    }
    if (!softWarnFired && projected >= SESSION_COST_SOFT_WARN_USD) {
      softWarnFired = true;
      args.onCostWarn?.(projected);
    }

    const res = await callAnthropic({
      apiKey: args.anthropicKey,
      systemPrompt: args.systemPrompt,
      tools: args.tools,
      messages,
      stream: false,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Anthropic error (${res.status}): ${errText.slice(0, 300)}`
      );
    }

    const json = (await res.json()) as AnthropicResponse;
    totalInputTokens += json.usage.input_tokens;
    totalOutputTokens += json.usage.output_tokens;
    totalCacheReadTokens += json.usage.cache_read_input_tokens ?? 0;
    totalCostThisRun = estimateCostUsd(
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens
    );

    // Assistant message goes into the transcript regardless of stop reason.
    messages.push({ role: "assistant", content: json.content });

    if (json.stop_reason !== "tool_use") {
      // Model produced final text. Chunk it out through onTextDelta so
      // the UI still animates — MUCH cheaper than re-calling Anthropic
      // with stream=true (which would double output token cost for every
      // turn). Prior implementation did the re-call and was burning
      // ~50% of cost budget on each response.
      const textBlocks = json.content.filter(
        (b): b is { type: "text"; text: string } => b.type === "text"
      );
      finalText = textBlocks.map((b) => b.text).join("");

      // Emit the text in small chunks so the UI renders progressively.
      const CHUNK = 40;
      for (let pos = 0; pos < finalText.length; pos += CHUNK) {
        args.onTextDelta?.(finalText.slice(pos, pos + CHUNK));
      }

      // Anthropic hit max_tokens mid-response — warn the user so they
      // know the output was truncated, not complete.
      if (json.stop_reason === "max_tokens") {
        const truncNote =
          "\n\n---\n⚠️ **Na-truncate yung sagot — lumampas sa output token limit.** Pwede mo ako paki-tanong mag-continue from where I stopped, or pa-narrow yung scope (fewer ads / shorter transcripts).";
        args.onTextDelta?.(truncNote);
        finalText += truncNote;
      }

      // Replace the raw content-block form in the transcript with the
      // flat string — easier for follow-up turns to reference.
      messages.pop();
      messages.push({ role: "assistant", content: finalText });
      break;
    }

    // stop_reason === "tool_use" — dispatch every tool_use block in
    // parallel. Anthropic's contract says we must reply with a single
    // user message containing one tool_result per tool_use, in any order.
    const toolUses = json.content.filter(
      (b): b is Extract<AnthropicBlock, { type: "tool_use" }> =>
        b.type === "tool_use"
    );

    const traces = await Promise.all(
      toolUses.map(async (block) => {
        args.onToolCallStart?.({
          id: block.id,
          name: block.name,
          input: block.input,
        });
        const startedAt = Date.now();
        const handler = args.handlers[block.name];
        if (!handler) {
          const trace: ToolCallTrace = {
            id: block.id,
            name: block.name,
            input: block.input,
            output_preview: null,
            duration_ms: Date.now() - startedAt,
            status: "error",
            error_message: `Unknown tool: ${block.name}`,
          };
          args.onToolCallEnd?.(trace);
          return {
            trace,
            block: {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify({
                error: `Tool ${block.name} is not available in this context.`,
              }),
              is_error: true,
            },
          };
        }
        try {
          const output = await handler(block.input, args.toolContext);
          const preview = previewJson(output);
          const trace: ToolCallTrace = {
            id: block.id,
            name: block.name,
            input: block.input,
            output_preview: preview,
            duration_ms: Date.now() - startedAt,
            status: "ok",
            result_rows: countRows(output),
          };
          args.onToolCallEnd?.(trace);
          return {
            trace,
            block: {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content:
                typeof output === "string"
                  ? output
                  : JSON.stringify(output),
            },
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown tool error";
          const trace: ToolCallTrace = {
            id: block.id,
            name: block.name,
            input: block.input,
            output_preview: null,
            duration_ms: Date.now() - startedAt,
            status: "error",
            error_message: msg,
          };
          args.onToolCallEnd?.(trace);
          return {
            trace,
            block: {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify({ error: msg }),
              is_error: true,
            },
          };
        }
      })
    );

    toolTraces.push(...traces.map((t) => t.trace));
    messages.push({
      role: "user",
      content: traces.map((t) => t.block),
    });
    // Loop continues — next iteration calls Anthropic with the tool_result.
  }

  // Max iterations hit without text response.
  if (!finalText) {
    finalText =
      "Marami kong nakuha na data pero hindi ko ma-synthesize sa oras — pakireword yung tanong o paghati-hatiin sa mas simpleng parts.";
    messages.push({ role: "assistant", content: finalText });
  }

  return {
    messages,
    toolTraces,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCostUsd: totalCostThisRun,
    finalText,
    hitCostCap,
    iterations,
  };
}
