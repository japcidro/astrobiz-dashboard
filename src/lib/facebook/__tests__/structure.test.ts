import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCampaigns, fetchAdsets } from "../structure";

function mockGraph(pages: Array<{ status?: number; body: unknown }>) {
  let i = 0;
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      urls.push(input);
      const hit = pages[Math.min(i++, pages.length - 1)];
      return {
        ok: (hit.status ?? 200) < 400,
        status: hit.status ?? 200,
        json: async () => hit.body,
      } as unknown as Response;
    })
  );
  return urls;
}

const campaign = (
  id: string,
  name: string,
  effective_status = "ACTIVE",
  status = "ACTIVE"
) => ({ id, name, status, effective_status, objective: "OUTCOME_SALES" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCampaigns", () => {
  it("returns campaigns that have never spent — the whole point", async () => {
    mockGraph([
      { body: { data: [campaign("1", "NURTELLE-NURSERY", "PAUSED", "PAUSED")] } },
    ]);

    const { campaigns, error } = await fetchCampaigns("act_1", "tok");

    expect(error).toBeNull();
    expect(campaigns).toEqual([
      {
        id: "1",
        name: "NURTELLE-NURSERY",
        status: "PAUSED",
        effective_status: "PAUSED",
        objective: "OUTCOME_SALES",
      },
    ]);
  });

  it("hides deleted and archived campaigns — they cannot take a new ad", async () => {
    mockGraph([
      {
        body: {
          data: [
            campaign("1", "Live"),
            campaign("2", "Gone", "ARCHIVED", "ARCHIVED"),
            campaign("3", "Deleted", "DELETED", "DELETED"),
          ],
        },
      },
    ]);

    const { campaigns } = await fetchCampaigns("act_1", "tok");
    expect(campaigns.map((c) => c.name)).toEqual(["Live"]);
  });

  it("sorts active campaigns above paused ones", async () => {
    mockGraph([
      {
        body: {
          data: [
            campaign("1", "Zebra paused", "PAUSED", "PAUSED"),
            campaign("2", "Apple paused", "PAUSED", "PAUSED"),
            campaign("3", "Yak running"),
          ],
        },
      },
    ]);

    const { campaigns } = await fetchCampaigns("act_1", "tok");
    expect(campaigns.map((c) => c.name)).toEqual([
      "Yak running",
      "Apple paused",
      "Zebra paused",
    ]);
  });

  it("follows pagination", async () => {
    mockGraph([
      {
        body: {
          data: [campaign("1", "One")],
          paging: { next: "https://graph.facebook.com/v21.0/act_1/campaigns?after=X" },
        },
      },
      { body: { data: [campaign("2", "Two")] } },
    ]);

    const { campaigns } = await fetchCampaigns("act_1", "tok");
    expect(campaigns.map((c) => c.name)).toEqual(["One", "Two"]);
  });

  it("reports a Facebook error instead of pretending there are no campaigns", async () => {
    mockGraph([
      { status: 400, body: { error: { message: "(#100) Invalid account" } } },
    ]);

    const { campaigns, error } = await fetchCampaigns("act_bad", "tok");
    expect(campaigns).toEqual([]);
    expect(error).toBe("(#100) Invalid account");
  });
});

describe("fetchAdsets", () => {
  it("lists ad sets that hold no ads yet", async () => {
    // The old insights-derived list could never show these, which made it
    // impossible to put the first ad into a fresh ad set.
    mockGraph([
      {
        body: {
          data: [
            {
              id: "as1",
              name: "Fresh ad set",
              status: "ACTIVE",
              effective_status: "ACTIVE",
              campaign_id: "c1",
            },
          ],
        },
      },
    ]);

    const { adsets } = await fetchAdsets("c1", "tok");
    expect(adsets).toHaveLength(1);
    expect(adsets[0].name).toBe("Fresh ad set");
  });

  it("queries the campaign's adsets edge", async () => {
    const urls = mockGraph([{ body: { data: [] } }]);
    await fetchAdsets("c1", "tok");
    expect(urls[0]).toContain("/c1/adsets");
    expect(urls[0]).not.toContain("insights");
  });
});
