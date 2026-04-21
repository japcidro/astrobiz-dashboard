import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { buildToolRegistry } from "@/lib/ai/tools/registry";
import type { AgentRole } from "@/lib/ai/tools/permissions";
import {
  runAgentLoop,
  type AgentMessage,
  type ToolCallTrace,
} from "@/lib/ai/agent-loop";

export const dynamic = "force-dynamic";
// Tool-use loops can chain up to MAX_TOOL_ITERATIONS Anthropic calls plus
// tool execution + final streaming — give it headroom past Vercel's
// default 60s for complex multi-tool questions.
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are a senior Facebook Ads performance analyst for Astrobiz, a Philippine e-commerce company running Shopify + Meta Ads. The operator is the CEO or a marketing team lead asking decision-oriented questions.

You have TOOLS that pull live data. USE THEM — never invent numbers. If the user asks anything about ad performance, recent analyses, comparative reports, scaling campaigns, or autopilot activity, call the appropriate tool. Only answer from memory for general marketing concepts or when the user is just chatting.

Rules:
1. Quote exact numbers from tool results. If a metric isn't in any tool output, say "wala ako niyan" and offer to pull another tool.
2. Lead with the specific answer first, then reasoning. Don't open with caveats.
3. Be decisive. If an ad is bleeding (spend > ₱3,000 and ROAS < 0.8 for 3+ days), say "i-pause mo" with the reason.
4. Use Taglish naturally — English analysis with Filipino connective phrases, as you would talk to a colleague. Don't force Taglish or English either way.
5. Peso amounts: ₱ symbol, whole pesos for spend/CPP, 2 decimals for ROAS and CTR %.
6. Default date range to last_7d if the user doesn't specify, but follow their lead (e.g. "yesterday", "last 30 days").
7. When you need to look up a specific ad's deconstruction, first call list_deconstructions to find its ad_id unless the user already gave you one.
8. Never surface or discuss net profit, COGS, shipping costs, or P&L — those aren't in your tools.
9. You can call multiple tools in one turn when they're independent (e.g. get_ad_performance + list_deconstructions together). Prefer parallel tool calls over sequential when possible.

