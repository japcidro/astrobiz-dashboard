import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_FORMS, type BrandCheck, type ProductForm, type ShotKind, type VoiceGender } from "./types";

/**
 * Claude looks at frames for three jobs: label each clip (talking head or
 * b-roll, which person, brand-heavy, what happens), find where the person
 * or scene changes in the frame strip, and check a generated
 * still for leftover competitor branding.
 */

const MODEL = "claude-sonnet-5";

async function apiKey(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

/** The real image type from the first bytes; CDNs and renamed files lie in the header and Claude rejects a mismatch. */
function sniffImageType(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/**
 * An image as a base64 block. Anything bigger than Claude reads (1568 px on
 * the long side) is shrunk to a JPEG first, so a few full-size photos in one
 * question stay under the request limit; `maxSide` shrinks further when a
 * thumbnail is enough (a model photo to judge age and look).
 */
export async function imageBlock(url: string, maxSide = 1568): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    let buf: Buffer = Buffer.from(await res.arrayBuffer());
    let type = sniffImageType(buf);
    if (!type) return null;
    if (type !== "image/gif" && (buf.byteLength > 1024 * 1024 || maxSide < 1568)) {
      try {
        const sharp = (await import("sharp")).default;
        buf = await sharp(buf).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
        type = "image/jpeg";
      } catch {
        // Keep the original; the size check below decides.
      }
    }
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
      // Models sometimes put raw line breaks inside strings; escape them and try again.
      try {
        return JSON.parse(escapeControlCharsInStrings(c)) as T;
      } catch {
        // try the next shape
      }
    }
  }
  return null;
}

/** Escape raw control characters that sit inside JSON string literals (a raw newline in a long description is the usual offender). */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch < " ") out += " ";
      else out += ch;
    } else {
      out += ch;
      if (ch === '"') inString = true;
    }
  }
  return out;
}

/** Why the last Claude call failed, in the API's words (out of credits, overloaded…), for error messages. */
let lastError: string | null = null;
export const lastClaudeError = () => lastError;

/** effort caps how long the model thinks before it answers (the API default is "high"). */
async function ask<T>(db: SupabaseClient, system: string, content: Array<Record<string, unknown>>, maxTokens = 1200, effort?: "low" | "medium" | "high"): Promise<T | null> {
  const key = await apiKey(db);
  lastError = key ? null : "no Anthropic API key in Settings";
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content }], ...(effort ? { output_config: { effort } } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (process.env.VISION_DEBUG) console.error("[vision]", res.status, body.slice(0, 600));
      try {
        lastError = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? `Anthropic API error ${res.status}`;
      } catch {
        lastError = `Anthropic API error ${res.status}`;
      }
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
    const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const parsed = extractJson<T>(text);
    if (process.env.VISION_DEBUG && !parsed) {
      console.error("[vision] unparsed", json.stop_reason, "len", text.length, "head:", text.slice(0, 200).replace(/\n/g, "⏎"), "tail:", text.slice(-200).replace(/\n/g, "⏎"));
    }
    if (!parsed) lastError = "Claude's answer could not be read, try again";
    return parsed;
  } catch {
    lastError = "could not reach the Anthropic API";
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
 * Where does the person or scene change? Reads the strip (`tiles` frames
 * spread evenly over `span` seconds; tile i covers [i·span/tiles,
 * (i+1)·span/tiles]) and returns the seconds a new clip starts at: the edge
 * before the first tile of each new shot. `cols` is tiles per numbered row;
 * null for old strips, one unnumbered row.
 */
export async function detectChanges(db: SupabaseClient, stripUrl: string, strip: { tiles: number; span: number; cols: number | null }): Promise<number[] | null> {
  const { tiles, span, cols } = strip;
  const img = await imageBlock(stripUrl);
  if (!img) return null;
  const step = span / tiles;
  const at = (i: number) => `${Math.round((i + 0.5) * step * 10) / 10}s`;
  const rows = cols ? Math.ceil(tiles / cols) : 1;
  const layout = cols
    ? `${rows > 1 ? `in ${rows} rows of ${cols} (left to right, then the next row)` : "left to right"}, each with its number printed in the top-left corner`
    : "left to right, numbered from 0";
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `This image is ${tiles} frames from ${Math.round(span)} seconds of a vertical ad, in time order, ${layout}. One every ${Math.round(step * 100) / 100}s: tile 0 is at ${at(0)}, tile 1 at ${at(1)}, tile ${tiles - 1} at ${at(tiles - 1)}.`,
    },
    img,
    { type: "text", text: 'List the tiles where a new shot starts: a different person on screen, a cut to a product or hands, a new location, or a clear camera change. Answer with JSON only: {"cuts": number[]} (tile numbers; do not include 0).' },
  ];
  const system = `You find shot boundaries in interview-style and UGC ads. Be sensitive to the speaker changing even when the room is the same. Answer with JSON only.`;
  const out = await ask<{ cuts?: unknown }>(db, system, blocks, 400);
  if (!out || !Array.isArray(out.cuts)) return null;
  const firsts = Array.from(new Set(out.cuts.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < tiles))).sort((a, b) => a - b);
  return firsts.map((i) => Math.round(i * step * 10) / 10);
}

