import { describe, it, expect } from "vitest";
import {
  JT_STALE_AFTER_HOURS,
  jtDataAgeHours,
  isJtDataStale,
  formatJtDataAge,
  formatJtAsOf,
} from "../freshness";

const FRI_UPLOAD = "2026-10-30T17:12:00+08:00";
const FRI_5PM = Date.parse(FRI_UPLOAD);
const HOUR = 3_600_000;

describe("J&T data age", () => {
  it("counts whole hours since the last upload", () => {
    expect(jtDataAgeHours(FRI_UPLOAD, FRI_5PM + 3.9 * HOUR)).toBe(3);
  });

  it("is unknown without a timestamp", () => {
    expect(jtDataAgeHours(null, FRI_5PM)).toBeNull();
    expect(jtDataAgeHours(undefined, FRI_5PM)).toBeNull();
    expect(jtDataAgeHours("not a date", FRI_5PM)).toBeNull();
  });

  it("never goes negative when the clock is behind the upload", () => {
    expect(jtDataAgeHours(FRI_UPLOAD, FRI_5PM - HOUR)).toBe(0);
  });
});

describe("Stale J&T data", () => {
  it("is fresh within the threshold", () => {
    const justUnder = FRI_5PM + (JT_STALE_AFTER_HOURS - 1) * HOUR;
    expect(isJtDataStale(FRI_UPLOAD, justUnder)).toBe(false);
  });

  it("is stale once the threshold is reached: a Friday upload read on Sunday", () => {
    const SUN_NOON = Date.parse("2026-11-01T12:00:00+08:00");
    expect(isJtDataStale(FRI_UPLOAD, SUN_NOON)).toBe(true);
  });

  it("is not stale when there is no upload to judge", () => {
    expect(isJtDataStale(null, FRI_5PM)).toBe(false);
  });
});

describe("formatJtDataAge", () => {
  it("speaks in hours under a day and days after", () => {
    expect(formatJtDataAge(1)).toBe("1 hour");
    expect(formatJtDataAge(5)).toBe("5 hours");
    expect(formatJtDataAge(24)).toBe("1 day");
    expect(formatJtDataAge(42)).toBe("1 day");
    expect(formatJtDataAge(48)).toBe("2 days");
  });
});

describe("formatJtAsOf", () => {
  it("prints Philippine time", () => {
    expect(formatJtAsOf("2026-10-30T09:12:00Z")).toBe("Oct 30, 5:12 PM");
    expect(formatJtAsOf("2026-10-30T09:12:00Z", { dateOnly: true })).toBe("Oct 30");
  });

  it("falls back to the raw string for an unreadable timestamp", () => {
    expect(formatJtAsOf("garbage")).toBe("garbage");
  });
});
