import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { DEFAULT_PROMPTS } from "@/lib/ai/default-prompts";
import { loadWinnersContext } from "@/lib/ai/winners-context";

export const dynamic = "force-dynamic";

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
    tool_type?: string; // "angles" | "scripts" | "formats"
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!store_name || !messages || messages.length === 0) {
    return Response.json(
      { error: "store_name and messages are required" },
      { status: 400 }
    );
  }

  // Determine which system instruction to use
  const TOOL_TO_SYSTEM: Record<string, string> = {
    angles: "system_angle_generator",
    scripts: "system_script_creator",
    formats: "system_format_expansion",
  };
  const systemDocType = tool_type ? TOOL_TO_SYSTEM[tool_type] || "system_angle_generator" : "system_angle_generator";

  const supabase = await createClient();

  // 1. Fetch API key
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

  const apiKey = settingRow.value;

  // 2. Fetch all docs for this store
  const { data: docs, error: docsError } = await supabase
    .from("ai_store_docs")
    .select("*")
    .eq("store_name", store_name);

  if (docsError) {
    return Response.json({ error: docsError.message }, { status: 500 });
  }

  // 3. Separate system instruction from knowledge docs.
  //    Auto-managed docs (validated_winners_dna) are excluded from the
  //    static knowledge block — those are injected separately as a
  //    dynamic checkpoint so the static prefix stays cached.
  const systemDoc = docs?.find((d) => d.doc_type === systemDocType);
  const knowledgeDocs = (docs || []).filter(
    (d) =>
      !d.doc_type.startsWith("system_") &&
      d.doc_type !== "validated_winners_dna"
  );

  // System prompt resolution order:
  //   1. Per-store custom override in ai_store_docs (legacy hand-written)
  //   2. v2.0 default for this tool, baked into code
  //   3. Generic fallback (defensive — should never fire if DEFAULT_PROMPTS is intact)
  const systemPromptContent =
    systemDoc?.content ||
    DEFAULT_PROMPTS[systemDocType] ||
    "You are a creative ad strategist and copywriter.";

  // 4. Build knowledge context
  const knowledgeContext = knowledgeDocs
    .map((doc) => `=== ${doc.title} ===\n${doc.content}`)
    .join("\n\n");

  // 5. Load validated-winners context — separate cache checkpoint so changes
  //    to the winners list don't bust the static system+knowledge prefix.
  //    Returns null on cold start (no winners yet) — generator falls back to
  //    the manual winning_ad_template doc per the system prompt.
  const winners = await loadWinnersContext(supabase, store_name);

  // 6. Build system blocks. Cache hierarchy:
  //   [0] system instruction          — static, cached at end of static prefix
  //   [1] static knowledge docs       — static, cached at end of static prefix
  //   [2] validated winners (dynamic) — separate cache_control checkpoint
  // Putting knowledge in `system` (not in the first user message) keeps the
  // cache prefix stable across turns; only the messages array varies per call.
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
    // No knowledge docs → cache at end of system prompt instead so we still
    // get a cache hit on multi-turn conversations.
    systemBlocks[0].cache_control = { type: "ephemeral" };
  }

  if (winners) {
    systemBlocks.push({
      type: "text",
      text: winners.text,
      cache_control: { type: "ephemeral" },
    });
  }

  const model = "claude-sonnet-4-6";

  // 6. Call Claude API with exponential backoff on 429 / 5xx
  const maxAttempts = 3;
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const claudeResponse = await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            // 16384 leaves headroom for 7 detailed scripts (each with hook +
            // body + 3 variant hooks + classification block) plus the
            // batch_intent line. 8192 was tight once v2 outputs landed.
            max_tokens: 16384,
            system: systemBlocks,
            messages,
          }),
        }
      );

      if (claudeResponse.ok) {
        const result = await claudeResponse.json();
        const generatedText = result.content[0].text;
        return Response.json({
          text: generatedText,
          model,
          tokens_used: result.usage,
          context: {
            used_default_prompt: !systemDoc,
            winner_count: winners?.winner_count ?? 0,
            winner_ids: winners?.winner_ids ?? [],
          },
        });
      }

      lastStatus = claudeResponse.status;
      lastBody = await claudeResponse.text();

      const retryable = lastStatus === 429 || lastStatus >= 500;
      if (!retryable || attempt === maxAttempts - 1) break;

      const retryAfterHeader = claudeResponse.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : 0;
      const backoffMs = Math.max(
        retryAfterMs,
        1000 * 2 ** attempt + Math.floor(Math.random() * 500)
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    } catch (err) {
      if (attempt === maxAttempts - 1) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json(
          { error: `Claude API call failed: ${message}` },
          { status: 500 }
        );
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }

  if (lastStatus === 429) {
    return Response.json(
      { error: "Rate limited by Claude API. Please try again in a moment." },
      { status: 429 }
    );
  }
  return Response.json(
    { error: `Claude API error (${lastStatus}): ${lastBody}` },
    { status: 502 }
  );
}
