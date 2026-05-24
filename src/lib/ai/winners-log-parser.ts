// Splits the Winners Ad Log markdown into per-entry chunks + closing
// sections (Patterns Observed, Anti-Collapse Rule + Untested Territory)
// so the UI can render each entry as a card with badges (Result,
// Compliance Flag count) instead of one giant <pre> block.
//
// Each entry per the v2.0 spec starts with "## ENTRY: <name>". Closing
// sections start with "## PATTERNS OBSERVED" and "## ANTI-COLLAPSE RULE".

export type LogResult = "WINNER" | "LOSER" | "INCONCLUSIVE" | "UNKNOWN";

export interface LogEntry {
  title: string;            // text after "## ENTRY:"
  markdown: string;         // entry body markdown
  result: LogResult;
  compliance_flags_count: number;
}

export interface ParsedLog {
  entries: LogEntry[];
  patterns_markdown: string;       // body of "## PATTERNS OBSERVED" section
  anti_collapse_markdown: string;  // body of "## ANTI-COLLAPSE RULE" section
  preamble_markdown: string;       // anything before the first ENTRY (rare)
}

const ENTRY_HEADING = /^##\s+ENTRY:\s*(.+)$/i;
const PATTERNS_HEADING = /^##\s+PATTERNS\s+OBSERVED\b/i;
const ANTI_COLLAPSE_HEADING = /^##\s+ANTI[\s-]?COLLAPSE\b/i;

function detectResult(entryMd: string): LogResult {
  // Look for "Result: WINNER" / "Result: LOSER" / "Result: INCONCLUSIVE"
  // anywhere in the entry. Case-insensitive. Stripped of any markdown
  // emphasis around the word.
  const re = /Result:\s*\**\s*(WINNER|LOSER|INCONCLUSIVE|MIXED)/i;
  const m = entryMd.match(re);
  if (!m) return "UNKNOWN";
  const v = m[1].toUpperCase();
  if (v === "MIXED") return "INCONCLUSIVE";
  return v as LogResult;
}

function countComplianceFlags(entryMd: string): number {
  // The v2.0 spec asks the model to output "COMPLIANT" or "WINS — but carries N
  // flag(s): <list>" in BLOCK 6. Prefer the model's own count if present; fall
  // back to counting "FLAG"-prefixed lines in the BLOCK 6 region only so we
  // don't pick up the word "FLAG" used elsewhere.
  //
  // First, try to find the explicit "carries N flag" number.
  const countRe = /carries\s+(\d+)\s+flag/i;
  const m = entryMd.match(countRe);
  if (m) return parseInt(m[1], 10);

  // Otherwise locate BLOCK 6 and count "FLAG" line-starts in it.
  const block6Start = entryMd.search(/###?\s+BLOCK\s+6\b/i);
  if (block6Start === -1) return 0;
  const block6End = entryMd.indexOf("BLOCK 7", block6Start);
  const segment =
    block6End === -1
      ? entryMd.slice(block6Start)
      : entryMd.slice(block6Start, block6End);
  const flagLineRe = /(?:^|\n)\s*[*-]?\s*\**FLAG\b/gi;
  return (segment.match(flagLineRe) ?? []).length;
}

export function parseWinnersLog(markdown: string): ParsedLog {
  const lines = markdown.split("\n");
  const entries: LogEntry[] = [];
  const buffer: { title: string; lines: string[] } = { title: "", lines: [] };
  const closing = { patterns: [] as string[], antiCollapse: [] as string[] };
  const preamble: string[] = [];

  type Section = "preamble" | "entry" | "patterns" | "antiCollapse";
  let section: Section = "preamble";

  const flushEntry = () => {
    if (!buffer.title) return;
    const md = buffer.lines.join("\n").trim();
    entries.push({
      title: buffer.title,
      markdown: md,
      result: detectResult(md),
      compliance_flags_count: countComplianceFlags(md),
    });
    buffer.title = "";
    buffer.lines = [];
  };

  for (const line of lines) {
    const entryMatch = line.match(ENTRY_HEADING);
    if (entryMatch) {
      flushEntry();
      buffer.title = entryMatch[1].trim();
      section = "entry";
      continue;
    }
    if (PATTERNS_HEADING.test(line)) {
      flushEntry();
      section = "patterns";
      continue;
    }
    if (ANTI_COLLAPSE_HEADING.test(line)) {
      flushEntry();
      section = "antiCollapse";
      continue;
    }
    switch (section) {
      case "preamble":
        preamble.push(line);
        break;
      case "entry":
        buffer.lines.push(line);
        break;
      case "patterns":
        closing.patterns.push(line);
        break;
      case "antiCollapse":
        closing.antiCollapse.push(line);
        break;
    }
  }
  flushEntry();

  return {
    entries,
    patterns_markdown: closing.patterns.join("\n").trim(),
    anti_collapse_markdown: closing.antiCollapse.join("\n").trim(),
    preamble_markdown: preamble.join("\n").trim(),
  };
}
