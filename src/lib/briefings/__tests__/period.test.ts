import { describe, it, expect } from "vitest";
import { getPeriod, phtDateString } from "../period";

// Guards the April 2026 bug where phtDateString double-applied a +8h
// offset on already-pre-shifted Dates, making evening briefings query
// tomorrow's date (and so returning all-zero revenue / orders / ROAS).
// Date boundary math here should be tied to PHT calendar days regardless
// of when the cron actually fires (UTC).
describe("getPeriod + phtDateString (PHT correctness)", () => {
  function range(type: Parameters<typeof getPeriod>[0], now: Date) {
    const p = getPeriod(type, now);
    return {
      start: phtDateString(p.start),
      end: phtDateString(p.end),
      dateFilter: p.dateFilter,
    };
  }

  it("morning cron at 22:00 UTC → yesterday in PHT", () => {
    // 22:00 UTC Apr 23 = 06:00 PHT Apr 24. Yesterday = Apr 23.
    expect(range("morning", new Date("2026-04-23T22:00:00Z"))).toEqual({
      start: "2026-04-23",
      end: "2026-04-23",
      dateFilter: "yesterday",
    });
  });

  it("evening cron at 14:00 UTC → today in PHT (prev bug: returned tomorrow)", () => {
    // 14:00 UTC Apr 24 = 22:00 PHT Apr 24. Today = Apr 24.
    expect(range("evening", new Date("2026-04-24T14:00:00Z"))).toEqual({
      start: "2026-04-24",
      end: "2026-04-24",
      dateFilter: "today",
    });
  });

  it("manual morning rerun at 19:00 PHT → still yesterday", () => {
    // 11:00 UTC Apr 24 = 19:00 PHT Apr 24. Yesterday = Apr 23.
    // Prev bug: returned Apr 24 (today) because late-day PHT pushed +8h
    // past the UTC day boundary on a pre-shifted Date.
    expect(range("morning", new Date("2026-04-24T11:00:00Z"))).toEqual({
      start: "2026-04-23",
      end: "2026-04-23",
      dateFilter: "yesterday",
    });
  });

  it("weekly cron Monday 01:00 UTC → Mon→Sun preceding week", () => {
    // 01:00 UTC Mon Apr 27 = 09:00 PHT Mon. End = yesterday = Sun Apr 26.
    expect(range("weekly", new Date("2026-04-27T01:00:00Z"))).toEqual({
      start: "2026-04-20",
      end: "2026-04-26",
      dateFilter: "last_7d",
    });
  });

  it("monthly cron May 1st 01:00 UTC → Apr 1 to Apr 30", () => {
    // 01:00 UTC May 1 = 09:00 PHT May 1. End = yesterday = Apr 30.
    expect(range("monthly", new Date("2026-05-01T01:00:00Z"))).toEqual({
      start: "2026-04-01",
      end: "2026-04-30",
      dateFilter: "last_30d",
    });
  });

  it("evening rerun at 23:59 PHT → today (boundary case)", () => {
    // 15:59 UTC Apr 24 = 23:59 PHT Apr 24. Must still be Apr 24.
    expect(range("evening", new Date("2026-04-24T15:59:00Z"))).toEqual({
      start: "2026-04-24",
      end: "2026-04-24",
      dateFilter: "today",
    });
  });

  it("morning rerun at 00:01 PHT → yesterday (boundary case)", () => {
    // 16:01 UTC Apr 23 = 00:01 PHT Apr 24. Yesterday = Apr 23.
    expect(range("morning", new Date("2026-04-23T16:01:00Z"))).toEqual({
      start: "2026-04-23",
      end: "2026-04-23",
      dateFilter: "yesterday",
    });
  });

  it("phtDateString on a backfill-style Date (noon PHT anchor)", () => {
    // Admin backfill builds Dates via new Date("YYYY-MM-DDT12:00:00+08:00").
    // phtDateString must round-trip to the same calendar date.
    expect(phtDateString(new Date("2026-04-22T12:00:00+08:00"))).toBe(
      "2026-04-22"
    );
    expect(phtDateString(new Date("2026-04-22T00:00:00+08:00"))).toBe(
      "2026-04-22"
    );
    expect(phtDateString(new Date("2026-04-22T23:59:00+08:00"))).toBe(
      "2026-04-22"
    );
  });
});
