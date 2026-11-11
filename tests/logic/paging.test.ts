/** Paging decisions. src/lib/sdk.ts:131-166. */
import { describe, expect, it } from "vitest";
import { collectPages, loadPage, type PageResult } from "@/lib/sdk";
import { itemPage, makeFake } from "../helpers/fake-scispot";

const items = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => [`u${offset + i}`, `IT${offset + i}`, `Item ${offset + i}`, ""] as [string, string, string, string]);

describe("loadPage() — which call is made", () => {
  it("PAGE-001 | with no filters it reads rows(), not search()", async () => {
    const fake = makeFake({ rows: () => itemPage(items(5)) });
    await loadPage(fake.client, "List of Inventory Items", { page: 1, pageSize: 25 });
    expect(fake.calls.rows).toEqual([{ sheet: "List of Inventory Items", page: 1, pageSize: 25 }]);
    expect(fake.calls.search).toEqual([]);
  });

  it("PAGE-002 | with filters it calls search() and defaults match to 'all'", async () => {
    const fake = makeFake({ search: () => itemPage(items(1)) });
    await loadPage(fake.client, "List of Inventory Items", {
      page: 1,
      pageSize: 25,
      filters: [{ column: "Item Name", operator: "Equals", value: "NaCl" }],
    });
    expect(fake.calls.search).toHaveLength(1);
    expect(fake.calls.search[0]!.match).toBe("all");
    expect(fake.calls.rows).toEqual([]);
  });

  it("PAGE-003 | match 'any' is passed through unchanged", async () => {
    const fake = makeFake({ search: () => itemPage(items(1)) });
    await loadPage(fake.client, "List of Inventory Items", {
      page: 1,
      pageSize: 25,
      match: "any",
      filters: [{ column: "Item Name", operator: "Contains", value: "so" }],
    });
    expect(fake.calls.search[0]!.match).toBe("any");
  });
});

describe("loadPage() — is there another page?", () => {
  it("PAGE-010 | a trustworthy total says yes and is reported", async () => {
    const fake = makeFake({ rows: () => itemPage(items(25), 100) });
    const result = await loadPage(fake.client, "S", { page: 1, pageSize: 25 });
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(100);
  });

  it("PAGE-011 | a total exactly reached says no", async () => {
    const fake = makeFake({ rows: () => itemPage(items(25), 25) });
    expect((await loadPage(fake.client, "S", { page: 1, pageSize: 25 })).hasMore).toBe(false);
  });

  it("PAGE-012 | page 2 of 60 still has more", async () => {
    const fake = makeFake({ rows: () => itemPage(items(25), 60) });
    expect((await loadPage(fake.client, "S", { page: 2, pageSize: 25 })).hasMore).toBe(true);
  });

  it("PAGE-013 | with no total, a full page is assumed to have more", async () => {
    const fake = makeFake({ rows: () => itemPage(items(25)) });
    const result = await loadPage(fake.client, "S", { page: 1, pageSize: 25 });
    expect(result.hasMore).toBe(true);
    expect(result.total).toBeUndefined();
  });

  it("PAGE-014 | with no total, a short page ends the walk", async () => {
    const fake = makeFake({ rows: () => itemPage(items(10)) });
    expect((await loadPage(fake.client, "S", { page: 1, pageSize: 25 })).hasMore).toBe(false);
  });

  it("PAGE-015 | a total smaller than the rows returned is distrusted and not reported", async () => {
    const fake = makeFake({ rows: () => itemPage(items(5), 2) });
    const result = await loadPage(fake.client, "S", { page: 1, pageSize: 25 });
    expect(result.total).toBeUndefined();
    expect(result.hasMore).toBe(false);
  });

  it("PAGE-016 | Jazz capping a page below the requested size ends the walk", async () => {
    // sdk.ts:153 warns Jazz may return fewer rows than pageSize.
    const fake = makeFake({ rows: () => itemPage(items(20)) });
    expect((await loadPage(fake.client, "S", { page: 1, pageSize: 25 })).hasMore).toBe(false);
  });
});

describe("collectPages() — walking every page", () => {
  const loader = (pages: PageResult[]) => {
    let calls = 0;
    const load = async (page: number) => {
      calls++;
      return pages[page - 1] ?? { rows: [], hasMore: false };
    };
    return { load, callCount: () => calls };
  };

  it("PAGE-020 | stops as soon as a page reports no more", async () => {
    const { load, callCount } = loader([
      { rows: [{ __uuid: "a" }], hasMore: true },
      { rows: [{ __uuid: "b" }], hasMore: false },
      { rows: [{ __uuid: "c" }], hasMore: true },
    ]);
    const rows = await collectPages(load);
    expect(rows.map((r) => r.__uuid)).toEqual(["a", "b"]);
    expect(callCount()).toBe(2);
  });

  it("PAGE-021 | duplicate rows across pages are deduped by uuid", async () => {
    const { load } = loader([
      { rows: [{ __uuid: "a" }, { __uuid: "b" }], hasMore: true },
      { rows: [{ __uuid: "b" }, { __uuid: "c" }], hasMore: false },
    ]);
    expect((await collectPages(load)).map((r) => r.__uuid)).toEqual(["a", "b", "c"]);
  });

  it("PAGE-022 | a page that adds nothing new stops the walk (infinite-loop guard)", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return { rows: [{ __uuid: "same" }], hasMore: true };
    };
    const rows = await collectPages(load);
    expect(rows).toHaveLength(1);
    expect(calls, "RCA: collectPages must stop when a page returns only uuids it already has, or a backend that ignores `page` loops until maxPages.").toBe(2);
  });

  it("PAGE-023 | the walk is capped so one chemical cannot fetch unboundedly", async () => {
    let calls = 0;
    const load = async (page: number) => {
      calls++;
      return { rows: [{ __uuid: `u${page}` }], hasMore: true };
    };
    await collectPages(load, 3);
    expect(calls).toBe(3);
  });

  it("PAGE-024 | the default cap is 40 pages (1000 rows at pageSize 25)", async () => {
    let calls = 0;
    const load = async (page: number) => {
      calls++;
      return { rows: [{ __uuid: `u${page}` }], hasMore: true };
    };
    await collectPages(load);
    expect(calls, "RCA: a chemical with more than 40 pages of lots is silently truncated — the graph and the total would be wrong with no warning.").toBe(40);
  });
});