Glossary: roas = purchase value ÷ spend; cpa / CPP = cost per purchase (peso); ctr = link CTR %; lpv = landing page views; atc = add-to-cart; stable_winner = CPP < ₱200, ≥3 purchases/day for 2-3 consecutive days.`;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCallTrace[];
}

// Normalize incoming chat history to the block format the agent loop
// expects. The UI stores plain strings; we only need to preserve
// assistant→tool_result→assistant chains WITHIN a single turn (those
// live in the agent loop's local state). Previous turns can safely be
// flattened back to strings since the model doesn't need to re-execute
// those tool calls.
function normalizeMessages(raw: IncomingMessage[]): AgentMessage[] {
  return raw
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => typeof m.content === "string" && m.content.length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    messages?: IncomingMessage[];
    session_id?: string | null;
  };

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return Response.json(
      { error: "At least one message is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Pull API keys + feature flag + session base cost in parallel.
  const [keyRes, fbRes, flagRes, sessionRes] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "anthropic_api_key").single(),
    supabase.from("app_settings").select("value").eq("key", "fb_access_token").single(),
    supabase.from("app_settings").select("value").eq("key", "ai_agent_mode_enabled").maybeSingle(),
    body.session_id
      ? supabase
          .from("ai_chat_sessions")
          .select("total_cost_usd")
          .eq("id", body.session_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const anthropicKey = keyRes.data?.value as string | undefined;
  if (!anthropicKey) {
    return Response.json(
      {
        error:
          "Anthropic API key not configured. Ask an admin to set it in Settings.",
      },
      { status: 400 }
    );
  }

  const fbToken = fbRes.data?.value as string | undefined;
  if (!fbToken) {
    return Response.json(
      { error: "Facebook token not configured. Go to Admin → Settings." },
      { status: 400 }
    );
  }

  const agentModeEnabled =
    (flagRes.data?.value as string | undefined) !== "false";
  if (!agentModeEnabled) {
    return Response.json(
      {
        error:
          "AI agent mode is disabled. An admin can re-enable it in app_settings.",
      },
      { status: 503 }
    );
  }

  const sessionBaseCostUsd = Number(
    (sessionRes.data as { total_cost_usd?: number } | null)?.total_cost_usd ?? 0
  );

  const role = employee.role as AgentRole;
  const { definitions, handlers } = buildToolRegistry(role);

  const messages = normalizeMessages(incoming);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json(
      { error: "The last message must be from the user." },
      { status: 400 }
    );
  }

  // We want to stream SSE to the client AND run the tool loop. The loop
  // calls Anthropic non-streaming until tool_use stops, then streams the
  // final text. We wrap everything in a ReadableStream so we can emit
  // custom `tool_call` / `tool_result` frames ahead of Claude's SSE.
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        const result = await runAgentLoop({
          messages,
          systemPrompt: SYSTEM_PROMPT,
          tools: definitions,
          handlers,
          toolContext: {
            // Service client: handlers need to read across tables that
            // would otherwise be blocked by RLS for the marketing role
            // (autopilot_actions, store_scaling_campaigns). The allowlist
            // in permissions.ts is what actually gates visibility.
            supabase: createServiceClient(),
            fbToken,
          },
          anthropicKey,
          sessionBaseCostUsd,
          onToolCallStart: (t) => send("tool_call", t),
          onToolCallEnd: (t) => send("tool_result", t),
          onTextDelta: (text) =>
            send("content_block_delta", {
              type: "content_block_delta",
              delta: { type: "text_delta", text },
            }),
          onCostCap: (message) => send("cost_cap", { message }),
        });

        // Persist tool call audit rows + increment session cost totals
        // (best effort — a failure here should not break the chat).
        void persistAuditRows({
          traces: result.toolTraces,
          employeeId: employee.id,
          sessionId: body.session_id ?? null,
        });
        if (body.session_id) {
          void incrementSessionCost({
            sessionId: body.session_id,
            inputTokens: result.totalInputTokens,
            outputTokens: result.totalOutputTokens,
            cacheReadTokens: result.totalCacheReadTokens,
            costUsd: result.totalCostUsd,
          });
        }

        // Send a final summary event so the UI can save the session
        // with the full trace + cost.
        send("done", {
          total_input_tokens: result.totalInputTokens,
          total_output_tokens: result.totalOutputTokens,
          total_cache_read_tokens: result.totalCacheReadTokens,
          total_cost_usd: result.totalCostUsd,
          iterations: result.iterations,
          final_text: result.finalText,
          tool_calls: result.toolTraces,
          hit_cost_cap: result.hitCostCap,
        });

        controller.close();
      } catch (e) {
        send("error", {
          message: e instanceof Error ? e.message : "Agent loop failed",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function incrementSessionCost(args: {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}) {
  try {
    const service = createServiceClient();
    // Read-modify-write. Single-user-per-session today so no race risk.
    const { data } = await service
      .from("ai_chat_sessions")
      .select(
        "total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cost_usd"
      )
      .eq("id", args.sessionId)
      .maybeSingle();
    if (!data) return;
    await service
      .from("ai_chat_sessions")
      .update({
        total_input_tokens:
          (data.total_input_tokens ?? 0) + args.inputTokens,
        total_output_tokens:
          (data.total_output_tokens ?? 0) + args.outputTokens,
        total_cache_read_tokens:
          (data.total_cache_read_tokens ?? 0) + args.cacheReadTokens,
        total_cost_usd: Number(
          ((data.total_cost_usd ?? 0) + args.costUsd).toFixed(4)
        ),
      })
      .eq("id", args.sessionId);
  } catch (e) {
    console.warn(
      "[ai-chat] cost increment failed:",
      e instanceof Error ? e.message : e
    );
  }
}

async function persistAuditRows(args: {
  traces: ToolCallTrace[];
  employeeId: string;
  sessionId: string | null;
}) {
  if (args.traces.length === 0) return;
  try {
    const service = createServiceClient();
    await service.from("ai_tool_calls").insert(
      args.traces.map((t) => ({
        session_id: args.sessionId,
        employee_id: args.employeeId,
        tool_name: t.name,
        input: t.input,
        output_preview: t.output_preview,
        result_rows: t.result_rows ?? null,
        duration_ms: t.duration_ms,
        status: t.status === "ok" ? "ok" : "error",
        error_message: t.error_message ?? null,
      }))
    );
  } catch (e) {
    console.warn(
      "[ai-chat] audit insert failed:",
      e instanceof Error ? e.message : e
    );
  }
}
