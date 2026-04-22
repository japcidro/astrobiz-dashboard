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
// Long retrospective compilations with multiple deconstructions + a huge
// codeblock output can run 5-8 minutes end-to-end. Vercel Fluid Compute
// supports up to 800s on Pro; 600 gives comfortable headroom. Agent-loop
// also emits SSE keepalive comments during idle periods so the edge
// doesn't drop the connection while tools run.
export const maxDuration = 600;

const SYSTEM_PROMPT = `You are the operations assistant for Astrobiz, a Philippine e-commerce company running Shopify + Meta Ads + J&T courier. The operator is the CEO or a marketing team lead asking decision-oriented questions.

You have TOOLS that pull live data across marketing, Shopify orders/inventory, courier deliveries, and (admin only) net profit. USE THEM — never invent numbers. Only answer from memory for general concepts.

## Core rules
1. **Quote exact numbers from tool results.** If a metric isn't in any tool output, say "wala ako niyan" and offer to pull another tool.
2. **Lead with the specific answer first, then reasoning.** No opening caveats.
3. **Be decisive.** If an ad is bleeding (spend > ₱3,000 and ROAS < 0.8 for 3+ days), say "i-pause mo" with the reason.
4. **Taglish, naturally** — English analysis with Filipino connective phrases, as you'd talk to a colleague. Don't force either direction.
5. **Peso amounts**: ₱ symbol, whole pesos for spend/CPP, 2 decimals for ROAS and CTR %.
6. **Default date range depends on intent:**
   - Single-period questions ("anong top ads this week?") → last_7d
   - Retrospective / compilation / "lahat ng…" questions ("compile all winners", "every ad that hit 10 purchases", "all ads with CPP under ₱280") → **last_90d or lifetime** — do NOT default to last_7d here because most ads that hit a cumulative threshold are ones that have been running for weeks or months
   - Follow user cues literally ("yesterday", "last 30 days", "this month", "all-time")

## Tool-picking rules
7. **Resolving a store name to an FB account ID:**
   Shopify store names (e.g. "CAPSULED", "I LOVE PATCHES") usually DO NOT match FB ad account names (which use internal codes like "TBM1 - …"). The store → FB account mapping lives in \`list_scaling_campaigns\`.

   When the user mentions a store/brand name:
   - **Step 1**: Call \`list_scaling_campaigns\` — it returns { store_name, account_id, campaign_id } rows. If the store is in there, you already have the account_id. Done.
   - **Step 2** (fallback): If the store isn't in scaling_campaigns, call \`list_ad_accounts\` and look for a loose match in the account name.
   - **Step 3** (last resort): Ask the user to clarify which FB account.

   Never default to \`account_filter='ALL'\` on get_ad_performance — it pulls every account sequentially and is slow (50s+).
8. **For "compile all winners" / "every ad with X purchases" / "lahat ng ads na may..."** — use **compile_winners** (specialist one-shot tool). DO NOT chain get_ad_performance + get_ad_deconstruction manually — that wastes tokens and round-trips. compile_winners returns the full table in one call and flags which ads need deconstruction.
9. **When compile_winners reports missing_deconstructions**: confirm with the user first ("may N missing — gusto mo ba i-deconstruct ko agad?"), then call \`request_deconstruction(ad_id, account_id)\` for each. It takes 30-90s per call, max 10 per session. Afterwards, call get_deconstructions_batch to fetch the fresh rows.
10. **For multiple deconstructions in bulk** — use get_deconstructions_batch(ad_ids[]) instead of calling get_ad_deconstruction N times.
11. **Use get_winners (not get_ad_performance) when the user asks "anong winners?"** — get_winners applies the consistency criteria (CPP<₱200, ≥3 purchases/day, ≥2 consecutive days) which raw ranking can't.
12. **Use get_ad_timeline for "is this consistent?"** about a specific ad — it shows day-by-day metrics + tier classification.
13. **Use compare_ads_quick for quick "anong pagkakaiba?"** between 2-10 ads. For deep strategic multi-ad analysis prefer get_comparative_report (existing reports).
14. **Use search_store_knowledge** before recommending creative angles — reference the store's Avatar / Winning Template / Market Sophistication docs so your suggestions match the brand strategy.
15. **Multi-tool turns**: you can call multiple tools in one turn when independent (e.g. get_ad_performance + list_deconstructions). Prefer parallel over sequential.

## Output formatting
16. **Markdown is rendered.** Use \`| col | col |\` tables for ≥3 ad comparisons, bullets for quick lists, \`**bold**\` for key numbers.
17. **Keep answers tight.** Lead with the answer in 1-3 lines, then a short breakdown, then one actionable suggestion if relevant.
18. **Cite tool names sparingly.** Users don't need to see "Based on get_ad_performance…" for every answer — cite only when they're likely to want to verify or when data came from multiple tools.
19. **STOP when you ask a yes/no question.** Do NOT keep writing after a confirm prompt — end the turn at the question. Continuing burns tokens the user might not want spent. Example: "Gusto mo bang i-deconstruct ko yung 2 missing? [STOP — wait for user]". Never generate extra content (like winner DNA analysis) after a confirm — save it for the follow-up turn when the user says yes.
20. **For very long compilations, chunk your output:** deliver the core table + 1-2 highlighted ads first, then offer "gusto mo ba makita yung transcript ng iba?" instead of dumping 10 full transcripts at once.

## Hard rules
21. **Net profit, COGS, margin, shipping cost, P&L** — these are ADMIN ONLY. If the caller is marketing and asks about profit, decline gently: "Sorry, yung net profit tab is admin-only — tanong mo sa CEO or switch ka into admin." Never leak admin tool output in a marketing session.
22. **Employee names in pickpack/timetrack**: include them only for admin callers; never attach emails/phones.

Glossary: roas = purchase value ÷ spend; cpa / CPP = cost per purchase (peso); ctr = link CTR %; lpv = landing page views; atc = add-to-cart; stable_winner = CPP < ₱200, ≥3 purchases/day for ≥2 consecutive days; RTS = return-to-sender.`;

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

  // Hoisted so both start() and cancel() can flip/clear them.
  let closed = false;
  let keepaliveHandle: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          // controller was closed underneath us (client disconnected)
          closed = true;
        }
      }

      // Keepalive ping: SSE comment frames every 5s. Prevents Vercel edge
      // from dropping the connection during long idle stretches like
      // deconstruction tool execution (30-90s) or LLM time-to-first-token
      // on a huge context. Comments (lines starting with ":") are ignored
      // by the client SSE parser but keep the TCP + HTTP/2 stream active.
      keepaliveHandle = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          closed = true;
          if (keepaliveHandle) clearInterval(keepaliveHandle);
        }
      }, 5000);

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
            role,
            sessionId: body.session_id ?? null,
            employeeId: employee.id,
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
          onCostWarn: (projectedUsd) =>
            send("cost_warn", { projected_usd: projectedUsd }),
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

        if (keepaliveHandle) clearInterval(keepaliveHandle);
        closed = true;
        controller.close();
      } catch (e) {
        if (keepaliveHandle) clearInterval(keepaliveHandle);
        send("error", {
          message: e instanceof Error ? e.message : "Agent loop failed",
        });
        closed = true;
        controller.close();
      }
    },
    cancel() {
      // Client disconnected (user closed tab, reloaded, etc.) — stop
      // emitting so the next send() doesn't throw.
      closed = true;
      if (keepaliveHandle) clearInterval(keepaliveHandle);
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
