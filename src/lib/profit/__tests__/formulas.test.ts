import { describe, it, expect } from "vitest";
import {
  calculateNetProfit,
  calculateMarginPct,
  calculateProjectedShipping,
  calculateLineItemCogs,
  calculateOrderCogs,
  calculateWorstCaseReturns,
  distributeReturnsByRevenue,
  roundCurrency,
  SHIPPING_RATE,
  RTS_WORST_CASE_RATE,
  RTS_MIN_DELIVERED,
} from "../formulas";
import { getProvinceCutoff, classifyJtDelivery } from "../province-tiers";
import { matchAdToStore, matchSenderToStore } from "../store-matching";

// ============================================================
// P&L NET PROFIT FORMULA
// ============================================================
describe("Net Profit Formula", () => {
  it("basic: Revenue - COGS - Ad Spend - Shipping - Returns", () => {
    // Real-world example:
    // Revenue: ₱100,000 (total Shopify orders)
    // COGS: ₱30,000 (cost of goods from cogs_items table)
    // Ad Spend: ₱20,000 (from Facebook)
    // Shipping: ₱12,000 (12% of revenue)
    // Returns: ₱5,000 (item_value of returned J&T parcels)
    const result = calculateNetProfit(100000, 30000, 20000, 12000, 5000);
    expect(result).toBe(33000); // ₱33,000 net profit
  });

  it("negative profit when costs exceed revenue", () => {
    // Revenue ₱50k but heavy ad spend
    const result = calculateNetProfit(50000, 20000, 35000, 6000, 5000);
    expect(result).toBe(-16000); // Loss of ₱16,000
  });

  it("zero revenue = negative profit from any costs", () => {
    const result = calculateNetProfit(0, 0, 5000, 0, 0);
    expect(result).toBe(-5000);
  });

  it("all zeros = zero profit", () => {
    expect(calculateNetProfit(0, 0, 0, 0, 0)).toBe(0);
  });

  it("returns should reduce profit, not increase it", () => {
    const withoutReturns = calculateNetProfit(100000, 30000, 20000, 12000, 0);
    const withReturns = calculateNetProfit(100000, 30000, 20000, 12000, 10000);
    expect(withReturns).toBeLessThan(withoutReturns);
    expect(withoutReturns - withReturns).toBe(10000);
  });
});

// ============================================================
// MARGIN % CALCULATION
// ============================================================
describe("Margin % Calculation", () => {
  it("33% margin on ₱100k revenue with ₱33k profit", () => {
    const margin = calculateMarginPct(33000, 100000);
    expect(margin).toBe(33);
  });

  it("negative margin when losing money", () => {
    const margin = calculateMarginPct(-16000, 50000);
    expect(margin).toBe(-32);
  });

  it("zero revenue = 0% margin (not NaN or Infinity)", () => {
    expect(calculateMarginPct(0, 0)).toBe(0);
    expect(calculateMarginPct(-5000, 0)).toBe(0);
  });

  it("100% margin means zero costs (impossible in practice but formula-correct)", () => {
    expect(calculateMarginPct(50000, 50000)).toBe(100);
  });

  it("rounds to 2 decimal places", () => {
    // ₱33,333 profit on ₱100,000 revenue = 33.33%
    const margin = calculateMarginPct(33333, 100000);
    expect(margin).toBe(33.33);
  });
});

// ============================================================
// PROJECTED SHIPPING (12% of Revenue)
// ============================================================
describe("Projected Shipping (12% of Revenue)", () => {
  it("₱100,000 revenue = ₱12,000 shipping", () => {
    expect(calculateProjectedShipping(100000)).toBe(12000);
  });

  it("₱0 revenue = ₱0 shipping", () => {
    expect(calculateProjectedShipping(0)).toBe(0);
  });

  it("₱1,341,023 revenue (real monthly) = ₱160,922.76 shipping", () => {
    const shipping = calculateProjectedShipping(1341023);
    expect(roundCurrency(shipping)).toBe(160922.76);
  });

  it("shipping rate constant is 0.12 (12%)", () => {
    expect(SHIPPING_RATE).toBe(0.12);
  });

  it("shipping ALWAYS overwrites actual J&T shipping cost", () => {
    // This is the current behavior — the code replaces actual shipping
    // with 12% projected. So even if J&T says shipping was ₱8,000,
    // we use ₱12,000 (12% of ₱100k).
    // This is a DESIGN DECISION, not a bug.
    const projected = calculateProjectedShipping(100000);
    const actualJtShipping = 8000;
    expect(projected).not.toBe(actualJtShipping);
    expect(projected).toBe(12000);
  });
});

