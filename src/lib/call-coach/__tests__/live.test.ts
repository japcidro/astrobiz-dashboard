import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { transcribeAudio } from "../transcribe";
import { askReview, buildTimeline, phClock } from "../review";
import { DEFAULT_RUBRIC } from "../shared";

/**
 * Live pipeline check against the real Gemini and Claude APIs, using the keys
 * the dashboard keeps in app_settings and two synthetic Taglish call clips.
 * Skipped unless CALL_COACH_LIVE=1 and CALL_COACH_AUDIO_DIR point at the clips:
 *
 *   CALL_COACH_LIVE=1 CALL_COACH_AUDIO_DIR=/path/with/segA.webm npx vitest run src/lib/call-coach/__tests__/live.test.ts
 */
const live = process.env.CALL_COACH_LIVE === "1" && !!process.env.CALL_COACH_AUDIO_DIR;

async function keysFromDb(): Promise<{ gemini: string; anthropic: string }> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* already loaded */
  }
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows } = await client.query("select key, value from app_settings where key in ('gemini_api_key','anthropic_api_key')");
  await client.end();
  const by = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
  return { gemini: by.gemini_api_key, anthropic: by.anthropic_api_key };
}

describe.skipIf(!live)("call coach live pipeline", () => {
  it(
    "transcribes two clips with Gemini and reviews the day with Claude",
    async () => {
      const dir = process.env.CALL_COACH_AUDIO_DIR!;
      const keys = await keysFromDb();
      expect(keys.gemini).toBeTruthy();
      expect(keys.anthropic).toBeTruthy();

      const clips = ["segA.webm", "segB.webm"].filter((f) => existsSync(`${dir}/${f}`));
      expect(clips.length).toBeGreaterThan(0);

      // Pretend the clips were recorded at 10:00 and 10:03 Manila time.
      const date = "2026-10-20";
      const starts = ["2026-10-20T02:00:00.000Z", "2026-10-20T02:03:00.000Z"];
      const segments = [];
      for (let i = 0; i < clips.length; i++) {
        const bytes = new Uint8Array(readFileSync(`${dir}/${clips[i]}`));
        const t = await transcribeAudio(keys.gemini, bytes, "audio/webm");
        console.log(`--- ${clips[i]} (${t.language}, ${t.tokens} tokens)\n${t.text}`);
        expect(t.turns.length).toBeGreaterThan(2);
        segments.push({
          id: `seg-${i}`,
          started_at: starts[i],
          ended_at: new Date(new Date(starts[i]).getTime() + 60_000).toISOString(),
          voice_seconds: 45,
          status: "transcribed",
          turns: t.turns,
        });
      }

      const timeline = buildTimeline(segments, [
        { id: "e1", kind: "started", at: "2026-10-20T01:59:30.000Z", detail: null },
      ]);
      expect(timeline).toContain(`[${phClock(starts[0])}]`);
      console.log(`--- timeline\n${timeline}`);

      const user = `VA: Test VA\nShift date (Manila): ${date}\nStores they confirm orders for: I Love Patches, Capsuled\nTranscribed minutes: ${segments.length}\n\nTRANSCRIPT\n${timeline}`;
      const asked = await askReview(keys.anthropic, DEFAULT_RUBRIC, user);
      if ("error" in asked) throw new Error(asked.error);
      writeFileSync(`${dir}/review.json`, JSON.stringify({ timeline, ...asked }, null, 2));
      console.log(`--- review (${asked.usage.input_tokens} in / ${asked.usage.output_tokens} out)\n${JSON.stringify(asked.output, null, 2)}`);

      expect(asked.output.calls.length).toBeGreaterThanOrEqual(clips.length);
      for (const call of asked.output.calls) {
        expect(call.start).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
        expect(timeline).toContain(`[${call.start.padStart(8, "0")}]`);
      }
    },
    240_000,
  );
});
