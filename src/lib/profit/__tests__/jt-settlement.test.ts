import { describe, it, expect } from "vitest";
import {
  parcelAgeDays,
  regionForProvince,
  resolveParcelState,
  returnProbabilityForOpenParcel,
  buildReturnHazardCurve,
  calculateTrailingRtsRate,
  DEFAULT_RETURN_HAZARD,
  HAZARD_MIN_SAMPLE,
  HAZARD_SETTLE_LAG_DAYS,
  RTS_RATE_SETTLE_LAG_DAYS,
  RTS_RATE_WINDOW_DAYS,
  type SettlementParcel,
} from "../jt-settlement";
import { RTS_MIN_DELIVERED } from "../formulas";

// Noon PHT on 21 Oct 2026, the day the model was measured.
const NOW = new Date("2026-10-21T12:00:00+08:00").getTime();
const daysAgo = (n: number, hour = "15:00:00") =>
  new Date(new Date(`2026-10-21T${hour}+08:00`).getTime() - n * 86_400_000).toISOString();

function parcel(over: Partial<SettlementParcel>): SettlementParcel {
  return {
    submission_date: daysAgo(3),
    signing_time: null,
    province: "METRO-MANILA",
    classification: "In Transit",
    is_delivered: false,
    is_returned: false,
    ...over,
  };
}

describe("parcelAgeDays — whole PHT calendar days since submission", () => {
  it("submitted this afternoon = age 0, even though noon is earlier", () => {
    expect(parcelAgeDays(daysAgo(0), NOW)).toBe(0);
  });
  it("submitted 3 days ago = 3", () => {
    expect(parcelAgeDays(daysAgo(3), NOW)).toBe(3);
  });
  it("counts PHT days, not UTC days: 23:30 PHT yesterday is 1 day old at noon", () => {
    // 23:30 PHT on 20 Oct is 15:30 UTC the same day; a UTC split would still
    // say yesterday, but a late-evening PHT submission must not read as today.
    expect(parcelAgeDays("2026-10-20T23:30:00+08:00", NOW)).toBe(1);
  });
  it("missing or unreadable date = null", () => {
    expect(parcelAgeDays(null, NOW)).toBeNull();
    expect(parcelAgeDays("not a date", NOW)).toBeNull();
  });
});

describe("regionForProvince", () => {
  it("Luzon provinces, hyphenated or not", () => {
    expect(regionForProvince("METRO-MANILA")).toBe("Luzon");
    expect(regionForProvince("Nueva Ecija")).toBe("Luzon");
  });
  it("Visayas and Mindanao", () => {
    expect(regionForProvince("CEBU")).toBe("VisMin");
    expect(regionForProvince("DAVAO-DEL-SUR")).toBe("VisMin");
  });
  it("unknown or blank defaults to the slower region", () => {
    expect(regionForProvince(null)).toBe("VisMin");
  });
});

describe("resolveParcelState — the state as of now, not as of upload", () => {
  it("delivered wins over everything", () => {
    expect(resolveParcelState(parcel({ is_delivered: true, is_returned: true }), NOW)).toBe("delivered");
  });
  it("J&T-confirmed return", () => {
    expect(resolveParcelState(parcel({ is_returned: true, classification: "Returned" }), NOW)).toBe("returned");
  });
  it("Luzon parcel in transit 3 days: still open", () => {
    expect(resolveParcelState(parcel({ submission_date: daysAgo(3) }), NOW)).toBe("open");
  });
  it("Luzon parcel in transit 6 days (> 5-day cutoff): a return now, whatever the upload said", () => {
    expect(resolveParcelState(parcel({ submission_date: daysAgo(6) }), NOW)).toBe("returned");
  });
  it("Luzon parcel at exactly the cutoff (5 days) is still open", () => {
    expect(resolveParcelState(parcel({ submission_date: daysAgo(5) }), NOW)).toBe("open");
  });
  it("VisMin parcel in transit 7 days: still open (cutoff is 8)", () => {
    expect(resolveParcelState(parcel({ province: "CEBU", submission_date: daysAgo(7) }), NOW)).toBe("open");
  });
  it("VisMin parcel in transit 9 days: aged return", () => {
    expect(resolveParcelState(parcel({ province: "CEBU", submission_date: daysAgo(9) }), NOW)).toBe("returned");
  });
  it("Pending (unknown J&T status) never ages — we don't know it's moving", () => {
    expect(resolveParcelState(parcel({ classification: "Pending", submission_date: daysAgo(30) }), NOW)).toBe("open");
  });
  it("no submission date: cannot age, stays open", () => {
    expect(resolveParcelState(parcel({ submission_date: null }), NOW)).toBe("open");
  });
});

