import { describe, it, expect } from "vitest";
import {
  addDays,
  cppTone,
  computeMetrics,
  daysBetween,
  launchDateOf,
  reviewStateOf,
  verdictOf,
  windowFromStart,
  type DailyRow,
} from "../launched-creatives";

function day(date: string, spend: number, purchases: number, impressions = 1000): DailyRow {
  return {
    date,
    spend,
    purchases,
    purchase_value: purchases * 900,
    add_to_cart: purchases * 2,
    link_clicks: 20,
    landing_page_views: 15,
    impressions,
    reach: impressions,
  };
}

describe("calendar helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-11-01", "2026-11-05")).toBe(4);
    expect(daysBetween("2026-11-05", "2026-11-05")).toBe(0);
  });
});

describe("launchDateOf", () => {
  const now = new Date("2026-11-05T10:00:00+08:00");

  it("uses the ad's creation day in Philippine time", () => {
    // 23:30 UTC on Nov 3 is already Nov 4 in Manila.
    expect(launchDateOf("2026-11-03T23:30:00+0000", null, now)).toEqual({
      launch_date: "2026-11-04",
      scheduled: false,
    });
  });

  it("uses the ad set's scheduled start when that is later", () => {
    expect(
      launchDateOf("2026-11-01T02:00:00+0000", "2026-11-03T00:00:00+0800", now).launch_date
    ).toBe("2026-11-03");
  });

  it("is scheduled while the start is still ahead", () => {
    expect(launchDateOf("2026-11-04T02:00:00+0000", "2026-11-09T00:00:00+0800", now)).toEqual({
      launch_date: null,
      scheduled: true,
    });
  });
});

describe("windowFromStart", () => {
  const rows = [
    day("2026-11-01", 400, 1),
    day("2026-11-02", 500, 2),
    day("2026-11-03", 450, 1),
    day("2026-11-04", 600, 0),
    day("2026-11-08", 300, 1),
  ];

  it("sums the first three calendar days from the start", () => {
    const w = windowFromStart(rows, "2026-11-01", 3, "2026-11-10");
    expect(w.spend).toBe(1350);
    expect(w.purchases).toBe(4);
    expect(w.cpp).toBeCloseTo(337.5);
    expect(w.complete).toBe(true);
    expect(w.days_elapsed).toBe(3);
  });

  it("marks a window still running as incomplete", () => {
    const w = windowFromStart(rows, "2026-11-01", 7, "2026-11-04");
    expect(w.complete).toBe(false);
    expect(w.days_elapsed).toBe(4);
    expect(w.spend).toBe(1950);
  });

  it("includes day 7 and leaves day 8 out", () => {
    const w = windowFromStart(rows, "2026-11-01", 7, "2026-11-20");
    expect(w.spend).toBe(1950);
    expect(windowFromStart(rows, "2026-11-02", 7, "2026-11-20").spend).toBe(1850);
  });
});

describe("computeMetrics", () => {
  it("starts the windows on the first delivery day, not the creation day", () => {
    // Created Nov 1, stuck in review, first impressions Nov 3.
    const rows = [day("2026-11-03", 200, 1), day("2026-11-04", 300, 2), day("2026-11-05", 250, 0)];
    const m = computeMetrics(rows, "2026-11-01", null, "2026-11-06");
    expect(m.first_delivery_date).toBe("2026-11-03");
    expect(m.first_3_days.spend).toBe(750);
    expect(m.first_3_days.purchases).toBe(3);
    expect(m.first_3_days.complete).toBe(true);
    expect(m.days_delivered).toBe(3);
    expect(m.lifetime.days_elapsed).toBe(4);
  });

  it("falls back to the launch day when nothing has delivered", () => {
    const m = computeMetrics([], "2026-11-04", null, "2026-11-05");
    expect(m.first_delivery_date).toBeNull();
    expect(m.first_3_days.days_elapsed).toBe(2);
    expect(m.first_3_days.spend).toBe(0);
    expect(m.daily).toEqual([]);
  });

  it("credits sales before the safe-image swap to the original creative", () => {
    const rows = [day("2026-11-01", 400, 3), day("2026-11-02", 400, 2), day("2026-11-03", 100, 0)];
    const m = computeMetrics(rows, "2026-11-01", "2026-11-03", "2026-11-05");
    expect(m.before_fix?.purchases).toBe(5);
    expect(m.before_fix?.spend).toBe(800);
    expect(m.lifetime.purchases).toBe(5);
    expect(m.lifetime.spend).toBe(900);
  });
});

describe("reviewStateOf", () => {
  it("reads Facebook's statuses", () => {
    expect(reviewStateOf("ACTIVE", false)).toBe("active");
    expect(reviewStateOf("DISAPPROVED", false)).toBe("rejected");
    expect(reviewStateOf("WITH_ISSUES", false)).toBe("issues");
    expect(reviewStateOf("PENDING_REVIEW", false)).toBe("in_review");
    expect(reviewStateOf("CAMPAIGN_PAUSED", false)).toBe("paused");
    expect(reviewStateOf("ARCHIVED", false)).toBe("off");
    expect(reviewStateOf("ACTIVE", true)).toBe("scheduled");
  });
});

describe("verdictOf", () => {
  const totals = (spend: number, purchases: number, impressions = 1000) => ({
    ...day("2026-11-01", spend, purchases, impressions),
    cpp: purchases > 0 ? spend / purchases : 0,
    roas: 0,
    ctr: 0,
    days_elapsed: 3,
    complete: true,
  });

  it("calls five sales at or under the bar a winner", () => {
    expect(verdictOf(totals(1800, 5), 400)).toBe("winner");
  });

  it("calls two cheap sales promising", () => {
    expect(verdictOf(totals(900, 2), 400)).toBe("promising");
  });

  it("calls a bar and a half of spend with nothing sold losing", () => {
    expect(verdictOf(totals(700, 0), 400)).toBe("losing");
  });

  it("waits for a bar of spend before judging", () => {
    expect(verdictOf(totals(250, 0), 400)).toBe("too_early");
  });

  it("says no delivery when nothing ran", () => {
    expect(verdictOf(totals(0, 0, 0), 400)).toBe("no_delivery");
  });
});

describe("cppTone", () => {
  it("is green within the bar, yellow up to half again over, red past that or with no sale", () => {
    expect(cppTone(800, 2, 400)).toBe("good");
    expect(cppTone(1000, 2, 400)).toBe("warn");
    expect(cppTone(1300, 2, 400)).toBe("bad");
    expect(cppTone(150, 0, 400)).toBe("bad");
    expect(cppTone(0, 0, 400)).toBe("none");
  });
});
