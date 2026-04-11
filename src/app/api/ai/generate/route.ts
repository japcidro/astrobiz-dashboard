import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// POST — generate AI content via Claude API
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin" && employee.role !== "marketing") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { store_name, tool_type, user_input, count } = body as {
    store_name: string;
    tool_type: "angles" | "scripts" | "formats";
    user_input: string;
    count: number;
  };

  if (!store_name || !tool_type) {
    return Response.json(
      { error: "store_name and tool_type are required" },
      { status: 400 }
    );
  }

  const validToolTypes = ["angles", "scripts", "formats"];
  if (!validToolTypes.includes(tool_type)) {
    return Response.json(
      { error: "tool_type must be one of: angles, scripts, formats" },
      { status: 400 }
    );
  }

  const effectiveCount = Math.min(Math.max(count || 5, 5), 10);

  const supabase = await createClient();

  // 1. Fetch API key from app_settings
  const { data: settingRow, error: settingError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (settingError || !settingRow?.value) {
    return Response.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
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

  if (!docs || docs.length === 0) {
    return Response.json(
      { error: "No documents found for this store. Upload store docs first." },
      { status: 400 }
    );
  }

  // 3. Separate system instruction from knowledge docs
  const systemDoc = docs.find((d) => d.doc_type === "system_instruction");
  const knowledgeDocs = docs.filter((d) => d.doc_type !== "system_instruction");

  const systemPromptContent = systemDoc?.content || "You are a creative ad strategist.";

  // 4. Build knowledge context
  const knowledgeContext = knowledgeDocs
    .map((doc) => `=== ${doc.title} ===\n${doc.content}`)
    .join("\n\n");

  // 5. Build user message based on tool_type
  let userMessage = "";

  switch (tool_type) {
    case "angles":
      userMessage = `Based on the knowledge above, generate ${effectiveCount} unique ad angles for this product. Each angle should be a different approach/hook to sell the product. Number them 1-${effectiveCount}. Be specific and creative.`;
      break;
    case "scripts":
      userMessage = `Based on the knowledge above, create detailed ad scripts for each of these selected angles:\n\n${user_input}\n\nFor each angle, provide:\n- Hook (first 3 seconds)\n- B-roll scenes description\n- Voiceover script\n- CTA\n\nMake each script ready for video production.`;
      break;
    case "formats":
      userMessage = `Take this winning ad script/angle and expand it into ${effectiveCount} different creative formats. Each format should be adapted for a different style:\n\nWinning script:\n${user_input}\n\nCreate variations for: Short Hook (15s), Long Form (60s), UGC Testimonial, Problem-Solution, Before/After, Listicle, Story-based, etc.`;
      break;
  }

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
          messages: [
            {
              role: "user",
              content: knowledgeContext + "\n\n---\n\n" + userMessage,
            },
          ],
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to call Claude API: ${message}` },
      { status: 502 }
    );
  }
}