describe("returnProbabilityForOpenParcel", () => {
  it("reads the curve at the parcel's age", () => {
    expect(returnProbabilityForOpenParcel(DEFAULT_RETURN_HAZARD, "VisMin", 7)).toBeCloseTo(0.93);
    expect(returnProbabilityForOpenParcel(DEFAULT_RETURN_HAZARD, "Luzon", 0)).toBeCloseTo(0.14);
  });
  it("VisMin at day 6 is far more likely back than Luzon at day 6 — the old 6-day hole", () => {
    // Luzon returns are 91% visible by day 6, VisMin only 3.5%: a VisMin
    // parcel still open then is almost certainly coming back.
    expect(returnProbabilityForOpenParcel(DEFAULT_RETURN_HAZARD, "VisMin", 6)).toBeGreaterThan(0.85);
  });
  it("past the end of the curve everything open is a return", () => {
    expect(returnProbabilityForOpenParcel(DEFAULT_RETURN_HAZARD, "Luzon", 40)).toBe(1);
  });
  it("null or negative age reads as age 0", () => {
    expect(returnProbabilityForOpenParcel(DEFAULT_RETURN_HAZARD, "Luzon", null)).toBeCloseTo(0.14);
    expect(returnProbabilityForOpenParcel(DEFAULT_RETURN_HAZARD, "Luzon", -2)).toBeCloseTo(0.14);
  });
  it("probabilities are clamped to [0, 1]", () => {
    const odd = { Luzon: [1.7, -0.2], VisMin: [] as number[] };
    expect(returnProbabilityForOpenParcel(odd, "Luzon", 0)).toBe(1);
    expect(returnProbabilityForOpenParcel(odd, "Luzon", 1)).toBe(0);
  });
});

describe("buildReturnHazardCurve", () => {
  // 100 Luzon parcels submitted 30 days ago: 80 deliver on day 1, 20 return on day 4.
  function settledLuzon(): SettlementParcel[] {
    const sub = daysAgo(30, "10:00:00");
    const rows: SettlementParcel[] = [];
    for (let i = 0; i < 80; i++) rows.push(parcel({ submission_date: sub, signing_time: daysAgo(29), classification: "Delivered", is_delivered: true }));
    for (let i = 0; i < 20; i++) rows.push(parcel({ submission_date: sub, signing_time: daysAgo(26), classification: "Returned", is_returned: true }));
    return rows;
  }

  it("P(return | open at age 0) is the plain RTS rate; after the deliveries land it is 100%", () => {
    const curve = buildReturnHazardCurve(settledLuzon(), NOW);
    expect(curve.Luzon[0]).toBeCloseTo(0.2);
    // At age 1 the 80 deliveries have signed; only the 20 returns are open → 100%… but
    // 20 open parcels is below HAZARD_MIN_SAMPLE, so the measured default is used instead.
    expect(20).toBeLessThan(HAZARD_MIN_SAMPLE);
    expect(curve.Luzon[1]).toBe(DEFAULT_RETURN_HAZARD.Luzon[1]);
  });

  it("thin buckets and the untouched region fall back to the measured default", () => {
    const curve = buildReturnHazardCurve(settledLuzon(), NOW);
    expect(curve.VisMin).toEqual(DEFAULT_RETURN_HAZARD.VisMin.slice(0, curve.VisMin.length));
    expect(curve.VisMin.length).toBeGreaterThan(8);
  });

  it("cohorts younger than the settle lag are ignored — they would bias the curve low", () => {
    // 200 parcels submitted 5 days ago, all delivered on day 1 and none returned (yet).
    const young: SettlementParcel[] = [];
    for (let i = 0; i < 200; i++) young.push(parcel({ submission_date: daysAgo(5), signing_time: daysAgo(4), classification: "Delivered", is_delivered: true }));
    expect(5).toBeLessThan(HAZARD_SETTLE_LAG_DAYS);
    const curve = buildReturnHazardCurve([...settledLuzon(), ...young], NOW);
    expect(curve.Luzon[0]).toBeCloseTo(0.2); // not 20/300
  });

  it("our own aged inference has no signing time, so it never pollutes the curve", () => {
    const aged: SettlementParcel[] = [];
    for (let i = 0; i < 100; i++) aged.push(parcel({ submission_date: daysAgo(30), signing_time: null, classification: "Returned (Aged)", is_returned: true }));
    const curve = buildReturnHazardCurve([...settledLuzon(), ...aged], NOW);
    expect(curve.Luzon[0]).toBeCloseTo(0.2);
  });
});

