import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllFbPages, PAGE_SOURCES } from "../pages";

type Route = (url: URL) => { status?: number; body: unknown } | null;

/**
 * Stand in for Graph. Routes are tried in order; the first match answers.
 * Anything unmatched returns an empty edge, which is what Meta does for an
 * edge the token simply has nothing on.
 */
function mockGraph(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      calls.push(`${url.pathname}?${url.searchParams.get("fields") ?? ""}`);
      for (const route of routes) {
        const hit = route(url);
        if (hit) {
          return {
            ok: (hit.status ?? 200) < 400,
            status: hit.status ?? 200,
            json: async () => hit.body,
          } as unknown as Response;
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response;
    })
  );
  return calls;
}

const page = (id: string, name: string, tasks?: string[]) => ({
  id,
  name,
  ...(tasks ? { tasks } : {}),
});

function on(pathSuffix: string, body: unknown, status?: number): Route {
  return (url) => (url.pathname.endsWith(pathSuffix) ? { status, body } : null);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAllFbPages", () => {
  it("merges pages across every edge and dedupes by id", async () => {
    mockGraph([
      on("/me/accounts", { data: [page("1", "I Love Patches")] }),
      on("/me/assigned_pages", {
        data: [page("1", "I Love Patches"), page("3", "Nurtelle")],
      }),
      on("/me", { business: { id: "biz1", name: "Tony BM" } }),
      on("/biz1/owned_pages", { data: [page("2", "FOLIQ"), page("3", "Nurtelle")] }),
    ]);

    const { pages } = await fetchAllFbPages("tok");

    expect(pages.map((p) => p.name)).toEqual([
      "FOLIQ",
      "I Love Patches",
      "Nurtelle",
    ]);
    const nurtelle = pages.find((p) => p.id === "3")!;
    expect(nurtelle.sources).toEqual([
      PAGE_SOURCES.ASSIGNED,
      PAGE_SOURCES.OWNED,
    ]);
  });

  it("finds the business for a System User, whose /me/businesses is empty", async () => {
    // The exact shape that hid a Page in production: /me/businesses answers
    // with an empty list rather than an error, so nothing downstream runs.
    mockGraph([
      on("/me/businesses", { data: [] }),
      on("/me/accounts", { data: [page("1", "I Love Patches")] }),
      on("/me", { business: { id: "biz1", name: "Tony BM" } }),
      on("/biz1/owned_pages", { data: [page("3", "Nurtelle")] }),
    ]);

    const { pages, counts } = await fetchAllFbPages("tok");

    expect(pages.map((p) => p.name)).toContain("Nurtelle");
    expect(counts[PAGE_SOURCES.OWNED]).toBe(1);
  });

  it("falls back to the business carried on an ad account", async () => {
    mockGraph([
      on("/me/businesses", { data: [] }),
      on("/me", { data: [] }), // no business field on the node
      on("/me/adaccounts", {
        data: [{ id: "act_1", business: { id: "biz9", name: "Tony BM" } }],
      }),
      on("/biz9/client_pages", { data: [page("3", "Nurtelle")] }),
    ]);

    const { pages } = await fetchAllFbPages("tok");
    expect(pages.map((p) => p.name)).toEqual(["Nurtelle"]);
  });

  it("retries without optional fields when Graph rejects one", async () => {
    // promote_pages rejects `tasks`; without the retry the whole edge — and
    // every Page on it — would vanish behind a 400.
    const calls = mockGraph([
      (url) => {
        if (!url.pathname.endsWith("/promote_pages")) return null;
        const fields = url.searchParams.get("fields") ?? "";
        if (fields.includes("tasks")) {
          return {
            status: 400,
            body: { error: { message: "(#100) Unknown fields: tasks." } },
          };
        }
        return { body: { data: [page("3", "Nurtelle")] } };
      },
      on("/me/adaccounts", { data: [{ id: "act_1", name: "TBM1 - NURTELLE" }] }),
    ]);

    const { pages, warnings } = await fetchAllFbPages("tok");

    expect(pages.map((p) => p.name)).toEqual(["Nurtelle"]);
    // Retried on the safe field set, and stayed quiet since it recovered.
    expect(calls.filter((c) => c.includes("promote_pages"))).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("keeps the pages one edge returned when another edge fails", async () => {
    mockGraph([
      on("/me/accounts", { data: [page("1", "I Love Patches")] }),
      on("/me", { business: { id: "biz1", name: "Tony BM" } }),
      on(
        "/biz1/owned_pages",
        { error: { message: "Permissions error" } },
        403
      ),
    ]);

    const { pages, warnings } = await fetchAllFbPages("tok");

    expect(pages.map((p) => p.name)).toEqual(["I Love Patches"]);
    expect(warnings.join(" ")).toContain("Permissions error");
  });

  it("keeps the richest task list when edges disagree", async () => {
    mockGraph([
      on("/me/accounts", { data: [page("3", "Nurtelle")] }),
      on("/me/assigned_pages", {
        data: [page("3", "Nurtelle", ["ADVERTISE", "MANAGE", "ANALYZE"])],
      }),
    ]);

    const { pages } = await fetchAllFbPages("tok");
    expect(pages[0].tasks).toEqual(["ADVERTISE", "MANAGE", "ANALYZE"]);
  });

  it("follows pagination instead of stopping at the first page of results", async () => {
    let served = 0;
    mockGraph([
      (url) => {
        if (!url.pathname.endsWith("/me/accounts")) return null;
        served++;
        return served === 1
          ? {
              body: {
                data: [page("1", "I Love Patches")],
                paging: {
                  next: "https://graph.facebook.com/v21.0/me/accounts?after=X",
                },
              },
            }
          : { body: { data: [page("3", "Nurtelle")] } };
      },
    ]);

    const { pages } = await fetchAllFbPages("tok");
    expect(pages.map((p) => p.name)).toEqual(["I Love Patches", "Nurtelle"]);
  });
});
