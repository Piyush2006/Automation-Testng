/** The search box's contract with Scispot. src/lib/data.ts:84-130. */
import { describe, expect, it } from "vitest";
import { ITEM_COLS, LOOKUP_PAGE_SIZE, SHEETS } from "@/config";
import { resolveItem, searchItems } from "@/lib/data";
import { itemPage, makeFake } from "../helpers/fake-scispot";

const CATALOGUE: Array<[string, string, string, string]> = [
  ["u1", "IT001", "Sodium Chloride", "NaCl, table salt"],
  ["u2", "IT002", "Sodium Hydroxide", "NaOH"],
];

describe("searchItems()", () => {
  it("CONTRACT-001 | an empty term browses rows() on the catalogue sheet", async () => {
    const fake = makeFake({ rows: () => itemPage(CATALOGUE) });
    const result = await searchItems(fake.client, "   ", 1);
    expect(fake.calls.rows[0]).toEqual({ sheet: SHEETS.items, page: 1, pageSize: LOOKUP_PAGE_SIZE });
    expect(result.items.map((i) => i.name)).toEqual(["Sodium Chloride", "Sodium Hydroxide"]);
  });

  it("CONTRACT-002 | a typed term searches Item Name, Note AND ID with match 'any'", async () => {
    const fake = makeFake({ search: () => itemPage([CATALOGUE[0]!]) });
    await searchItems(fake.client, "sod", 1);
    const call = fake.calls.search[0]!;
    expect(call.sheet).toBe(SHEETS.items);
    expect(call.match).toBe("any");
    expect(call.filters).toEqual([
      { column: ITEM_COLS.name, operator: "Contains", value: "sod" },
      { column: ITEM_COLS.synonyms, operator: "Contains", value: "sod" },
      { column: ITEM_COLS.id, operator: "Contains", value: "sod" },
    ]);
  });

  it("CONTRACT-003 | when the ID filter is rejected it retries on name + note only", async () => {
    // This is the LIVE path: `ID` is ID_BARCODE and Scispot refuses `Contains` on it.
    let attempt = 0;
    const fake = makeFake({
      search: () => {
        attempt++;
        if (attempt === 1) throw new Error("Contains is not supported on ID_BARCODE");
        return itemPage([CATALOGUE[0]!]);
      },
    });
    const result = await searchItems(fake.client, "sod", 1);
    expect(fake.calls.search).toHaveLength(2);
    expect(fake.calls.search[1]!.filters.map((f) => f.column)).toEqual([ITEM_COLS.name, ITEM_COLS.synonyms]);
    expect(result.items).toHaveLength(1);
  });

  it("CONTRACT-004 | searching by a full item ID returns that item || RCA: the only ID filter the app sends is `Contains` on an ID_BARCODE column (src/lib/data.ts:100), which Scispot rejects. The catch at src/lib/data.ts:102 then retries WITHOUT the ID filter, so an item ID never matches anything. The SDK exposes labsheets.getRowById() for exactly this lookup and the app does not use it. User impact: the placeholder says 'Type a name, note, or item ID' but item IDs silently return nothing.", async () => {
    // A faithful Scispot: it refuses `Contains` on ID_BARCODE, and it only
    // searches the columns it was actually given.
    const fake = makeFake({
      search: (_name, opts) => {
        if (opts.filters.some((f) => f.column === ITEM_COLS.id && f.operator === "Contains")) {
          throw new Error("Contains is not supported on an ID_BARCODE column");
        }
        const columns = opts.filters.map((f) => f.column);
        const q = opts.filters[0]!.value.toLowerCase();
        return itemPage(
          CATALOGUE.filter(([, id, name, note]) => {
            const haystack: string[] = [];
            if (columns.includes(ITEM_COLS.name)) haystack.push(name);
            if (columns.includes(ITEM_COLS.synonyms)) haystack.push(note);
            if (columns.includes(ITEM_COLS.id)) haystack.push(id);
            return haystack.some((v) => v.toLowerCase().includes(q));
          }),
        );
      },
    });
    const result = await searchItems(fake.client, "IT001", 1);
    expect(result.items.map((i) => i.id)).toEqual(["IT001"]);
  });

  it("CONTRACT-005 | rows with a blank Item Name are hidden from the dropdown", async () => {
    const fake = makeFake({ rows: () => itemPage([["u3", "IT003", "", "orphan"], ...CATALOGUE]) });
    const result = await searchItems(fake.client, "", 1);
    expect(result.items.map((i) => i.id)).toEqual(["IT001", "IT002"]);
  });

  it("CONTRACT-006 | a 'NA' Note is cleaned so the dropdown shows no placeholder text", async () => {
    const fake = makeFake({ rows: () => itemPage([["u4", "IT004", "Urea", "NA"]]) });
    const result = await searchItems(fake.client, "", 1);
    expect(result.items[0]!.synonyms).toBe("");
  });

  it("CONTRACT-007 | a Scispot failure on the first attempt AND the retry propagates to the UI", async () => {
    const fake = makeFake({ search: () => { throw new Error("backend unavailable"); } });
    await expect(searchItems(fake.client, "sod", 1)).rejects.toThrow("backend unavailable");
  });
});

describe("resolveItem() — deep links and pressing Enter", () => {
  it("CONTRACT-010 | an IT-pattern query is looked up by ID Equals first, uppercased", async () => {
    const fake = makeFake({
      search: (_n, opts) => (opts.filters[0]!.column === ITEM_COLS.id ? itemPage([CATALOGUE[0]!]) : itemPage([])),
    });
    const item = await resolveItem(fake.client, "it001");
    expect(fake.calls.search[0]!.filters).toEqual([{ column: ITEM_COLS.id, operator: "Equals", value: "IT001" }]);
    expect(item?.id).toBe("IT001");
  });

  it("CONTRACT-011 | an exact name resolves regardless of case", async () => {
    const fake = makeFake({
      search: (_n, opts) => (opts.filters[0]!.column === ITEM_COLS.name && opts.filters[0]!.operator === "Equals" ? itemPage([CATALOGUE[0]!]) : itemPage([])),
    });
    const item = await resolveItem(fake.client, "sodium chloride");
    expect(item?.name).toBe("Sodium Chloride");
  });

  it("CONTRACT-012 | a single loose match is accepted", async () => {
    let call = 0;
    const fake = makeFake({
      search: () => {
        call++;
        return call === 1 ? itemPage([]) : itemPage([CATALOGUE[1]!]);
      },
    });
    expect((await resolveItem(fake.client, "hydrox"))?.id).toBe("IT002");
  });

  it("CONTRACT-013 | an ambiguous term resolves to nothing rather than guessing", async () => {
    let call = 0;
    const fake = makeFake({
      search: () => {
        call++;
        return call === 1 ? itemPage([]) : itemPage(CATALOGUE);
      },
    });
    expect(await resolveItem(fake.client, "sodium")).toBeNull();
  });

  it("CONTRACT-014 | an empty query resolves to nothing without calling Scispot", async () => {
    const fake = makeFake();
    expect(await resolveItem(fake.client, "  ")).toBeNull();
    expect(fake.calls.search).toEqual([]);
    expect(fake.calls.rows).toEqual([]);
  });
});
