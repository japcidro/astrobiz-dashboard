import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandCheck, ShotKind } from "./types";

/**
 * Claude looks at frames for two jobs: label each shot of a reference
 * (talking head or b-roll, brand-heavy or not, what happens), and check a
 * generated still for leftover competitor branding.
 */

const MODEL = "claude-sonnet-5";

async function apiKey(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

async function imageBlock(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 4.5 * 1024 * 1024) return null;
    return { type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  const s = cleaned.indexOf("[");
  const e = cleaned.lastIndexOf("]");
  const candidates = [a >= 0 && b > a ? cleaned.slice(a, b + 1) : null, s >= 0 && e > s ? cleaned.slice(s, e + 1) : null];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as T;
    } catch {
      // try the next shape
    }
  }
  return null;
}

async function ask<T>(db: SupabaseClient, system: string, content: Array<Record<string, unknown>>, maxTokens = 1200): Promise<T | null> {
  const key = await apiKey(db);
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    return extractJson<T>(text);
  } catch {
    return null;
  }
}

export interface ShotLabel {
  idx: number;
  kind: ShotKind;
  brand_heavy: boolean;
  description: string;
}

/** Label every shot from its frame. Returns null when Claude is unavailable. */
export async function labelShots(db: SupabaseClient, frames: Array<{ idx: number; url: string }>): Promise<ShotLabel[] | null> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const f of frames.slice(0, 20)) {
    const img = await imageBlock(f.url);
    if (!img) continue;
    blocks.push({ type: "text", text: `Shot ${f.idx}:` }, img);
  }
  if (blocks.length === 0) return null;
  blocks.push({
    type: "text",
    text: "Label each shot. Answer with JSON only: an array of {\"idx\": number, \"kind\": \"talking_head\" | \"broll\", \"brand_heavy\": boolean, \"description\": string}.",
  });
  const system = `You label frames from a short vertical ad so an editor can plan a remake.
- kind "talking_head": a person facing the camera, speaking or presenting, face clearly the subject.
- kind "broll": anything else: hands, product, unboxing, application, room, text cards, screens.
- brand_heavy true when the frame is mostly a competitor's packaging, logo, website or app screen, so swapping the person would not make it ours.
- description: one plain sentence of what is happening (who, what they hold or do, where). No brand names.
Answer with JSON only.`;
  const out = await ask<ShotLabel[]>(db, system, blocks, 1500);
  if (!Array.isArray(out)) return null;
  return out
    .filter((o) => typeof o?.idx === "number")
    .map((o) => ({
      idx: o.idx,
      kind: o.kind === "talking_head" ? "talking_head" : "broll",
      brand_heavy: !!o.brand_heavy,
      description: typeof o.description === "string" ? o.description.slice(0, 300) : "",
    }));
}

/** Does the generated still show only our product and no competitor branding? */
export async function brandCheck(db: SupabaseClient, stillUrl: string, productUrls: string[], rules: string): Promise<BrandCheck | null> {
  const blocks: Array<Record<string, unknown>> = [];
  const still = await imageBlock(stillUrl);
  if (!still) return null;
  blocks.push({ type: "text", text: "Generated still:" }, still);
  for (const u of productUrls.slice(0, 4)) {
    const img = await imageBlock(u);
    if (img) blocks.push({ type: "text", text: "Our product (reference):" }, img);
  }
  blocks.push({
    type: "text",
    text: `Check the generated still. ${rules.trim() ? `Brand rules: ${rules.trim()}. ` : ""}Answer with JSON only: {"ok": boolean, "notes": string}.`,
  });
  const system = `You review AI-generated ad stills before they are animated.
Fail (ok=false) when: a product, box or label in the still is not our product as shown in the reference photos; any other brand's name, logo or label is readable; leftover captions, UI, stickers or watermarks remain; the person is obviously deformed (extra fingers, warped face); the brand rules are broken.
Pass (ok=true) otherwise. "notes" is one or two short sentences naming what to fix, or "Looks clean." when it passes. No brand names of competitors. Answer with JSON only.`;
  const out = await ask<BrandCheck>(db, system, blocks, 400);
  if (!out || typeof out.ok !== "boolean") return null;
  return { ok: out.ok, notes: typeof out.notes === "string" ? out.notes.slice(0, 400) : "" };
}
