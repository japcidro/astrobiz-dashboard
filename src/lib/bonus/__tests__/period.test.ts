import { describe, it, expect } from "vitest";
import {
  addDays,
  daysBetween,
  daysInMonth,
  getBonusPeriod,
  getPreviousBonusPeriod,
  periodDays,
  phtToday,
} from "../period";
import { computeTierProgress, tierForAverage } from "../tiers";
import type { BonusTier } from "../types";

const TIERS: BonusTier[] = [
  { id: "t1", parcel_threshold: 70, bonus_amount: 500, label: "Tier 1", is_active: true },
  { id: "t2", parcel_threshold: 100, bonus_amount: 1000, label: "Tier 2", is_active: true },
  { id: "t3", parcel_threshold: 130, bonus_amount: 1500, label: "Tier 3", is_active: true },
];

describe("date helpers", () => {
  it("counts days in a month, including leap February", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-09-02", -29)).toBe("2026-08-04");
  });

  it("measures whole days between dates", () => {
    expect(daysBetween("2026-09-01", "2026-09-15")).toBe(14);
    expect(daysBetween("2026-09-15", "2026-09-01")).toBe(-14);
  });

  it("resolves today in PHT, not UTC", () => {
    // 2026-09-02 17:00 UTC is already 2026-09-03 in Manila.
    expect(phtToday(new Date("2026-09-02T17:00:00Z"))).toBe("2026-09-03");
    expect(phtToday(new Date("2026-09-02T15:59:00Z"))).toBe("2026-09-02");
  });
});

describe("getBonusPeriod", () => {
  it("puts days 1-15 in the first-half cutoff", () => {
    const p = getBonusPeriod("2026-09-08");
    expect(p.start).toBe("2026-09-01");
    expect(p.end).toBe("2026-09-15");
    expect(p.days_total).toBe(15);
    expect(p.days_elapsed).toBe(8);
    expect(p.days_remaining).toBe(7);
    expect(p.is_complete).toBe(false);
  });

  it("puts day 16 onward in the second-half cutoff, ending on the last day", () => {
    const p = getBonusPeriod("2026-09-20");
    expect(p.start).toBe("2026-09-16");
    expect(p.end).toBe("2026-09-30"); // September has 30 days
    expect(p.days_total).toBe(15);
    expect(p.days_elapsed).toBe(5);
  });

  it("handles the 31-day and short-February second halves", () => {
    expect(getBonusPeriod("2026-01-20").end).toBe("2026-01-31");
    expect(getBonusPeriod("2026-01-20").days_total).toBe(16);
    expect(getBonusPeriod("2026-02-20").end).toBe("2026-02-28");
    expect(getBonusPeriod("2026-02-20").days_total).toBe(13);
  });

  it("marks a closed period complete with the full day count elapsed", () => {
    const p = getBonusPeriod("2026-09-10", "2026-09-25");
    expect(p.days_elapsed).toBe(15);
    expect(p.days_remaining).toBe(0);
    expect(p.is_complete).toBe(true);
  });

  it("caps elapsed days on the cutoff day itself", () => {
    const p = getBonusPeriod("2026-09-15");
    expect(p.days_elapsed).toBe(15);
    expect(p.days_remaining).toBe(0);
    expect(p.is_complete).toBe(false);
  });

  it("lists every calendar day in the period", () => {
    const days = periodDays(getBonusPeriod("2026-09-08"));
    expect(days).toHaveLength(15);
    expect(days[0]).toBe("2026-09-01");
    expect(days.at(-1)).toBe("2026-09-15");
  });
});

describe("getPreviousBonusPeriod", () => {
  it("steps back from the second half to the first half of the same month", () => {
    const p = getPreviousBonusPeriod("2026-09-20");
    expect(p.start).toBe("2026-09-01");
    expect(p.end).toBe("2026-09-15");
  });

  it("steps back from the first half into the previous month's second half", () => {
    const p = getPreviousBonusPeriod("2026-09-05");
    expect(p.start).toBe("2026-08-16");
    expect(p.end).toBe("2026-08-31");
  });

  it("crosses the year boundary", () => {
    const p = getPreviousBonusPeriod("2026-01-05");
    expect(p.start).toBe("2025-12-16");
    expect(p.end).toBe("2025-12-31");
  });
});

describe("tierForAverage", () => {
  it("returns the highest tier cleared", () => {
    expect(tierForAverage(69.9, TIERS)).toBeNull();
    expect(tierForAverage(70, TIERS)?.id).toBe("t1");
    expect(tierForAverage(129, TIERS)?.id).toBe("t2");
    expect(tierForAverage(400, TIERS)?.id).toBe("t3");
  });

  it("ignores inactive tiers", () => {
    const tiers = TIERS.map((t) =>
      t.id === "t2" ? { ...t, is_active: false } : t
    );
    expect(tierForAverage(110, tiers)?.id).toBe("t1");
  });
});

describe("computeTierProgress", () => {
  it("computes the pace needed against the FULL period, not just elapsed days", () => {
    // Day 8 of 15, averaging 60/day (480 parcels). Tier 2 = 100/day
    // needs 1500 for the period, so 1020 more across 7 days ≈ 146/day.
    const period = getBonusPeriod("2026-09-08");
    const p = computeTierProgress(60, 480, period, TIERS);

    expect(p.current_tier).toBeNull();
    expect(p.next_tier?.id).toBe("t1");
    expect(p.to_next?.parcels_needed).toBe(70 * 15 - 480); // 570
    expect(p.to_next?.per_remaining_day).toBeCloseTo(570 / 7, 5);
  });

  it("reports zero needed when the next tier is already mathematically locked", () => {
    const period = getBonusPeriod("2026-09-08");
    // 1200 parcels banked already exceeds 70 × 15 = 1050.
    const p = computeTierProgress(150, 1200, period, TIERS);
    expect(p.current_tier?.id).toBe("t3");
    expect(p.next_tier).toBeNull();
    expect(p.progress_pct).toBe(100);
  });

  it("scales progress between the held tier and the next one", () => {
    const period = getBonusPeriod("2026-09-08");
    const p = computeTierProgress(85, 680, period, TIERS);
    expect(p.current_tier?.id).toBe("t1");
    expect(p.next_tier?.id).toBe("t2");
    // Halfway from 70 to 100.
    expect(p.progress_pct).toBeCloseTo(50, 5);
  });

  it("drops the pace hint once the cutoff has passed", () => {
    const period = getBonusPeriod("2026-09-10", "2026-09-25");
    const p = computeTierProgress(80, 1200, period, TIERS);
    expect(p.current_tier?.id).toBe("t1");
    expect(p.next_tier?.id).toBe("t2");
    expect(p.to_next).toBeNull();
  });

  it("returns no tier and no progress when no tiers are configured", () => {
    const period = getBonusPeriod("2026-09-08");
    const p = computeTierProgress(200, 1600, period, []);
    expect(p.current_tier).toBeNull();
    expect(p.next_tier).toBeNull();
    expect(p.progress_pct).toBe(0);
  });
});
