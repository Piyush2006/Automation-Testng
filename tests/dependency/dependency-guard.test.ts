/**
 * THE DEPENDENCY GUARD
 *
 * Fails when the app's code, the dependency manifest, and the captured Scispot
 * schema stop agreeing. This is the check to run BEFORE changing a labsheet:
 * a red test here names the column and the user-visible consequence.
 *
 *   code     — src/config.ts (SHEETS, ITEM_COLS, INV_COLS, EXPECTED_COLUMNS)
 *   manifest — tests/deps/manifest.ts
 *   Scispot  — tests/deps/scispot-snapshot.json  (refresh: npm run deps:refresh)
 */
import { describe, expect, it } from "vitest";
import { EXPECTED_COLUMNS, INV_COLS, ITEM_COLS, SHEETS } from "@/config";
import { lotQuantityFromFields } from "@/lib/quantity";
import { ACTION_DEPS, CALL_DEPS, COLUMN_DEPS, SHEET_DEPS } from "../deps/manifest";
import snapshot from "../deps/scispot-snapshot.json";

type Column = { name: string; type: string };
const SHEETS_LIVE = snapshot.sheets as Record<string, Column[]>;
const OPTIONS_LIVE = snapshot.listOptions as Record<string, Record<string, string[]>>;

const columnsOf = (sheet: string) => SHEETS_LIVE[sheet] ?? [];
const typeOf = (sheet: string, column: string) => columnsOf(sheet).find((c) => c.name === column)?.type;

/** Every column the app reads, taken straight from config so it cannot drift. */
const CODE_COLUMNS: Array<{ sheet: string; column: string; key: string }> = [
  ...Object.entries(ITEM_COLS).map(([key, column]) => ({ sheet: SHEETS.items, column, key: `ITEM_COLS.${key}` })),
  ...Object.entries(INV_COLS).map(([key, column]) => ({ sheet: SHEETS.inventory, column, key: `INV_COLS.${key}` })),
].filter((c) => c.column !== "");

describe("sheets", () => {
  it("GUARD-001 | every labsheet the app names still exists in Scispot", () => {
    const missing = Object.entries(SHEETS as Record<string, string>)
      .filter(([, sheet]) => sheet && !SHEETS_LIVE[sheet])
      .map(([key, sheet]) => `SHEETS.${key} ("${sheet}")`);
    expect(
      missing.join("  |  "),
      "RCA: a labsheet named in src/config.ts is not in the captured Scispot schema. It has been renamed, archived or deleted. The app cannot read it and the 'Open ...' button cannot resolve it.",
    ).toBe("");
  });

  it("GUARD-002 | every labsheet in the manifest is one the app actually names", () => {
    const declared: string[] = Object.values(SHEETS).filter(Boolean);
    const stray = SHEET_DEPS.filter((d) => !declared.includes(d.sheet)).map((d) => `${d.id} (${d.sheet})`);
    expect(stray, "RCA: the manifest lists a labsheet the code no longer uses. Remove the entry or restore the usage.").toEqual([]);
  });

  it("GUARD-003 | every labsheet the app names is documented in the manifest", () => {
    const documented: string[] = SHEET_DEPS.map((d) => d.sheet);
    const undocumented: string[] = Object.values(SHEETS).filter((s) => s && !documented.includes(s));
    expect(undocumented, "RCA: a labsheet dependency exists in code but is missing from the manifest, so a Scispot change to it would not be flagged.").toEqual([]);
  });
});

