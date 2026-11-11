/** How raw Scispot cells become screen text. src/lib/data.ts:77 and src/lib/sdk.ts:110-127. */
import { describe, expect, it } from "vitest";
import { filled } from "@/lib/data";
import { cell } from "@/lib/sdk";
import { rowOf } from "../helpers/fake-scispot";

describe("filled() — placeholder values must read as empty", () => {
  it.each([
    ["LOGIC-040", "NA"],
    ["LOGIC-041", "n/a"],
    ["LOGIC-042", "N/A"],
    ["LOGIC-043", "none"],
    ["LOGIC-044", "NONE"],
    ["LOGIC-045", "-"],
    ["LOGIC-046", "---"],
    ["LOGIC-047", "—"],
    ["LOGIC-048", "  NA  "],
  ])("%s | %j reads as empty", (_id, input) => {
    expect(filled(input)).toBe("");
  });

  it("LOGIC-050 | a real value survives and is trimmed", () => {
    expect(filled("  Sigma-Aldrich  ")).toBe("Sigma-Aldrich");
  });

  it("LOGIC-051 | a value that merely starts with 'na' is NOT swallowed", () => {
    expect(filled("NaCl")).toBe("NaCl");
    expect(filled("Not available")).toBe("Not available");
    expect(filled("Nanomaterial")).toBe("Nanomaterial");
  });

  it("LOGIC-052 | an already-empty value stays empty", () => {
    expect(filled("")).toBe("");
    expect(filled("   ")).toBe("");
  });
});

describe("cell() — every Scispot cell shape must flatten to text", () => {
  it("LOGIC-060 | plain strings are trimmed", () => {
    expect(cell(rowOf({ Name: "  Sodium Chloride  " }), "Name")).toBe("Sodium Chloride");
  });

  it("LOGIC-061 | a missing column reads as empty, not 'undefined'", () => {
    expect(cell(rowOf({}), "Nope")).toBe("");
  });

  it("LOGIC-062 | null and undefined read as empty", () => {
    expect(cell(rowOf({ A: null, B: undefined }), "A")).toBe("");
    expect(cell(rowOf({ A: null, B: undefined }), "B")).toBe("");
  });

  it("LOGIC-063 | numbers survive, including zero", () => {
    expect(cell(rowOf({ Q: 0 }), "Q")).toBe("0");
    expect(cell(rowOf({ Q: 12.5 }), "Q")).toBe("12.5");
  });

  it("LOGIC-064 | booleans (CHECKBOX columns) read as text", () => {
    expect(cell(rowOf({ Reorder: false }), "Reorder")).toBe("false");
    expect(cell(rowOf({ Reorder: true }), "Reorder")).toBe("true");
  });

  it("LOGIC-065 | arrays (multi-value cells) join with commas and drop blanks", () => {
    expect(cell(rowOf({ Tags: ["a", "", "b"] }), "Tags")).toBe("a, b");
  });

  it("LOGIC-066 | object cells are read from label / name / value / display", () => {
    expect(cell(rowOf({ C: { label: "Chemicals" } }), "C")).toBe("Chemicals");
    expect(cell(rowOf({ C: { name: "Freezer A" } }), "C")).toBe("Freezer A");
    expect(cell(rowOf({ C: { value: "42" } }), "C")).toBe("42");
    expect(cell(rowOf({ C: { display: "shown" } }), "C")).toBe("shown");
  });

  it("LOGIC-067 | a nested object cell is unwrapped", () => {
    expect(cell(rowOf({ C: { label: { name: "Rack 1" } } }), "C")).toBe("Rack 1");
  });

  it("LOGIC-068 | an unrecognised object shape reads as empty rather than '[object Object]'", () => {
    expect(cell(rowOf({ C: { unexpected: "x" } }), "C")).toBe("");
  });
});
