import { describe, expect, it } from "vitest";
import { evidenceFacts, groupCreatives, pickWinnersAndLosers, videoSummary } from "../evidence";
import type { PageEvidence } from "../types";

const row = (ad: string, purchases: number, spend: number, ad_id = ad) => ({ ad_id, account_id: "act_1", ad, campaign: "FOLIQ", adset: "", account: "", purchases, spend });

describe("create your own: the page's winners", () => {
  const groups = groupCreatives([row("DHT-01", 60, 20000, "1"), row("DHT-01 - Copy", 40, 16000, "2"), row("DHT-02", 12, 4000, "3"), row("DHT-03", 6, 2400, "4"), row("DHT-04", 2, 9000, "5"), row("DHT-05", 0, 3000, "6"), row("DHT-06", 3, 900, "7")]);

  it("counts a test ad and its scaled copies as one creative", () => {
    const g = groups.find((x) => x.ad === "DHT-01")!;
    expect(g.purchases).toBe(100);
    expect(g.spend).toBe(36000);
    expect(g.lead).toBe("1");
    expect(g.ids).toEqual(["1", "2"]);
  });

  it("ranks winners by sales at an acceptable cost, and losers by wasted spend", () => {
    const storeCpp = 55300 / 123;
    const { winners, losers } = pickWinnersAndLosers(groups, storeCpp);
    expect(winners.map((w) => w.ad)).toEqual(["DHT-01", "DHT-02", "DHT-03"]);
    expect(losers.map((l) => l.ad)).toEqual(["DHT-04", "DHT-05"]);
  });

  it("falls back to whatever sold on a page with few sales", () => {
    const young = groupCreatives([row("H-1", 3, 1500), row("H-2", 1, 900), row("H-3", 0, 400)]);
    expect(pickWinnersAndLosers(young, 700).winners.map((w) => w.ad)).toEqual(["H-1", "H-2"]);
  });

  it("keeps what a static can borrow from a video, and nothing from an empty analysis", () => {
    expect(videoSummary({})).toBeNull();
    const v = videoSummary({ transcript: "0:01 Akala ko genetics lang. 0:04 Stress pala.", hook: { description: "A man at a mirror", timestamp: "0:00" }, scenes: [{ t: "0:00", description: "mirror" }] } as never)!;
    expect(v.opening).toBe("Akala ko genetics lang. Stress pala.");
    expect(v.hook).toBe("A man at a mirror");
    expect(v.scenes).toEqual(["mirror"]);
  });

  it("tells the planner the numbers and what to do with them", () => {
    const e: PageEvidence = { days: 90, store_cpp: 406, purchases: 1159, spend: 470711, ads: 166, watched: 0, copy_read: true, losers: [{ ad: "A2", kind: "image", purchases: 13, spend: 8741, cpp: 672, primary_text: "" }], winners: [{ ad_id: "1", ad: "DHT-072226LIN2", kind: "video", swapped: true, purchases: 201, spend: 74772, cpp: 372, primary_text: "Losing your hair", headline: "", thumbnail_url: null, image_url: null, video: null }] };
    const f = evidenceFacts(e);
    expect(f).toContain('"DHT-072226LIN2" · video ad · 201 purchases at ₱372 each');
    expect(f).toContain("average cost per purchase ₱406");
    expect(f).toContain("Meta rejected this creative");
    expect(f).toContain('"A2" (image): ₱8,741 spent, 13 purchases');
  });
});
