/**
 * The quantity maths the app ACTUALLY runs.
 *
 * src/lib/data.ts:65 calls lotQuantityFromFields(). The pre-existing suite
 * (src/lib/quantity.test.ts) only covers lotQuantity()/parseUnit(), which
 * nothing in the app imports — so this file is the real coverage.
 *
 * Test name convention:  ID | what it checks || RCA: why a failure happens
 */
import { describe, expect, it } from "vitest";
import { formatAmount, formatTotals, lotQuantityFromFields, sumAmounts, type Amount } from "@/lib/quantity";

const fields = (over: Partial<Parameters<typeof lotQuantityFromFields>[0]> = {}) =>
  lotQuantityFromFields({ quantity: "", totalQuantity: "", remaining: "", consumed: "", unit: "", ...over });

describe("amount left — which column wins", () => {
  it("LOGIC-001 | Quantity Left is the primary source", () => {
    const q = fields({ remaining: "100", unit: "mL" });
    expect(q.left).toEqual({ value: 100, unit: "mL", family: "volume" });
  });

  it("LOGIC-002 | falls back to Total Quantity when Quantity Left is blank", () => {
    expect(fields({ totalQuantity: "50", unit: "mL" }).left?.value).toBe(50);
  });

  it("LOGIC-003 | falls back to Quantity when both are blank", () => {
    expect(fields({ quantity: "25", unit: "mL" }).left?.value).toBe(25);
  });

  it("LOGIC-004 | reports no amount when all three are blank", () => {
    const q = fields({ unit: "mL" });
    expect(q.left).toBeUndefined();
    expect(q.containers).toBe(1);
  });

  it("LOGIC-005 | zero is a real amount, not a missing one", () => {
    const q = fields({ remaining: "0", unit: "mL" });
    expect(q.left).toEqual({ value: 0, unit: "mL", family: "volume" });
  });

  it("LOGIC-006 | a negative Quantity Left is ignored and the next column is used", () => {
    expect(fields({ remaining: "-5", totalQuantity: "80", unit: "mL" }).left?.value).toBe(80);
  });

  it("LOGIC-007 | non-numeric text is ignored and the next column is used", () => {
    expect(fields({ remaining: "abc", totalQuantity: "80", unit: "mL" }).left?.value).toBe(80);
  });

  it("LOGIC-008 | Quantity Consumed is read when present", () => {
    const q = fields({ quantity: "100", remaining: "60", consumed: "40", unit: "mL" });
    expect(q.left?.value).toBe(60);
    expect(q.consumed?.value).toBe(40);
    expect(q.size?.value).toBe(100);
  });

  it("LOGIC-009 | a decimal written with a comma is read as a number || RCA: parseCount() (src/lib/quantity.ts:70) calls Number('1,5') which is NaN, so the value is silently discarded and the app falls through to another column or shows 'not recorded'. parseUnit() handles commas via toNumber() — the two number parsers disagree. Latent today because the sandbox Quantity columns are NUMBER type, but any TEXT/locale-formatted source triggers it.", () => {
    expect(fields({ remaining: "1,5", unit: "mL" }).left?.value).toBe(1.5);
  });
});