// ============================================================
// COGS CALCULATION
// ============================================================
describe("COGS Calculation", () => {
  it("single item: cogs_per_unit × quantity", () => {
    // 1 unit at ₱150 COGS
    expect(calculateLineItemCogs(150, 1)).toBe(150);
  });

  it("multiple quantity: ₱150 × 3 = ₱450", () => {
    expect(calculateLineItemCogs(150, 3)).toBe(450);
  });

  it("missing COGS = ₱0 (not NaN, not error)", () => {
    expect(calculateLineItemCogs(undefined, 5)).toBe(0);
  });

  it("order with mixed items: some have COGS, some don't", () => {
    const cogsMap = new Map<string, number>();
    cogsMap.set("I LOVE PATCHES::patch-001", 50);
    cogsMap.set("I LOVE PATCHES::patch-002", 75);
    // patch-003 is NOT in the COGS table

    const lineItems = [
      { sku: "PATCH-001", quantity: 2 }, // 2 × ₱50 = ₱100
      { sku: "PATCH-002", quantity: 1 }, // 1 × ₱75 = ₱75
      { sku: "PATCH-003", quantity: 3 }, // MISSING — ₱0
    ];

    const result = calculateOrderCogs(lineItems, cogsMap, "I LOVE PATCHES");
    expect(result.totalCogs).toBe(175); // Only items with COGS
    expect(result.missingSkus).toEqual(["I LOVE PATCHES::PATCH-003"]);
  });

  it("SKU lookup is case-insensitive", () => {
    const cogsMap = new Map<string, number>();
    cogsMap.set("I LOVE PATCHES::abc-123", 100);

    const result = calculateOrderCogs(
      [{ sku: "ABC-123", quantity: 1 }],
      cogsMap,
      "I LOVE PATCHES"
    );
    expect(result.totalCogs).toBe(100);
  });

  it("null/empty SKU is skipped (not an error)", () => {
    const cogsMap = new Map<string, number>();
    const result = calculateOrderCogs(
      [{ sku: null, quantity: 1 }, { sku: "", quantity: 1 }],
      cogsMap,
      "STORE"
    );
    expect(result.totalCogs).toBe(0);
    expect(result.missingSkus).toEqual([]);
  });

  it("COGS is per-store: same SKU in different stores can have different costs", () => {
    const cogsMap = new Map<string, number>();
    cogsMap.set("I LOVE PATCHES::ring-001", 50);
    cogsMap.set("CAPSULED::ring-001", 80);

    const ilp = calculateOrderCogs(
      [{ sku: "ring-001", quantity: 1 }],
      cogsMap,
      "I LOVE PATCHES"
    );
    const cap = calculateOrderCogs(
      [{ sku: "ring-001", quantity: 1 }],
      cogsMap,
      "CAPSULED"
    );

    expect(ilp.totalCogs).toBe(50);
    expect(cap.totalCogs).toBe(80);
  });

  it("real scenario: order with 5 items, 1 missing COGS — net profit impact", () => {
    const cogsMap = new Map<string, number>();
    cogsMap.set("STORE::a", 100);
    cogsMap.set("STORE::b", 200);
    cogsMap.set("STORE::c", 50);
    cogsMap.set("STORE::d", 75);
    // "e" is missing

    const lineItems = [
      { sku: "a", quantity: 2 },  // ₱200
      { sku: "b", quantity: 1 },  // ₱200
      { sku: "c", quantity: 3 },  // ₱150
      { sku: "d", quantity: 1 },  // ₱75
      { sku: "e", quantity: 2 },  // MISSING
    ];

    const result = calculateOrderCogs(lineItems, cogsMap, "STORE");
    expect(result.totalCogs).toBe(625);
    expect(result.missingSkus).toHaveLength(1);

    // This means net profit is OVERSTATED because "e" COGS is ₱0
    // If "e" actually costs ₱150/unit, real COGS would be ₱925
    // That's a ₱300 difference in net profit!
    const reportedNetProfit = calculateNetProfit(5000, result.totalCogs, 1000, 600, 500);
    const realNetProfit = calculateNetProfit(5000, 625 + 300, 1000, 600, 500);
    expect(reportedNetProfit).toBeGreaterThan(realNetProfit);
    expect(reportedNetProfit - realNetProfit).toBe(300); // Overstated by ₱300
  });
});

