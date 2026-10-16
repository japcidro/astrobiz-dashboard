/**
 * A transcript as a person reads it: the spoken words only, one sentence
 * per line. Timestamps and [ON-SCREEN: …] captions are dropped here; the
 * page keeps the full transcript hidden and sends it to the skill, which
 * reads those markers as pacing and captions.
 */
export function cleanScript(raw: string): string {
  const spoken = raw
    .replace(/\[ON-SCREEN:[^\]]*\]/gi, " ")
    .replace(/(^|\s)\d{1,2}:\d{2}(?=\s|$)/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  const sentences = spoken
    .split(/(?<=[.!?…])\s+(?=[^a-z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.join("\n");
}

/** Whether a transcript carries details the clean view hides. */
export const hasHiddenDetails = (raw: string) => /\[ON-SCREEN:|(^|\s)\d{1,2}:\d{2}(\s|$)/i.test(raw);
