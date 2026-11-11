/** Turning a Jazz row page into objects. src/lib/sdk.ts:85-108. */
import { describe, expect, it } from "vitest";
import { rowsToObjects } from "@/lib/sdk";

describe("rowsToObjects()", () => {
  it("LOGIC-070 | headers[0] 'uuid' becomes __uuid", () => {
    const rows = rowsToObjects({ headers: ["uuid", "Name"], rows: [["u1", "NaCl"]] });
    expect(rows).toEqual([{ __uuid: "u1", Name: "NaCl" }]);
  });

  it("LOGIC-071 | a page nested under `data` is unwrapped", () => {
    const rows = rowsToObjects({ data: { headers: ["uuid", "Name"], rows: [["u1", "NaCl"]] } });
    expect(rows).toEqual([{ __uuid: "u1", Name: "NaCl" }]);
  });

  it("LOGIC-072 | rows with no uuid are dropped (they cannot be identified or deep-linked)", () => {
    const rows = rowsToObjects({ headers: ["uuid", "Name"], rows: [["", "ghost"], ["u2", "real"]] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.__uuid).toBe("u2");
  });

  it("LOGIC-073 | a page with no uuid header yields nothing", () => {
    expect(rowsToObjects({ headers: ["Name"], rows: [["NaCl"]] })).toEqual([]);
  });

  it("LOGIC-074 | malformed payloads yield an empty list instead of throwing", () => {
    expect(rowsToObjects(undefined)).toEqual([]);
    expect(rowsToObjects(null)).toEqual([]);
    expect(rowsToObjects({})).toEqual([]);
    expect(rowsToObjects("nope")).toEqual([]);
    expect(rowsToObjects({ headers: ["uuid"] })).toEqual([]);
    expect(rowsToObjects({ rows: [["u1"]] })).toEqual([]);
  });

  it("LOGIC-075 | non-array entries inside rows are skipped", () => {
    const rows = rowsToObjects({ headers: ["uuid", "Name"], rows: [["u1", "ok"], "garbage", null] as unknown[][] });
    expect(rows).toHaveLength(1);
  });

  it("LOGIC-076 | extra headers with no value read as empty", () => {
    const rows = rowsToObjects({ headers: ["uuid", "Name", "Lot Number"], rows: [["u1", "NaCl"]] });
    expect(rows[0]!["Lot Number"]).toBeUndefined();
  });
});
