import { describe, expect, it } from "vitest";
import { buildTimeline, callSource, phClock } from "../review";

const seg = (startedAt: string, minutes: number, extra: Partial<Parameters<typeof buildTimeline>[0][number]> = {}) => ({
  id: startedAt,
  started_at: startedAt,
  ended_at: new Date(new Date(startedAt).getTime() + minutes * 60_000).toISOString(),
  voice_seconds: minutes * 50,
  status: "transcribed",
  turns: [{ t: 2, speaker: "va" as const, text: "Hello po" }],
  ...extra,
});

describe("buildTimeline with phone uploads", () => {
  it("wraps a phone recording in open and close markers with its reference", () => {
    const lines = buildTimeline(
      [seg("2026-10-21T02:00:00.000Z", 1), seg("2026-10-21T02:10:00.000Z", 3, { source: "phone_upload", reference: "1234" })],
      [],
    ).split("\n");
    expect(lines[0]).toBe("[10:00:02] VA: Hello po");
    expect(lines).toContain("(quiet for 9 min)");
    expect(lines).toContain("[10:10:00] (phone call recording uploaded by the VA, for 1234, 3 min)");
    expect(lines).toContain("[10:10:02] VA: Hello po");
    expect(lines).toContain("[10:13:00] (end of phone recording)");
  });

  it("leaves PC-mic minutes unmarked", () => {
    expect(buildTimeline([seg("2026-10-21T02:00:00.000Z", 1)], [])).not.toContain("phone");
  });
});

describe("callSource", () => {
  const segments = [seg("2026-10-21T02:00:00.000Z", 1), seg("2026-10-21T02:10:00.000Z", 3, { source: "phone_upload" })];
  it("is phone_upload for a call that starts inside a phone recording, with a minute of slack", () => {
    expect(callSource(segments, "2026-10-21T02:11:30.000Z")).toBe("phone_upload");
    expect(callSource(segments, "2026-10-21T02:09:10.000Z")).toBe("phone_upload");
    expect(callSource(segments, "2026-10-21T02:13:50.000Z")).toBe("phone_upload");
  });
  it("is pc_mic everywhere else", () => {
    expect(callSource(segments, "2026-10-21T02:00:30.000Z")).toBe("pc_mic");
    expect(callSource(segments, "2026-10-21T02:20:00.000Z")).toBe("pc_mic");
    expect(phClock("2026-10-21T02:20:00.000Z")).toBe("10:20:00");
  });
});
