import { describe, it, expect } from "vitest";
import {
  blockWindow,
  DEFAULT_BLOCK_SECONDS,
  isRateLimitError,
  parseInsightsThrottle,
  parseUsageHeader,
  usageFromHeaders,
} from "../rate-limit";

describe("isRateLimitError", () => {
  it("treats 'User request limit reached' (code 17) as a rate limit with no wait text", () => {
    const r = isRateLimitError({ error: { code: 17, message: "User request limit reached", error_subcode: 2446079 } });
    expect(r.limited).toBe(true);
    expect(r.code).toBe(17);
    expect(r.waitSeconds).toBeNull();
  });

  it("reads an explicit wait out of the message", () => {
    const r = isRateLimitError({ error: { code: 4, message: "Please wait 12 minutes" } });
    expect(r.waitSeconds).toBe(720);
  });

  it("ignores ordinary errors", () => {
    expect(isRateLimitError({ error: { code: 100, message: "Invalid parameter" } }).limited).toBe(false);
  });
});

describe("blockWindow", () => {
  const now = 1_000_000;
  it("uses the explicit wait first", () => {
    expect(blockWindow(90, 7, now).getTime()).toBe(now + 90_000);
  });
  it("falls back to the header estimate, in minutes", () => {
    expect(blockWindow(null, 7, now).getTime()).toBe(now + 7 * 60_000);
  });
  it("otherwise blocks for Meta's standard 300 seconds", () => {
    expect(blockWindow(null, null, now).getTime()).toBe(now + DEFAULT_BLOCK_SECONDS * 1000);
  });
});

describe("usage headers", () => {
  it("parses the business-use-case header and the regain estimate", () => {
    const h = JSON.stringify({
      "114982814939195": [{ type: "ads_management", call_count: 7, total_cputime: 21, total_time: 18, estimated_time_to_regain_access: 0 }],
      "592752926395010": [{ type: "ads_management", call_count: 88, total_cputime: 23, total_time: 20, estimated_time_to_regain_access: 4 }],
    });
    expect(parseUsageHeader(h)).toEqual({ maxUsagePct: 88, estimatedWaitMinutes: 4 });
  });

  it("parses the insights throttle header", () => {
    expect(parseInsightsThrottle('{"app_id_util_pct":12.5,"acc_id_util_pct":40,"ads_api_access_tier":"development_access"}')).toBe(40);
    expect(parseInsightsThrottle("nope")).toBeNull();
  });

  it("takes the worst of every header a response carries", () => {
    const headers = new Headers({
      "x-business-use-case-usage": '{"1":[{"type":"ads_management","call_count":30}]}',
      "x-fb-ads-insights-throttle": '{"app_id_util_pct":95,"acc_id_util_pct":10}',
    });
    expect(usageFromHeaders(headers).maxUsagePct).toBe(95);
  });
});
