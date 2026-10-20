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
