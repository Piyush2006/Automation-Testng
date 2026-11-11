/** Building the custody graph. src/lib/data.ts:132-158. */
import { describe, expect, it } from "vitest";
import { INV_COLS, SHEETS } from "@/config";
import { loadChain, type ChemicalItem } from "@/lib/data";
import { formatTotals } from "@/lib/quantity";
import { lotPage, makeFake } from "../helpers/fake-scispot";

const NaCl: ChemicalItem = { uuid: "u1", id: "IT001", name: "Sodium Chloride", synonyms: "NaCl" };

describe("loadChain() — the item-to-lot join", () => {
  it("CHAIN-001 | lots are found by an exact Name match on the inventory sheet", async () => {
    const fake = makeFake({
      search: () => lotPage([{ uuid: "l1", id: "MAT1", name: "Sodium Chloride", unit: "mL", left: "10" }]),
    });
    const chain = await loadChain(fake.client, NaCl);
    const call = fake.calls.search[0]!;
    expect(call.sheet).toBe(SHEETS.inventory);
    expect(call.match).toBe("all");
    expect(call.filters).toEqual([{ column: INV_COLS.description, operator: "Equals", value: "Sodium Chloride" }]);
    expect(chain.lots).toHaveLength(1);
  });

  it("CHAIN-002 | a lot whose Name differs only in case is still accepted", async () => {
    const fake = makeFake({
      search: () => lotPage([{ uuid: "l1", id: "MAT1", name: "sodium chloride", unit: "mL", left: "10" }]),
    });
    expect((await loadChain(fake.client, NaCl)).lots).toHaveLength(1);
  });

  it("CHAIN-003 | a lot whose Name has extra text is rejected by the client-side guard", async () => {
    const fake = makeFake({
      search: () => lotPage([
        { uuid: "l1", id: "MAT1", name: "Sodium Chloride", unit: "mL", left: "10" },
        { uuid: "l2", id: "MAT2", name: "Sodium Chloride (NaCl)", unit: "mL", left: "99" },
      ]),
    });
    const chain = await loadChain(fake.client, NaCl);
    expect(chain.lots.map((l) => l.internalId)).toEqual(["MAT1"]);
  });

  it("CHAIN-004 | a trailing space on either side breaks the join entirely || RCA: the join is a text `Equals` filter on Name (src/lib/data.ts:138) re-checked case-insensitively but NOT trimmed (src/lib/data.ts:145). Scispot has relational columns (Parent Stock / Connection / LOOKUP_REFERENCE) and the app uses none of them. User impact: the chemical renders with ZERO lots and the message 'No Materials Manager rows match this item name yet' — indistinguishable from genuinely having no stock. Highest-severity dependency in the manifest (DEP-COL-002 / DEP-COL-011).", async () => {
    const fake = makeFake({
      search: () => lotPage([{ uuid: "l1", id: "MAT1", name: "Sodium Chloride ", unit: "mL", left: "10" }]),
    });
    expect((await loadChain(fake.client, NaCl)).lots).toHaveLength(1);
  });

  it("CHAIN-005 | no matching rows yields an empty chain, not an error", async () => {
    const fake = makeFake({ search: () => lotPage([]) });
    const chain = await loadChain(fake.client, NaCl);
    expect(chain.lots).toEqual([]);
    expect(chain.totals).toEqual([]);
  });

  it("CHAIN-006 | duplicate rows across pages are deduped by row uuid", async () => {
    let call = 0;
    const fake = makeFake({
      search: () => {
        call++;
        const row = { uuid: "l1", id: "MAT1", name: "Sodium Chloride", unit: "mL", left: "10" };
        return call === 1 ? lotPage([row], 50) : lotPage([row]);
      },
    });
    expect((await loadChain(fake.client, NaCl)).lots).toHaveLength(1);
  });

  it("CHAIN-007 | lots are sorted numerically, so MAT2 comes before MAT10", async () => {
    const fake = makeFake({
      search: () => lotPage([
        { uuid: "l3", id: "MAT10", name: "Sodium Chloride" },
        { uuid: "l1", id: "MAT1", name: "Sodium Chloride" },
        { uuid: "l2", id: "MAT2", name: "Sodium Chloride" },
      ]),
    });
    expect((await loadChain(fake.client, NaCl)).lots.map((l) => l.internalId)).toEqual(["MAT1", "MAT2", "MAT10"]);
  });
});