/** Does the generated still show only our product and no competitor branding? */
export async function brandCheck(
  db: SupabaseClient,
  stillUrl: string,
  productUrls: string[],
  rules: string,
  copyScene = false,
  people?: { castUrl: string | null; frameUrl: string | null }
): Promise<(BrandCheck & { voice: VoiceGender | null; person_ok: boolean | null }) | null> {
  const blocks: Array<Record<string, unknown>> = [];
  const still = await imageBlock(stillUrl);
  if (!still) return null;
  // Three people can be in play, so every image is named: A the still, B the picked person, C the original frame.
  let checkPerson = false;
  if (people?.castUrl) {
    const cast = await imageBlock(people.castUrl);
    if (cast) {
      blocks.push({ type: "text", text: "IMAGE B — the PICKED PERSON. The still must show this same individual (same face):" }, cast);
      checkPerson = true;
    }
    if (people.frameUrl) {
      const frame = await imageBlock(people.frameUrl);
      if (frame) blocks.push({ type: "text", text: "IMAGE C — the ORIGINAL FRAME the still was made from. The person in it was supposed to be replaced:" }, frame);
    }
  }
  blocks.push({ type: "text", text: checkPerson ? "IMAGE A — the GENERATED STILL to check:" : "Generated still:" }, still);
  for (const u of productUrls.slice(0, 4)) {
    const img = await imageBlock(u);
    if (img) blocks.push({ type: "text", text: "Our product (reference):" }, img);
  }
  blocks.push({
    type: "text",
    text: `Check the generated still${checkPerson ? " (IMAGE A)" : ""}. ${checkPerson ? "person_ok is true only when the face in IMAGE A is the same individual as IMAGE B (the picked person); it is false when IMAGE A still shows the person from IMAGE C or someone else. Ignore clothing, which is meant to come from IMAGE C. " : ""}${copyScene ? "This still copies the reference scene with a new person; none of our product is expected in it, so do not fail it for a missing or generic product. " : ""}${rules.trim() ? `Brand rules: ${rules.trim()}. ` : ""}Answer with JSON only: {"ok": boolean, "notes": string, "voice": "male" | "female" | null${checkPerson ? ', "person_ok": boolean' : ""}}.`,
  });
  const system = `You review AI-generated ad stills before they are animated.
Fail (ok=false) when: a product, box or label in the still is not our product as shown in the reference photos; any other brand's name, logo or label is readable; leftover captions, UI, stickers or watermarks remain; the person is obviously deformed (extra fingers, warped face); the brand rules are broken; or, when a picked person is given, the person in the still is not that individual (person_ok=false, and start "notes" with "Wrong person:"). Compare faces, not clothes: the clothing is meant to come from the original frame.
Pass (ok=true) otherwise. "notes" is one or two short sentences naming what to fix, or "Looks clean." when it passes. No brand names of competitors.
"voice": the voice the main person in the still would speak with, "male" or "female" from how they present; null only when no person is visible. Answer with JSON only.`;
  const out = await ask<BrandCheck & { voice?: unknown; person_ok?: unknown }>(db, system, blocks, 400);
  if (!out || typeof out.ok !== "boolean") return null;
  const person_ok = checkPerson ? out.person_ok !== false : null;
  return { ok: out.ok && person_ok !== false, notes: typeof out.notes === "string" ? out.notes.slice(0, 400) : "", voice: out.voice === "male" || out.voice === "female" ? out.voice : null, person_ok };
}

/** What a brand kit photo shows, so the still swap can pick the matching form. */
export async function describeProduct(db: SupabaseClient, url: string): Promise<{ kind: ProductForm; description: string } | null> {
  const img = await imageBlock(url);
  if (!img) return null;
  const out = await ask<{ kind?: unknown; description?: unknown }>(
    db,
    `You label product photos for an ad tool. "kind" is the physical form shown: ${FORMS}. "description" is one short line: what it is, which side of the pack faces the camera (front, back or side) when it is packaging, colors, label text if readable (e.g. "front of a white bottle with teal label, Relax Gummies"). A sheet or close-up of patches or stickers is "patches". Answer with JSON only.`,
    [img, { type: "text", text: 'Answer with JSON only: {"kind": string, "description": string}.' }],
    200
  );
  const kind = asForm(out?.kind);
  if (!kind) return null;
  return { kind, description: typeof out?.description === "string" ? out.description.slice(0, 160) : "" };
}

/** The words printed on an ad or post image (headline first, then the rest), so they can be approved before a remake renders them. */
export async function readImageText(db: SupabaseClient, url: string): Promise<{ text: string; has_text: boolean } | null> {
  const img = await imageBlock(url);
  if (!img) return null;
  const out = await ask<{ has_text?: unknown; text?: unknown }>(
    db,
    `You transcribe the text printed on a social media image or ad. Return every piece of text that is part of the design (headline, subhead, bullets, captions, stickers), exactly as written, one line per block, biggest and most prominent first. Leave out watermarks, platform UI, and tiny legal print. If there is no designed text, has_text is false and text is "". Answer with JSON only.`,
    [img, { type: "text", text: 'Answer with JSON only: {"has_text": boolean, "text": string}.' }],
    600
  );
  if (!out) return null;
  return { has_text: out.has_text === true, text: typeof out.text === "string" ? out.text.trim().slice(0, 600) : "" };
}

/** Ask Claude a question with no image; JSON answer. */
export async function askText<T>(db: SupabaseClient, system: string, question: string, maxTokens = 1200, effort?: "low" | "medium" | "high"): Promise<T | null> {
  return ask<T>(db, system, [{ type: "text", text: question }], maxTokens, effort);
}

/** Ask Claude about one or more images with a question; JSON answer. Used by the Image Studio skill. */
export async function askVision<T>(db: SupabaseClient, system: string, images: Array<{ url: string; label: string; maxSide?: number }>, question: string, maxTokens = 1200, effort?: "low" | "medium" | "high"): Promise<T | null> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const img of images) {
    const b = await imageBlock(img.url, img.maxSide);
    if (b) blocks.push({ type: "text", text: img.label }, b);
  }
  if (blocks.length === 0) return null;
  blocks.push({ type: "text", text: question });
  return ask<T>(db, system, blocks, maxTokens, effort);
}