describe("calculateTrailingRtsRate", () => {
  const history = (opts: { ageDays: number; n: number; returned: number }) => {
    const rows: { submission_date: string | null; state: "delivered" | "returned" | "open" }[] = [];
    for (let i = 0; i < opts.n; i++) {
      rows.push({ submission_date: daysAgo(opts.ageDays), state: i < opts.returned ? "returned" : "delivered" });
    }
    return rows;
  };

  it("reads the recent window, not all time: ILP went 17% → 24% and the all-time figure lagged", () => {
    const old = history({ ageDays: 150, n: 1000, returned: 170 }); // 17%, outside the window
    const recent = history({ ageDays: 30, n: 400, returned: 96 }); // 24%, inside
    const r = calculateTrailingRtsRate([...old, ...recent], NOW);
    expect(r.windowed).toBe(true);
    expect(r.settled).toBe(400);
    expect(r.rate).toBeCloseTo(0.24);
  });

  it("ignores the newest cohorts — their returns are not marked yet", () => {
    const recent = history({ ageDays: 30, n: 400, returned: 96 });
    const tooNew = history({ ageDays: RTS_RATE_SETTLE_LAG_DAYS - 1, n: 500, returned: 0 }); // looks perfect, isn't final
    const r = calculateTrailingRtsRate([...recent, ...tooNew], NOW);
    expect(r.rate).toBeCloseTo(0.24);
    expect(r.settled).toBe(400);
  });

  it("window edge: exactly lag + width days old is still in, one day older is out", () => {
    const edge = history({ ageDays: RTS_RATE_SETTLE_LAG_DAYS + RTS_RATE_WINDOW_DAYS, n: 300, returned: 30 });
    const out = history({ ageDays: RTS_RATE_SETTLE_LAG_DAYS + RTS_RATE_WINDOW_DAYS + 1, n: 300, returned: 300 });
    const r = calculateTrailingRtsRate([...edge, ...out], NOW);
    expect(r.windowed).toBe(true);
    expect(r.rate).toBeCloseTo(0.1);
  });

  it("falls back to all-time when the window has too few settled parcels", () => {
    const old = history({ ageDays: 150, n: 1000, returned: 170 });
    const recent = history({ ageDays: 30, n: RTS_MIN_DELIVERED - 1, returned: 50 });
    const r = calculateTrailingRtsRate([...old, ...recent], NOW);
    expect(r.windowed).toBe(false);
    expect(r.settled).toBe(1000 + RTS_MIN_DELIVERED - 1);
    expect(r.rate).toBeCloseTo((170 + 50) / (1000 + RTS_MIN_DELIVERED - 1));
  });

  it("open parcels are never counted as settled", () => {
    const rows = [...history({ ageDays: 30, n: 300, returned: 60 }), ...Array.from({ length: 100 }, () => ({ submission_date: daysAgo(30), state: "open" as const }))];
    const r = calculateTrailingRtsRate(rows, NOW);
    expect(r.settled).toBe(300);
    expect(r.rate).toBeCloseTo(0.2);
  });

  it("no history at all: rate 0, so callers skip the projection", () => {
    expect(calculateTrailingRtsRate([], NOW)).toEqual({ rate: 0, settled: 0, windowed: false });
  });
});