// ============================================================
// WORST-CASE RTS (25% RULE)
// ============================================================
describe("Worst-Case RTS (25% of Revenue)", () => {
  it("store with < 200 delivered: use 25% of revenue if higher than actual", () => {
    // Store has 50 delivered parcels (< 200 threshold)
    // Revenue: ₱100,000
    // Actual returns from J&T: ₱5,000 (5% — very low)
    // 25% worst case: ₱25,000
    // Should use ₱25,000 because it's higher
    const result = calculateWorstCaseReturns(5000, 100000, 50);
    expect(result.returnsValue).toBe(25000);
    expect(result.isProjected).toBe(true);
  });

  it("store with < 200 delivered but actual returns already > 25%: use actual", () => {
    // Store has 100 delivered parcels
    // Revenue: ₱100,000
    // Actual returns: ₱30,000 (30% — already worse than 25%)
    // Should use ₱30,000 (actual)
    const result = calculateWorstCaseReturns(30000, 100000, 100);
    expect(result.returnsValue).toBe(30000);
    expect(result.isProjected).toBe(false);
  });

  it("store with 200+ delivered: always use actual returns", () => {
    // Store has 500 delivered parcels (>= 200)
    // Revenue: ₱100,000
    // Actual returns: ₱2,000 (only 2%)
    // Should use ₱2,000 because we have enough data to trust it
    const result = calculateWorstCaseReturns(2000, 100000, 500);
    expect(result.returnsValue).toBe(2000);
    expect(result.isProjected).toBe(false);
  });

  it("exactly 200 delivered: uses actual (boundary)", () => {
    const result = calculateWorstCaseReturns(1000, 100000, 200);
    expect(result.returnsValue).toBe(1000);
    expect(result.isProjected).toBe(false);
  });

  it("199 delivered: still uses worst case (boundary)", () => {
    const result = calculateWorstCaseReturns(1000, 100000, 199);
    expect(result.returnsValue).toBe(25000); // 25% of 100k
    expect(result.isProjected).toBe(true);
  });

  it("zero delivered: worst case applies", () => {
    const result = calculateWorstCaseReturns(0, 100000, 0);
    expect(result.returnsValue).toBe(25000);
    expect(result.isProjected).toBe(true);
  });

  it("RTS impact on net profit — big difference early on", () => {
    // New store: 30 delivered parcels, low actual returns
    const revenue = 200000;
    const cogs = 60000;
    const adSpend = 40000;
    const shipping = revenue * 0.12; // ₱24,000

    // With actual returns (₱5,000 from J&T item_value)
    const actualRts = calculateWorstCaseReturns(5000, revenue, 30);
    const profitWithProjected = calculateNetProfit(
      revenue, cogs, adSpend, shipping, actualRts.returnsValue
    );
    // 25% of ₱200k = ₱50,000 returns
    expect(actualRts.returnsValue).toBe(50000);
    expect(profitWithProjected).toBe(26000);

    // If we had 200+ deliveries, we'd use actual ₱5,000
    const matureRts = calculateWorstCaseReturns(5000, revenue, 250);
    const profitWithActual = calculateNetProfit(
      revenue, cogs, adSpend, shipping, matureRts.returnsValue
    );
    expect(matureRts.returnsValue).toBe(5000);
    expect(profitWithActual).toBe(71000);

    // ₱45,000 difference in reported net profit!
    expect(profitWithActual - profitWithProjected).toBe(45000);
  });

  it("RTS is applied to REVENUE, not COGS — this matters for SRP", () => {
    // The 25% is against REVENUE (SRP-based Shopify total_price),
    // NOT against COGS. This means:
    // If you sell items for ₱500 (SRP) that cost ₱100 (COGS),
    // worst-case returns = 25% × ₱500 = ₱125 per item
    // (the lost revenue when customer returns, not the cost)

    const srp = 500; // Selling price
    const cogsPerUnit = 100;
    const qty = 100; // 100 orders

    const revenue = srp * qty; // ₱50,000
    const cogs = cogsPerUnit * qty; // ₱10,000

    const rts = calculateWorstCaseReturns(0, revenue, 10);
    // 25% of ₱50,000 = ₱12,500 (based on SRP/revenue, not COGS)
    expect(rts.returnsValue).toBe(12500);

    // If it were 25% of COGS, it would be ₱2,500 — very different
    const hypotheticalCogsBasedRts = cogs * 0.25;
    expect(hypotheticalCogsBasedRts).toBe(2500);
    expect(rts.returnsValue).not.toBe(hypotheticalCogsBasedRts);
  });
});

