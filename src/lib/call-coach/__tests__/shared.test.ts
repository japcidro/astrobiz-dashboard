import { describe, expect, it } from "vitest";
import { formatMinutes, phDate } from "../shared";

describe("phDate", () => {
  it("rolls to the next day at 4 PM UTC (midnight in Manila)", () => {
    expect(phDate(new Date("2026-10-20T15:59:00Z"))).toBe("2026-10-20");
    expect(phDate(new Date("2026-10-20T16:00:00Z"))).toBe("2026-10-21");
  });
});

describe("formatMinutes", () => {
  it("rounds seconds to minutes and shows hours past 60", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(89)).toBe("1 min");
    expect(formatMinutes(3 * 3600 + 7 * 60)).toBe("3h 07m");
  });
});

describe("phWeekStart", () => {
  it("returns the Monday of the week, Monday through Sunday", async () => {
    const { phWeekStart, addDays } = await import("../shared");
    expect(phWeekStart("2026-10-20")).toBe("2026-10-19"); // a Tuesday
    expect(phWeekStart("2026-10-19")).toBe("2026-10-19"); // Monday stays
    expect(phWeekStart("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(addDays("2026-10-19", 6)).toBe("2026-10-25");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});
