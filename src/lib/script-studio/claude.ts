import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One JSON-shaped Claude call for the Script Generator. Opus plans and
 * writes (the same model as the Hook Generator planner); Sonnet reviews,
 * like the Static Ad Generator's art director.
 */
export const WRITER_MODEL = "claude-opus-5-5";
export const REVIEWER_MODEL = "claude-sonnet-5";

async function apiKey(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

export type JsonSchema = Record<string, unknown>;

export interface AskInput {
  model: string;
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export async function askJson<T>(db: SupabaseClient, input: AskInput): Promise<T | { error: string }> {
  const key = await apiKey(db);
  if (!key) return { error: "No Anthropic API key in Settings" };
  const client = new Anthropic({ apiKey: key });
  try {
    const response = await client.beta.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 12000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: input.effort ?? "medium", format: { type: "json_schema", schema: input.schema } },
      system: input.system,
      messages: [{ role: "user", content: [{ type: "text", text: input.user }] }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude declined this one" };
    if (response.stop_reason === "max_tokens") return { error: "Claude's answer came back cut off; try again" };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Claude's answer was not valid JSON" };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude is rate limited; try again in a minute" };
    if (e instanceof Anthropic.APIError) return { error: `Claude API ${e.status}: ${e.message.slice(0, 200)}` };
    return { error: e instanceof Error ? e.message : "Claude call failed" };
  }
}

export const isError = (v: unknown): v is { error: string } => !!v && typeof v === "object" && "error" in (v as Record<string, unknown>) && typeof (v as { error: unknown }).error === "string";
