// Splits the ILP deconstruction engine's markdown output into the 8 zones
// the UI renders as collapsible cards. The model emits "## ZONE A — ..."
// headings per the spec; we slice on those and pull a few signals
// (ad_origin, flag count, ad title) out of the structured-but-flexible text.

export type ZoneId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

const ZONE_TITLES: Record<ZoneId, string> = {
  A: "SNAPSHOT",
  B: "STRUCTURAL ANATOMY",
  C: "ILP SYSTEM MAPPING",
  D: "AVATAR DECODE",
  E: "MECHANISM FIDELITY",
  F: "COMPLIANCE AUDIT",
  G: "VERBATIM LANGUAGE BANK",
  H: "MARKETER TAKEAWAYS",
};

const ZONE_LABEL_PATTERN = /^##?\s*ZONE\s+([A-H])\s*[—–-]\s*(.+)$/i;

export interface ParsedZone {
  id: ZoneId;
  title: string; // model-supplied title (may include "ADAPTATION GAP")
  markdown: string;
}

export interface ParsedDeconstruction {
  zones: Record<ZoneId, ParsedZone>;
  ad_origin: string | null;        // ILP_REFERENCE / ILP_DRAFT / COMPETITOR / OTHER
  ad_title: string | null;          // extracted from Zone A
  compliance_flags_count: number;   // count of "FLAG" occurrences in Zones E + F
  one_takeaway: string | null;      // final line of Zone H
}

// Build a Record where every zone id has at least an empty entry, so the UI
// doesn't have to null-guard every zone access.
function emptyZones(): Record<ZoneId, ParsedZone> {
  const z = {} as Record<ZoneId, ParsedZone>;
  for (const id of Object.keys(ZONE_TITLES) as ZoneId[]) {
    z[id] = { id, title: ZONE_TITLES[id], markdown: "" };
  }
  return z;
}

function extractAdOrigin(zoneAMd: string): string | null {
  // Look for "Ad Origin: <VALUE>" — the spec instructs the model to put this
  // on its own line. Be lenient about bullet markers and bolding.
  const re = /(?:^|\n)\s*[*-]?\s*\**Ad Origin:?\**\s*([A-Z_]+)/m;
  const match = zoneAMd.match(re);
  if (!match) return null;
  const val = match[1].trim().toUpperCase();
  if (
    val === "ILP_REFERENCE" ||
    val === "ILP_DRAFT" ||
    val === "COMPETITOR" ||
    val === "OTHER"
  ) {
    return val;
  }
  return null;
}

function extractAdTitle(zoneAMd: string): string | null {
  // Look for "Ad ID / title" / "Ad title:" / first sentence of fingerprint.
  const titleRe = /(?:^|\n)\s*[*-]?\s*\**Ad (?:ID\s*\/\s*title|title):?\**\s*(.+?)(?:\n|$)/im;
  const m = zoneAMd.match(titleRe);
  if (m && m[1].trim()) return m[1].trim().slice(0, 200);
  return null;
}

function countComplianceFlags(zoneEMd: string, zoneFMd: string): number {
  // Count lines that START with "FLAG" (case-insensitive) in Zones E and F.
  // The spec instructs the model to begin each checklist line with PASS/FLAG/N-A.
  const re = /(?:^|\n)\s*[*-]?\s*\**FLAG\**/gim;
  const e = zoneEMd.match(re) ?? [];
  const f = zoneFMd.match(re) ?? [];
  return e.length + f.length;
}

function extractOneTakeaway(zoneHMd: string): string | null {
  // Use [\s\S] instead of the `s` flag for broader TS target compatibility.
  const re = /(?:^|\n)\s*\**THE ONE TAKEAWAY:?\**\s*([\s\S]+?)(?:\n\n|\n##|$)/i;
  const m = zoneHMd.match(re);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, " ").slice(0, 500);
}

export function parseDeconstruction(markdown: string): ParsedDeconstruction {
  const zones = emptyZones();

  // Split the document by lines and walk forward, accumulating into the
  // current zone until the next "ZONE X —" heading appears.
  const lines = markdown.split("\n");
  let currentId: ZoneId | null = null;
  const buffer: Record<ZoneId, string[]> = {} as Record<ZoneId, string[]>;
  for (const id of Object.keys(ZONE_TITLES) as ZoneId[]) {
    buffer[id] = [];
  }

  for (const line of lines) {
    const m = line.match(ZONE_LABEL_PATTERN);
    if (m) {
      const id = m[1].toUpperCase() as ZoneId;
      const title = m[2].trim();
      if (zones[id]) {
        currentId = id;
        zones[id].title = title;
      } else {
        currentId = null;
      }
      continue;
    }
    if (currentId) {
      buffer[currentId].push(line);
    }
  }

  for (const id of Object.keys(ZONE_TITLES) as ZoneId[]) {
    zones[id].markdown = buffer[id].join("\n").trim();
  }

  return {
    zones,
    ad_origin: extractAdOrigin(zones.A.markdown),
    ad_title: extractAdTitle(zones.A.markdown),
    compliance_flags_count: countComplianceFlags(
      zones.E.markdown,
      zones.F.markdown
    ),
    one_takeaway: extractOneTakeaway(zones.H.markdown),
  };
}