describe("units", () => {
  it("LOGIC-010 | a blank Unit degrades to a bare count, never to mL", () => {
    expect(fields({ remaining: "100" }).left).toEqual({ value: 100, unit: "units", family: "count" });
  });

  it("LOGIC-011 | uL is normalised to mL", () => {
    expect(fields({ remaining: "1000", unit: "uL" }).left).toEqual({ value: 1, unit: "mL", family: "volume" });
  });

  it("LOGIC-012 | gm is normalised to g and stays mass", () => {
    expect(fields({ remaining: "250", unit: "gm" }).left).toEqual({ value: 250, unit: "g", family: "mass" });
  });

  it("LOGIC-013 | Each stays a count", () => {
    expect(fields({ remaining: "5", unit: "Each" }).left).toEqual({ value: 5, unit: "each", family: "count" });
  });

  it("LOGIC-014 | an unrecognised Unit value degrades to a count under its own label", () => {
    expect(fields({ remaining: "3", unit: "bottles" }).left).toEqual({ value: 3, unit: "bottles", family: "count" });
  });

  it("LOGIC-015 | every Unit option in the Scispot LIST is recognised as the right kind of measure", () => {
    // Options come from A. Materials Manager -> Unit in tests/deps/scispot-snapshot.json
    const expected: Array<[unit: string, family: "volume" | "mass" | "count"]> = [
      ["uL", "volume"],
      ["mL", "volume"],
      ["L", "volume"],
      ["ng", "mass"],
      ["ug", "mass"],
      ["mg", "mass"],
      ["gm", "mass"],
      ["Each", "count"],
    ];
    const wrong = expected.filter(([unit, family]) => fields({ remaining: "1", unit }).left?.family !== family);
    expect(
      wrong.map(([unit]) => unit),
      "RCA: these Unit options exist in the Scispot LIST but are missing from UNIT_TABLE (src/lib/quantity.ts:18). amount() falls through to its default and labels them family 'count', so lots measured in them are NEVER added into the mass or volume total and silently vanish from the reconcile banner.",
    ).toEqual([]);
  });
});

describe("totals", () => {
  it("LOGIC-020 | same unit adds up", () => {
    const left = (remaining: string, unit: string) => fields({ remaining, unit }).left;
    expect(formatTotals(sumAmounts([left("10", "mL"), left("50", "mL")]))).toBe("60 mL");
  });

  it("LOGIC-021 | uL and mL combine after normalisation", () => {
    const left = (remaining: string, unit: string) => fields({ remaining, unit }).left;
    expect(formatTotals(sumAmounts([left("500", "uL"), left("2", "mL")]))).toBe("2.5 mL");
  });

  it("LOGIC-022 | volume and mass are kept apart, volume first", () => {
    const left = (remaining: string, unit: string) => fields({ remaining, unit }).left;
    expect(formatTotals(sumAmounts([left("100", "gm"), left("25", "mL")]))).toBe("25 mL · 100 g");
  });

  it("LOGIC-023 | counts are never added into a volume total", () => {
    const left = (remaining: string, unit: string) => fields({ remaining, unit }).left;
    expect(formatTotals(sumAmounts([left("3", "Each"), left("2", "mL")]))).toBe("2 mL · 3 each");
  });

  it("LOGIC-024 | lots with no amount are skipped, not counted as zero", () => {
    const left = (remaining: string, unit: string) => fields({ remaining, unit }).left;
    expect(formatTotals(sumAmounts([left("10", "mL"), undefined, left("5", "mL")]))).toBe("15 mL");
  });

  it("LOGIC-025 | an empty set of lots produces no totals", () => {
    expect(sumAmounts([])).toEqual([]);
    expect(formatTotals([])).toBe("");
  });

  it("LOGIC-026 | floating-point noise is rounded away", () => {
    expect(formatAmount({ value: 0.1 + 0.2, unit: "mL", family: "volume" } as Amount)).toBe("0.3 mL");
  });

  it("LOGIC-027 | large amounts get thousands separators", () => {
    expect(formatAmount({ value: 1234.56789, unit: "mL", family: "volume" } as Amount)).toBe("1,234.568 mL");
  });
});

describe("container counts (contract lock)", () => {
  it("LOGIC-030 | containers and containersLeft are always 1 on this tenant", () => {
    // Locked deliberately: src/lib/quantity.ts:112 hardcodes both to 1 because the
    // sandbox stores an amount, not a container count. Consequence: the "(N left)"
    // suffix in NodeSheet.containersLine (src/components/NodeSheet.tsx:23) is
    // unreachable. If this test ever fails, that dead UI branch has come alive and
    // needs reviewing.
    const q = fields({ quantity: "5", remaining: "3", unit: "mL" });
    expect(q.containers).toBe(1);
    expect(q.containersLeft).toBe(1);
  });
});
