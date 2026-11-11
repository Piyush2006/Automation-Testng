import { describe, expect, it } from "vitest";
import { formatAmount, formatTotals, lotQuantity, parseUnit, sumAmounts } from "./quantity";

describe("parseUnit", () => {
  it("reads a plain volume", () => {
    expect(parseUnit("10 mL").size).toEqual({ value: 10, unit: "mL", family: "volume" });
    expect(parseUnit("50 mL ").size?.value).toBe(50);
  });

  it("normalizes litres and kilograms", () => {
    expect(parseUnit("4L").size).toEqual({ value: 4000, unit: "mL", family: "volume" });
    expect(parseUnit("1KG").size).toEqual({ value: 1000, unit: "g", family: "mass" });
    expect(parseUnit("2Kg").size?.value).toBe(2000);
    expect(parseUnit("100G").size).toEqual({ value: 100, unit: "g", family: "mass" });
  });

  it("multiplies pack notation", () => {
    expect(parseUnit("10x3mL").size).toEqual({ value: 30, unit: "mL", family: "volume" });
    expect(parseUnit("2X100mL").size?.value).toBe(200);
  });

  it("reads the amount left in parentheses", () => {
    const parsed = parseUnit("1000 mL (750 mL)");
    expect(parsed.size?.value).toBe(1000);
    expect(parsed.remainingPerContainer?.value).toBe(750);
    expect(parseUnit("50 mL (45mL)").remainingPerContainer?.value).toBe(45);
  });

  it("keeps counts as their own unit", () => {
    expect(parseUnit("5 bags").size).toEqual({ value: 5, unit: "bags", family: "count" });
    expect(parseUnit("10").size).toEqual({ value: 10, unit: "units", family: "count" });
  });

  it("returns nothing for blanks and NA", () => {
    expect(parseUnit("")).toEqual({});
    expect(parseUnit("NA")).toEqual({});
  });
});

describe("lotQuantity", () => {
  it("matches the ticket's mercaptoethanol example (10 mL + 50 mL = 60 mL)", () => {
    const sigma = lotQuantity({ quantity: "1", remaining: "1", unit: "10 mL" });
    const gibco = lotQuantity({ quantity: "1", remaining: "1", unit: "50 mL" });
    expect(sigma.left?.value).toBe(10);
    expect(gibco.left?.value).toBe(50);
    expect(formatTotals(sumAmounts([sigma.left, gibco.left]))).toBe("60 mL");
  });

  it("uses containers left times the amount left per container", () => {
    const citric = lotQuantity({ quantity: "2", remaining: "", unit: "1000 mL (600 mL)" });
    expect(citric.left?.value).toBe(1200);
    expect(citric.consumed?.value).toBe(800);
  });

  it("drops consumed containers from what is left", () => {
    const glycerol = lotQuantity({ quantity: "2", remaining: "1", unit: "100 mL" });
    expect(glycerol.left?.value).toBe(100);
    expect(glycerol.consumed?.value).toBe(100);
  });

  it("never reports negative consumption", () => {
    const odd = lotQuantity({ quantity: "1", remaining: "1", unit: "500 mL (750mL)" });
    expect(odd.left?.value).toBe(750);
    expect(odd.consumed?.value).toBe(0);
  });

  it("has no amount when the unit is not recorded", () => {
    const kit = lotQuantity({ quantity: "1", remaining: "1", unit: "NA" });
    expect(kit.left).toBeUndefined();
    expect(kit.containers).toBe(1);
  });
});

describe("sumAmounts", () => {
  it("keeps volume and mass apart", () => {
    const urea = sumAmounts([
      lotQuantity({ quantity: "1", remaining: "1", unit: "1000g" }).left,
      lotQuantity({ quantity: "1", remaining: "1", unit: "25 mL" }).left,
    ]);
    expect(formatTotals(urea)).toBe("25 mL · 1,000 g");
  });

  it("formats decimals without noise", () => {
    expect(formatAmount({ value: 0.1 + 0.2, unit: "mL", family: "volume" })).toBe("0.3 mL");
  });
});