// ============================================================
// RETURNS DISTRIBUTION ACROSS DATES
// ============================================================
describe("Returns Distribution by Revenue Proportion", () => {
  it("distributes proportionally: 60/40 revenue split", () => {
    const dateRevenues = new Map([
      ["2025-04-01", 60000],
      ["2025-04-02", 40000],
    ]);

    const result = distributeReturnsByRevenue(10000, dateRevenues, 100000);
    expect(result.get("2025-04-01")).toBe(6000); // 60%
    expect(result.get("2025-04-02")).toBe(4000); // 40%
  });

  it("single date gets all returns", () => {
    const dateRevenues = new Map([["2025-04-01", 50000]]);
    const result = distributeReturnsByRevenue(10000, dateRevenues, 50000);
    expect(result.get("2025-04-01")).toBe(10000);
  });

  it("zero total revenue = no distribution", () => {
    const dateRevenues = new Map([["2025-04-01", 0]]);
    const result = distributeReturnsByRevenue(10000, dateRevenues, 0);
    expect(result.size).toBe(0);
  });
});

// ============================================================
// J&T DELIVERY CLASSIFICATION
// ============================================================
describe("J&T Delivery Classification", () => {
  it("Delivered status = Delivered", () => {
    expect(classifyJtDelivery("Delivered", 3, "RIZAL")).toBe("Delivered");
  });

  it("Returned status = Returned", () => {
    expect(classifyJtDelivery("Returned", 10, "CEBU")).toBe("Returned");
  });

  it("For Return status = For Return", () => {
    expect(classifyJtDelivery("For Return", 5, "LAGUNA")).toBe("For Return");
  });

  it("In Transit within Luzon cutoff (5 days) = In Transit", () => {
    expect(classifyJtDelivery("In Transit", 3, "RIZAL")).toBe("In Transit");
    expect(classifyJtDelivery("In Transit", 5, "RIZAL")).toBe("In Transit");
  });

  it("In Transit beyond Luzon cutoff (>5 days) = Returned (Aged)", () => {
    expect(classifyJtDelivery("In Transit", 6, "RIZAL")).toBe("Returned (Aged)");
    expect(classifyJtDelivery("In Transit", 10, "CAVITE")).toBe("Returned (Aged)");
  });

  it("In Transit within VisMin cutoff (8 days) = In Transit", () => {
    expect(classifyJtDelivery("In Transit", 7, "CEBU")).toBe("In Transit");
    expect(classifyJtDelivery("In Transit", 8, "DAVAO DEL SUR")).toBe("In Transit");
  });

  it("In Transit beyond VisMin cutoff (>8 days) = Returned (Aged)", () => {
    expect(classifyJtDelivery("In Transit", 9, "CEBU")).toBe("Returned (Aged)");
    expect(classifyJtDelivery("In Transit", 15, "DAVAO DEL SUR")).toBe("Returned (Aged)");
  });

  it("Delivering status also checks aging (same as In Transit)", () => {
    expect(classifyJtDelivery("Delivering", 3, "RIZAL")).toBe("In Transit");
    expect(classifyJtDelivery("Delivering", 6, "RIZAL")).toBe("Returned (Aged)");
  });

  it("unknown status = Pending", () => {
    expect(classifyJtDelivery("Processing", 1, "NCR")).toBe("Pending");
    expect(classifyJtDelivery("Unknown", 0, "CEBU")).toBe("Pending");
  });
});