describe("columns", () => {
  it("GUARD-010 | every column the app reads still exists in Scispot", () => {
    const missing = CODE_COLUMNS.filter((c) => !typeOf(c.sheet, c.column)).map(
      (c) => `${c.key} -> "${c.sheet}" has no column "${c.column}"`,
    );
    expect(
      missing.join("  |  "),
      "RCA: the app reads a column that is no longer in the Scispot schema. Every cell read through it comes back empty, so the matching field disappears from the UI (or, for a quantity column, the total silently changes). THIS IS THE CHECK THAT SHOULD BLOCK A LABSHEET CHANGE.",
    ).toBe("");
  });

  it("GUARD-011 | every column the app reads has the type the manifest expects", () => {
    const mismatched = COLUMN_DEPS.filter((d) => d.column !== "")
      .map((d) => ({ dep: d, live: typeOf(d.sheet, d.column) }))
      .filter((x) => x.live !== undefined && x.live !== x.dep.expectedType)
      .map((x) => `${x.dep.id} "${x.dep.sheet}" -> "${x.dep.column}": manifest expects ${x.dep.expectedType}, Scispot now has ${x.live}`);
    expect(
      mismatched.join("  |  "),
      "RCA: a column changed type. Reads still succeed but the VALUE SHAPE changes (a LIST reads back as a label, a LOCATION as a breadcrumb, a DATE as ISO text), so parsing and totals can be wrong without any error.",
    ).toBe("");
  });

  it("GUARD-012 | every column the app reads is documented in the manifest", () => {
    const documented = new Set(COLUMN_DEPS.filter((d) => d.column !== "").map((d) => `${d.sheet}::${d.column}`));
    const undocumented = CODE_COLUMNS.filter((c) => !documented.has(`${c.sheet}::${c.column}`)).map(
      (c) => `${c.key} ("${c.sheet}" -> "${c.column}")`,
    );
    expect(
      undocumented.join("  |  "),
      "RCA: src/config.ts reads a column that is not in the manifest. An undocumented dependency is invisible to the pre-change check, so someone could rename it believing nothing depends on it.",
    ).toBe("");
  });

  it("GUARD-013 | manifest columns all exist in Scispot", () => {
    const stale = COLUMN_DEPS.filter((d) => d.column !== "" && !typeOf(d.sheet, d.column)).map(
      (d) => `${d.id} "${d.sheet}" -> "${d.column}"`,
    );
    expect(stale.join("  |  "), "RCA: the manifest documents a column Scispot no longer has. Either the snapshot is stale (run npm run deps:refresh) or the column really is gone.").toBe("");
  });

  it("GUARD-014 | the load-time warning covers every column the app reads", () => {
    const warned = new Set(
      Object.entries(EXPECTED_COLUMNS).flatMap(([sheet, cols]) => cols.map((c) => `${sheet}::${c}`)),
    );
    const unwarned = CODE_COLUMNS.filter((c) => !warned.has(`${c.sheet}::${c.column}`)).map(
      (c) => `${c.key} ("${c.column}")`,
    );
    expect(
      unwarned.join("  |  "),
      "RCA: EXPECTED_COLUMNS (src/config.ts:36) does not include this column, so if it is renamed the app shows NO warning banner at startup - the field just silently empties. Add it to EXPECTED_COLUMNS.",
    ).toBe("");
  });

  it("GUARD-015 | concepts mapped to no column are still mapped to no column", () => {
    const blanks = Object.entries(INV_COLS).filter(([, column]) => column === "").map(([key]) => `INV_COLS.${key}`);
    expect(
      blanks.sort(),
      "RCA: the set of intentionally-unmapped fields changed. If a mapping was ADDED, the manifest entries DEP-COL-030/031/032 and the NodeSheet fields need reviewing together; if one was removed, a UI field has gone dead.",
    ).toEqual(["INV_COLS.catalog", "INV_COLS.qc", "INV_COLS.rin"]);
  });
});

describe("list options", () => {
  it("GUARD-020 | every Unit option in Scispot is understood as a real measure", () => {
    const COUNT_UNITS = ["Each"];
    const live = OPTIONS_LIVE[SHEETS.inventory]?.[INV_COLS.unit] ?? [];
    const unrecognised = live
      .filter((unit) => !COUNT_UNITS.includes(unit))
      .filter((unit) => lotQuantityFromFields({ quantity: "", totalQuantity: "", remaining: "1", consumed: "", unit }).left?.family === "count");
    expect(
      unrecognised.join("  |  "),
      "RCA: these Unit dropdown options are missing from UNIT_TABLE (src/lib/quantity.ts:18), so amount() falls back to family 'count'. sumAmounts groups by family+unit, so lots measured in them are NEVER added into the mass or volume total and never appear in the reconcile banner - the total shown is lower than reality, with no warning.",
    ).toBe("");
  });

  it("GUARD-021 | the Unit list is non-empty, so quantities can be interpreted at all", () => {
    expect(OPTIONS_LIVE[SHEETS.inventory]?.[INV_COLS.unit] ?? []).not.toHaveLength(0);
  });
});

describe("manifest integrity", () => {
  it("GUARD-030 | no duplicate dependency ids", () => {
    const ids = [...SHEET_DEPS, ...COLUMN_DEPS, ...CALL_DEPS, ...ACTION_DEPS].map((d) => d.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, "RCA: two manifest entries share an id, so a report row cannot be traced back to one dependency.").toEqual([]);
  });

  it("GUARD-031 | every user action points at dependencies that exist", () => {
    const known = new Set([...SHEET_DEPS, ...COLUMN_DEPS, ...CALL_DEPS].map((d) => d.id));
    const dangling = ACTION_DEPS.flatMap((a) => a.dependsOn.filter((id) => !known.has(id)).map((id) => `${a.id} -> ${id}`));
    expect(dangling, "RCA: a user action references a dependency id that no longer exists, so the impact of changing that dependency is understated.").toEqual([]);
  });

  it("GUARD-032 | every blocking dependency names where it is used in the code", () => {
    const vague = [...SHEET_DEPS, ...COLUMN_DEPS, ...CALL_DEPS]
      .filter((d) => d.severity === "blocking" && !/^src\/.+:\d+$/.test(d.codeRef))
      .map((d) => d.id);
    expect(vague, "RCA: a blocking dependency has no file:line reference, so whoever hits the failure cannot find the code that depends on it.").toEqual([]);
  });

  it("GUARD-033 | the snapshot records when and where it was captured", () => {
    expect(snapshot.capturedAt, "RCA: an undated snapshot cannot be trusted as the current Scispot schema.").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.environment).toBeTruthy();
  });
});