describe("loadChain() — totals and field mapping", () => {
  it("CHAIN-010 | lot amounts reconcile into one total", async () => {
    const fake = makeFake({
      search: () => lotPage([
        { uuid: "l1", id: "MAT1", name: "Sodium Chloride", unit: "mL", left: "10" },
        { uuid: "l2", id: "MAT2", name: "Sodium Chloride", unit: "mL", left: "50" },
      ]),
    });
    expect(formatTotals((await loadChain(fake.client, NaCl)).totals)).toBe("60 mL");
  });

  it("CHAIN-011 | a lot with no recorded amount is listed as unmeasured and excluded from the total", async () => {
    const fake = makeFake({
      search: () => lotPage([
        { uuid: "l1", id: "MAT1", name: "Sodium Chloride", unit: "mL", left: "10" },
        { uuid: "l2", id: "MAT2", name: "Sodium Chloride" },
      ]),
    });
    const chain = await loadChain(fake.client, NaCl);
    expect(formatTotals(chain.totals)).toBe("10 mL");
    expect(chain.unmeasured.map((l) => l.internalId)).toEqual(["MAT2"]);
  });

  it("CHAIN-012 | Asset Location wins over Location, which is the fallback", async () => {
    const fake = makeFake({
      search: () => lotPage([
        { uuid: "l1", id: "MAT1", name: "Sodium Chloride", assetLocation: "Bench 3", location: "Freezer A" },
        { uuid: "l2", id: "MAT2", name: "Sodium Chloride", assetLocation: "", location: "Freezer A › Rack 1" },
        { uuid: "l3", id: "MAT3", name: "Sodium Chloride", assetLocation: "NA", location: "Freezer B" },
      ]),
    });
    const lots = (await loadChain(fake.client, NaCl)).lots;
    expect(lots[0]!.location).toBe("Bench 3");
    expect(lots[1]!.location).toBe("Freezer A › Rack 1");
    expect(lots[2]!.location, "an 'NA' Asset Location must fall through to Location").toBe("Freezer B");
  });

  it("CHAIN-013 | Supplier is the only vendor source and is mapped onto the lot", async () => {
    const fake = makeFake({
      search: () => lotPage([{ uuid: "l1", id: "MAT1", name: "Sodium Chloride", supplier: "Sigma-Aldrich" }]),
    });
    expect((await loadChain(fake.client, NaCl)).lots[0]!.manufacturer).toBe("Sigma-Aldrich");
  });

  it("CHAIN-014 | catalog, rin and qc stay empty because config maps them to no column", async () => {
    // Contract lock for DEP-COL-030/031/032. If these ever carry a value, the
    // manifest and the NodeSheet fields must be reviewed together.
    const fake = makeFake({
      search: () => lotPage([{ uuid: "l1", id: "MAT1", name: "Sodium Chloride" }]),
    });
    const lot = (await loadChain(fake.client, NaCl)).lots[0]!;
    expect(lot.catalog).toBe("");
    expect(lot.rin).toBe("");
    expect(lot.qc).toBe("");
  });

  it("CHAIN-015 | a name-matched lot is flagged as not properly linked || RCA: toLot() is called with linked=true for every row (src/lib/data.ts:146) and nothing ever passes false. So lot.linked is permanently true, which makes the 'Matched by name' badge (src/components/CustodyGraph.tsx:93) and the 'not linked yet' warning (src/components/CustodyGraph.tsx:218) dead code. The app's own safeguard for its weakest dependency can never fire, so users cannot tell a real link from a text match.", async () => {
    const fake = makeFake({
      search: () => lotPage([{ uuid: "l1", id: "MAT1", name: "Sodium Chloride" }]),
    });
    expect((await loadChain(fake.client, NaCl)).lots[0]!.linked).toBe(false);
  });

  it("CHAIN-016 | a Scispot failure while loading lots propagates so the UI can show its retry card", async () => {
    const fake = makeFake({ search: () => { throw new Error("timeout talking to Scispot"); } });
    await expect(loadChain(fake.client, NaCl)).rejects.toThrow("timeout");
  });
});
