// Parses Script Creator AI output into structured script records.
// The Script Creator system prompt (stored in ai_store_docs) instructs the model
// to emit one or more blocks in this shape:
//
//   ## SCRIPT 1 — Daily cap switching anxiety ends
//   **Avatar:** Male commuter, 26-34 | **Type:** D | **Intensity:** 9 | **Capacity:** 8
//
//   **HOOK:**
//   <hook line>
//
//   **BODY SCRIPT:**
//   <voiceover body, possibly multiple paragraphs>
//
//   **VARIANT HOOKS:**
//   1. alt hook one
//   2. alt hook two
//   3. alt hook three
//
//   ---
//
// This parser is defensive: it tolerates emoji dashes, missing metadata rows,
// variant-hook prefixes that differ ("1)", "-", "•"), and content-after-marker
// on the same line. It returns [] when nothing parseable is found so callers
// can fall back to rendering the raw message.

export interface ParsedScript {
  script_number: number | null;
  angle_title: string;
  avatar: string | null;
  angle_type: "D" | "E" | "M" | "B" | null;
  intensity: number | null;
  capacity: number | null;
  hook: string;
  body_script: string;
  variant_hooks: string[];
}

const SCRIPT_HEADER = /^##\s+SCRIPT\s+(\d+)?\s*[—–\-:]?\s*(.+?)\s*$/im;

export function parseScripts(raw: string): ParsedScript[] {
  if (!raw || typeof raw !== "string") return [];

  // Split into blocks by `## SCRIPT N` headings. The first chunk (preamble
  // before the first header) is discarded if it doesn't look like a script.
  const blocks = splitByScriptHeader(raw);
  const scripts: ParsedScript[] = [];

  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed) scripts.push(parsed);
  }

  return scripts;
}

function splitByScriptHeader(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  let seenHeader = false;

  for (const line of lines) {
    if (SCRIPT_HEADER.test(line)) {
      if (seenHeader && current.length > 0) {
        blocks.push(current.join("\n"));
      }
      current = [line];
      seenHeader = true;
    } else if (seenHeader) {
      current.push(line);
    }
  }

  if (seenHeader && current.length > 0) {
    blocks.push(current.join("\n"));
  }

  return blocks;
}

function parseBlock(block: string): ParsedScript | null {
  const lines = block.split(/\r?\n/);
  const headerLine = lines.shift() ?? "";
  const headerMatch = SCRIPT_HEADER.exec(headerLine);
  if (!headerMatch) return null;

  const scriptNumber = headerMatch[1] ? parseInt(headerMatch[1], 10) : null;
  const angleTitle = stripMarkdown(headerMatch[2] ?? "").trim();
  if (!angleTitle) return null;

  // Remainder joined back for section extraction
  const body = lines.join("\n");

  const metadata = parseMetadataRow(body);
  const hook = extractSection(body, "HOOK");
  const bodyScript = extractSection(body, "BODY SCRIPT");
  const variantBlock = extractSection(body, "VARIANT HOOKS");
  const variantHooks = parseVariantHooks(variantBlock);

  if (!hook || !bodyScript) {
    // Incomplete script — skip rather than save a broken record.
    return null;
  }

  return {
    script_number: scriptNumber,
    angle_title: angleTitle,
    avatar: metadata.avatar,
    angle_type: metadata.angle_type,
    intensity: metadata.intensity,
    capacity: metadata.capacity,
    hook,
    body_script: bodyScript,
    variant_hooks: variantHooks,
  };
}

interface MetadataFields {
  avatar: string | null;
  angle_type: "D" | "E" | "M" | "B" | null;
  intensity: number | null;
  capacity: number | null;
}

function parseMetadataRow(body: string): MetadataFields {
  const result: MetadataFields = {
    avatar: null,
    angle_type: null,
    intensity: null,
    capacity: null,
  };

  const avatarMatch = /\*\*Avatar:\*\*\s*([^|\n]+)/i.exec(body);
  if (avatarMatch) result.avatar = avatarMatch[1].trim();

  const typeMatch = /\*\*Type:\*\*\s*([DEMB])/i.exec(body);
  if (typeMatch) {
    result.angle_type = typeMatch[1].toUpperCase() as "D" | "E" | "M" | "B";
  }

  const intensityMatch = /\*\*Intensity:\*\*\s*(\d+)/i.exec(body);
  if (intensityMatch) {
    const n = parseInt(intensityMatch[1], 10);
    if (n >= 1 && n <= 10) result.intensity = n;
  }

  const capacityMatch = /\*\*Capacity:\*\*\s*(\d+)/i.exec(body);
  if (capacityMatch) {
    const n = parseInt(capacityMatch[1], 10);
    if (n >= 1 && n <= 10) result.capacity = n;
  }

  return result;
}

// Extracts the text that belongs to `**MARKER:**` until the next `**MARKER:**`
// or end-of-block terminator (horizontal rule, next script header).
function extractSection(body: string, marker: string): string {
  const sectionRegex = new RegExp(
    `\\*\\*${escapeRegex(marker)}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[A-Z][^*]*:\\*\\*|\\n---|\\n##\\s+SCRIPT|$)`,
    "i"
  );
  const match = sectionRegex.exec(body);
  if (!match) return "";
  return stripMarkdown(match[1]).trim();
}

function parseVariantHooks(block: string): string[] {
  if (!block) return [];
  const lines = block.split(/\r?\n/);
  const hooks: string[] = [];

  for (const line of lines) {
    const cleaned = line
      .replace(/^\s*(\d+[\.\)]|[-•*])\s+/, "")
      .trim();
    if (!cleaned) continue;
    hooks.push(cleaned);
  }

  return hooks;
}

function stripMarkdown(s: string): string {
  // Remove bold/italic markers but keep inner text
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