// ============================================================
// PROVINCE TIER CUTOFFS
// ============================================================
describe("Province Tier Cutoffs", () => {
  it("NCR/Metro Manila = 5 days", () => {
    expect(getProvinceCutoff("METRO MANILA")).toBe(5);
    expect(getProvinceCutoff("NCR")).toBe(5);
    expect(getProvinceCutoff("Metro Manila")).toBe(5);
  });

  it("Nearby Luzon provinces = 5 days", () => {
    expect(getProvinceCutoff("RIZAL")).toBe(5);
    expect(getProvinceCutoff("CAVITE")).toBe(5);
    expect(getProvinceCutoff("LAGUNA")).toBe(5);
    expect(getProvinceCutoff("BULACAN")).toBe(5);
    expect(getProvinceCutoff("PAMPANGA")).toBe(5);
  });

  it("Far Luzon provinces = still 5 days", () => {
    expect(getProvinceCutoff("PALAWAN")).toBe(5);
    expect(getProvinceCutoff("CAGAYAN")).toBe(5);
    expect(getProvinceCutoff("ALBAY")).toBe(5);
    expect(getProvinceCutoff("SORSOGON")).toBe(5);
  });

  it("Visayas provinces = 8 days", () => {
    expect(getProvinceCutoff("CEBU")).toBe(8);
    expect(getProvinceCutoff("ILOILO")).toBe(8);
    expect(getProvinceCutoff("LEYTE")).toBe(8);
    expect(getProvinceCutoff("BOHOL")).toBe(8);
  });

  it("Mindanao provinces = 8 days", () => {
    expect(getProvinceCutoff("DAVAO DEL SUR")).toBe(8);
    expect(getProvinceCutoff("ZAMBOANGA")).toBe(8);
    expect(getProvinceCutoff("BUKIDNON")).toBe(8);
    expect(getProvinceCutoff("COTABATO")).toBe(8);
  });

  it("handles case and dashes", () => {
    expect(getProvinceCutoff("metro-manila")).toBe(5);
    expect(getProvinceCutoff("Metro-Manila")).toBe(5);
    expect(getProvinceCutoff("nueva ecija")).toBe(5);
  });
});

// ============================================================
// STORE NAME MATCHING (Ad Spend Attribution)
// ============================================================
describe("Ad Spend Store Attribution", () => {
  it("campaign with ILOVEPATCHES = I LOVE PATCHES store", () => {
    expect(matchAdToStore("ILOVEPATCHES-NURSERY", "ALL")).toBe("I LOVE PATCHES");
    expect(matchAdToStore("ILOVEPATCHES-SCALING", "ALL")).toBe("I LOVE PATCHES");
  });

  it("campaign with ILP = I LOVE PATCHES", () => {
    expect(matchAdToStore("ILP-CAMPAIGN", "")).toBe("I LOVE PATCHES");
  });

  it("campaign with CAPSULED = CAPSULED store", () => {
    expect(matchAdToStore("CAPSULED-NURSERY", "ALL OFF")).toBe("CAPSULED");
  });

  it("unrecognized campaign = empty (unattributed)", () => {
    expect(matchAdToStore("RANDOM-CAMPAIGN", "RANDOM-ADSET")).toBe("");
  });

  it("unattributed ad spend still counted in total but not per-store", () => {
    // This is important: if an ad can't be matched to a store,
    // the spend goes to "UNATTRIBUTED" key, which means:
    // - Total P&L includes it
    // - Per-store filter EXCLUDES it
    const store = matchAdToStore("BRAND-AWARENESS", "GENERAL");
    expect(store).toBe("");
  });
});

// ============================================================
// J&T SENDER NAME → STORE MATCHING
// ============================================================
describe("J&T Sender → Store Matching", () => {
  it("Ilovepatches variations → I LOVE PATCHES", () => {
    expect(matchSenderToStore("Ilovepatches")).toBe("I LOVE PATCHES");
    expect(matchSenderToStore("ILOVEPATCHES")).toBe("I LOVE PATCHES");
    expect(matchSenderToStore("I Love Patches")).toBe("I LOVE PATCHES");
    expect(matchSenderToStore("ILOVEPATCH")).toBe("I LOVE PATCHES");
  });

  it("CAPSULED sender → CAPSULED", () => {
    expect(matchSenderToStore("Capsuled")).toBe("CAPSULED");
    expect(matchSenderToStore("CAPSULED OFFICIAL")).toBe("CAPSULED");
  });

  it("unknown sender returns original name (trimmed)", () => {
    expect(matchSenderToStore("  Some Random Seller  ")).toBe("Some Random Seller");
  });
});

