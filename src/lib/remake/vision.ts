import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_FORMS, type BrandCheck, type ProductForm, type ShotKind } from "./types";

/**
 * Claude looks at frames for three jobs: label each clip (talking head or
 * b-roll, which person, brand-heavy, what happens), find where the person
 * or scene changes in the one-frame-per-second strip, and check a generated
 * still for leftover competitor branding.
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
    if (buf.byteLength > 4.9 * 1024 * 1024) return null;
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
  const objFirst = a >= 0 && (s < 0 || a < s);
  const candidates = objFirst
    ? [a >= 0 && b > a ? cleaned.slice(a, b + 1) : null, s >= 0 && e > s ? cleaned.slice(s, e + 1) : null]
    : [s >= 0 && e > s ? cleaned.slice(s, e + 1) : null, a >= 0 && b > a ? cleaned.slice(a, b + 1) : null];
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
  person: string | null;
  holds: string;
  brand_heavy: boolean;
  description: string;
}

const FORMS = PRODUCT_FORMS.join(" | ");
const asForm = (v: unknown): ProductForm | null => (typeof v === "string" && (PRODUCT_FORMS as string[]).includes(v) ? (v as ProductForm) : null);

/** Label every clip from its frame. Returns null when Claude is unavailable. */
export async function labelShots(db: SupabaseClient, frames: Array<{ idx: number; url: string }>): Promise<ShotLabel[] | null> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const f of frames.slice(0, 20)) {
    const img = await imageBlock(f.url);
    if (!img) continue;
    blocks.push({ type: "text", text: `Clip ${f.idx}:` }, img);
  }
  if (blocks.length === 0) return null;
  blocks.push({
    type: "text",
    text: `Label each clip. Answer with JSON only: an array of {"idx": number, "kind": "talking_head" | "broll", "person": "A" | "B" | "C" | null, "holds": ${FORMS} | "none", "brand_heavy": boolean, "description": string}.`,
  });
  const system = `You label frames from a short vertical ad so an editor can plan a remake.
- kind "talking_head": a person facing the camera, speaking or presenting, face clearly the subject.
- kind "broll": anything else: hands, product, unboxing, application, room, text cards, screens.
- person: the same letter for the same person wherever they appear (first person seen = "A", next = "B", …). null when no person is the subject.
- holds: the form of the product the person holds or shows in this frame: bottle (any bottle or pill jar with a cap), gummies (loose gummies or candy-like pieces), capsules (loose capsules, tablets or softgels), box, sachet, tube, jar (wide-mouth cream or powder jar), other, or "none" when no product is held or shown.
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
      person: typeof o.person === "string" && /^[A-F]$/.test(o.person) ? o.person : null,
      holds: asForm(o.holds) ?? "none",
      brand_heavy: !!o.brand_heavy,
      description: typeof o.description === "string" ? o.description.slice(0, 300) : "",
    }));
}

/**
 * Where does the person or scene change? Reads the strip (one tile per
 * second, left to right) and returns the seconds a new clip starts at.
 */
export async function detectChanges(db: SupabaseClient, stripUrl: string, tiles: number): Promise<number[] | null> {
  const img = await imageBlock(stripUrl);
  if (!img) return null;
  const blocks: Array<Record<string, unknown>> = [
    { type: "text", text: `This strip has ${tiles} tiles, one per second of a vertical ad, left to right: tile 0 is second 0, tile ${tiles - 1} is second ${tiles - 1}.` },
    img,
    { type: "text", text: 'List the seconds where a new shot starts: a different person on screen, a cut to a product or hands, a new location, or a clear camera change. Answer with JSON only: {"cuts": number[]} (do not include 0).' },
  ];
  const system = `You find shot boundaries in interview-style and UGC ads. Be sensitive to the speaker changing even when the room is the same. Answer with JSON only.`;
  const out = await ask<{ cuts?: unknown }>(db, system, blocks, 400);
  if (!out || !Array.isArray(out.cuts)) return null;
  return Array.from(new Set(out.cuts.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < tiles))).sort((a, b) => a - b);
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

/** What a brand kit photo shows, so the still swap can pick the matching form. */
export async function describeProduct(db: SupabaseClient, url: string): Promise<{ kind: ProductForm; description: string } | null> {
  const img = await imageBlock(url);
  if (!img) return null;
  const out = await ask<{ kind?: unknown; description?: unknown }>(
    db,
    `You label product photos for an ad tool. "kind" is the physical form shown: ${FORMS}. "description" is one short line: what it is, colors, label text if readable (e.g. "white bottle with teal label, Relax Gummies"). Answer with JSON only.`,
    [img, { type: "text", text: 'Answer with JSON only: {"kind": string, "description": string}.' }],
    200
  );
  const kind = asForm(out?.kind);
  if (!kind) return null;
  return { kind, description: typeof out?.description === "string" ? out.description.slice(0, 160) : "" };
}
