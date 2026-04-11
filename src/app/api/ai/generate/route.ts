import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

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
  const { store_name, messages } = body as {
    store_name: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!store_name || !messages || messages.length === 0) {
    return Response.json(
      { error: "store_name and messages are required" },
      { status: 400 }
    );
  }

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

  // 3. Separate system instruction from knowledge docs
  const systemDoc = docs?.find((d) => d.doc_type === "system_instruction");
  const knowledgeDocs = (docs || []).filter((d) => d.doc_type !== "system_instruction");

  const systemPromptContent = systemDoc?.content || "You are a creative ad strategist and copywriter.";

  // 4. Build knowledge context
  const knowledgeContext = knowledgeDocs
    .map((doc) => `=== ${doc.title} ===\n${doc.content}`)
    .join("\n\n");

  // 5. Build messages for Claude
  // First user message gets the knowledge context prepended
  const claudeMessages = messages.map((msg, i) => {
    if (i === 0 && msg.role === "user") {
      return {
        role: msg.role,
        content: knowledgeContext
          ? `Here is all the knowledge about this product/brand:\n\n${knowledgeContext}\n\n---\n\n${msg.content}`
          : msg.content,
      };
    }
    return msg;
  });

  // 6. Call Claude API
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
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPromptContent,
          messages: claudeMessages,
        }),
      }
    );

    if (!claudeResponse.ok) {
      const errorBody = await claudeResponse.text();
      const status = claudeResponse.status;

      if (status === 429) {
        return Response.json(
          { error: "Rate limited by Claude API. Please try again in a moment." },
          { status: 429 }
        );
      }

      return Response.json(
        { error: `Claude API error (${status}): ${errorBody}` },
        { status: 502 }
      );
    }

    const result = await claudeResponse.json();
    const generatedText = result.content[0].text;

    return Response.json({
      text: generatedText,
      model: "claude-sonnet-4-20250514",
      tokens_used: result.usage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Claude API call failed: ${message}` }, { status: 500 });
  }
}