// ============================================================
// FULL P&L SCENARIO (END-TO-END FORMULA TEST)
// ============================================================
describe("Full P&L Scenario — Real Numbers", () => {
  it("day with ₱60,590 revenue, ₱9,828 ad spend — verify all components", () => {
    // Based on the actual dashboard screenshot
    const revenue = 60590;
    const adSpend = 9828.42;

    // Shipping = 12% of revenue
    const shipping = calculateProjectedShipping(revenue);
    expect(roundCurrency(shipping)).toBe(7270.80);

    // Let's say COGS = ₱18,000 (30% of revenue)
    const cogs = 18000;

    // Returns: store has 50 delivered parcels, actual returns = ₱2,000
    const rts = calculateWorstCaseReturns(2000, revenue, 50);
    expect(rts.isProjected).toBe(true);
    expect(roundCurrency(rts.returnsValue)).toBe(15147.50); // 25% of ₱60,590

    // Net Profit
    const netProfit = calculateNetProfit(
      revenue, cogs, adSpend, shipping, rts.returnsValue
    );
    expect(roundCurrency(netProfit)).toBe(10343.28);

    // Margin %
    const margin = calculateMarginPct(netProfit, revenue);
    expect(margin).toBe(17.07);
  });

  it("month with ₱1.34M revenue — verify proportions make sense", () => {
    const revenue = 1341023;
    const shipping = calculateProjectedShipping(revenue);
    expect(roundCurrency(shipping)).toBe(160922.76);

    // COGS at 30%
    const cogs = revenue * 0.30;

    // Ad spend ₱203,978
    const adSpend = 203978.70;

    // Returns: mature store (500+ delivered), actual returns from J&T
    const actualReturns = 45000;
    const rts = calculateWorstCaseReturns(actualReturns, revenue, 500);
    expect(rts.returnsValue).toBe(45000); // Uses actual
    expect(rts.isProjected).toBe(false);

    const netProfit = calculateNetProfit(revenue, cogs, adSpend, shipping, rts.returnsValue);
    const margin = calculateMarginPct(netProfit, revenue);

    // Net profit should be positive
    expect(netProfit).toBeGreaterThan(0);
    // Margin should be reasonable (10-40% range for ecommerce)
    expect(margin).toBeGreaterThan(0);
    expect(margin).toBeLessThan(50);
  });

  it("cancelled/refunded orders are excluded from revenue", () => {
    // The P&L code skips orders where:
    // - cancelled_at is not null
    // - financial_status is "voided" or "refunded"
    //
    // So if you have 10 orders worth ₱5,000 each but 2 are cancelled:
    // Revenue should be ₱40,000, not ₱50,000
    const allOrders = [
      { total_price: "5000", cancelled_at: null, financial_status: "paid" },
      { total_price: "5000", cancelled_at: null, financial_status: "paid" },
      { total_price: "5000", cancelled_at: "2025-04-01", financial_status: "paid" },
      { total_price: "5000", cancelled_at: null, financial_status: "refunded" },
      { total_price: "5000", cancelled_at: null, financial_status: "paid" },
    ];

    const revenue = allOrders
      .filter((o) => !o.cancelled_at && o.financial_status !== "voided" && o.financial_status !== "refunded")
      .reduce((sum, o) => sum + parseFloat(o.total_price), 0);

    expect(revenue).toBe(15000); // Only 3 valid orders
  });

  it("revenue uses total_price (includes shipping + tax), not subtotal", () => {
    // Shopify total_price = subtotal + shipping + tax - discounts
    // The P&L uses total_price as revenue
    // This means shipping fee paid by customer is counted as revenue
    const order = {
      total_price: "1299.00", // What customer paid
      subtotal_price: "999.00", // Product price only
    };

    // Revenue = ₱1,299, not ₱999
    expect(parseFloat(order.total_price)).toBe(1299);
  });
});

// ============================================================
// ROUNDING
// ============================================================
describe("Currency Rounding", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundCurrency(100.456)).toBe(100.46);
    expect(roundCurrency(100.454)).toBe(100.45);
    expect(roundCurrency(100.005)).toBe(100.01); // banker's rounding edge
  });

  it("preserves exact values", () => {
    expect(roundCurrency(100.12)).toBe(100.12);
    expect(roundCurrency(0)).toBe(0);
  });
});
