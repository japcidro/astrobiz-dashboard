import { describe, expect, it } from "vitest";
import { ARCHIVE_AFTER_MS, archiveCutoff, isArchived } from "../types";

const now = Date.parse("2026-10-16T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("Marketing Board archive", () => {
  it("keeps a Done card on the board for 12 hours", () => {
    expect(isArchived({ status: "done", done_at: ago(ARCHIVE_AFTER_MS - 60_000) }, now)).toBe(false);
  });

  it("archives a Done card once 12 hours have passed", () => {
    expect(isArchived({ status: "done", done_at: ago(ARCHIVE_AFTER_MS) }, now)).toBe(true);
    expect(isArchived({ status: "done", done_at: ago(3 * 86400_000) }, now)).toBe(true);
  });

  it("never archives cards that are not Done", () => {
    expect(isArchived({ status: "todo", done_at: null }, now)).toBe(false);
    expect(isArchived({ status: "in_progress", done_at: ago(3 * 86400_000) }, now)).toBe(false);
  });

  it("archives a Done card with no finish time rather than losing it", () => {
    expect(isArchived({ status: "done", done_at: null }, now)).toBe(true);
  });

  it("puts the cutoff 12 hours back", () => {
    expect(archiveCutoff(now)).toBe("2026-10-16T00:00:00.000Z");
  });
});
