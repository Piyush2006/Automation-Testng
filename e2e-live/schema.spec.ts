/**
 * Lines 3.9, 4.2, 4.4, 4.5, 5.1 and 5.2 of the agreed 42 — checked against the
 * schema of the REAL tenant, captured today, not against the stored snapshot.
 *
 * Read-only: this compares names and types. It changes nothing.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SHEETS, ITEM_COLS, INV_COLS, EXPECTED_COLUMNS } from "../src/config";

type Col = { name: string; type: string; references?: string[] };
const live = JSON.parse(readFileSync("e2e-live/live-schema.json", "utf8")) as {
  capturedAt: string;
  sheets: Record<string, { columns: Col[] }>;
};

const names = (sheet: string) => (live.sheets[sheet]?.columns ?? []).map((c) => c.name);
const col = (sheet: string, name: string) => (live.sheets[sheet]?.columns ?? []).find((c) => c.name === name);

/** Every column the app actually reads, sheet by sheet. */
const READS: Array<[sheet: string, column: string]> = [
  [SHEETS.items, ITEM_COLS.id], [SHEETS.items, ITEM_COLS.name], [SHEETS.items, ITEM_COLS.synonyms],
  [SHEETS.inventory, INV_COLS.internalId], [SHEETS.inventory, INV_COLS.description],
  [SHEETS.inventory, INV_COLS.lot], [SHEETS.inventory, INV_COLS.expiry],
  [SHEETS.inventory, INV_COLS.location], [SHEETS.inventory, INV_COLS.locationFallback],
  [SHEETS.inventory, INV_COLS.manufacturer], [SHEETS.inventory, INV_COLS.quantity],
  [SHEETS.inventory, INV_COLS.totalQuantity], [SHEETS.inventory, INV_COLS.unit],
  [SHEETS.inventory, INV_COLS.remaining], [SHEETS.inventory, INV_COLS.used],
];

/** What the app can actually interpret as a measure. Mirrors UNIT_TABLE. */
const UNDERSTOOD = ["ml", "l", "ul", "µl", "μl", "g", "gm", "mg", "kg", "each"];

test("L5.1 | Given the code names three labsheets and their columns, When checked against Scispot, Then all of them still exist", () => {
  for (const sheet of [SHEETS.items, SHEETS.inventory, SHEETS.vendors]) {
    expect(live.sheets[sheet], `labsheet "${sheet}" is missing from the live tenant`).toBeTruthy();
  }
  const missing = READS.filter(([s, c]) => c && !names(s).includes(c)).map(([s, c]) => `${s} → ${c}`);
  expect(missing.join("  |  "), "columns the app reads that no longer exist live").toBe("");
});

test("L4.5 | Given labsheet names are matched letter for letter, When compared with Scispot, Then the spellings agree exactly", () => {
  // The lookup uses strict equality, so a case or whitespace difference breaks it.
  for (const sheet of [SHEETS.items, SHEETS.inventory, SHEETS.vendors]) {
    const exact = Object.keys(live.sheets).find((n) => n === sheet);
    const loose = Object.keys(live.sheets).find((n) => n.trim().toLowerCase() === sheet.trim().toLowerCase());
    expect(loose, `no labsheet resembling "${sheet}"`).toBeTruthy();
    expect(exact, `"${sheet}" exists only under a different spelling: "${loose}" — strict equality would fail`).toBe(sheet);
  }
});

test("L5.2 | Given the inventory sheet has a Unit column, When its options are read, Then the list is a non-empty dropdown", () => {
  const unit = col(SHEETS.inventory, INV_COLS.unit);
  expect(unit?.type).toBe("LIST");
  expect(unit?.references?.length ?? 0).toBeGreaterThan(0);
});

test("L3.9 | Given Scispot offers eight Unit options, When each is looked up, Then the app understands every one", () => {
  const unit = col(SHEETS.inventory, INV_COLS.unit);
  const unknown = (unit?.references ?? []).filter((u) => !UNDERSTOOD.includes(u.toLowerCase()));
  expect(
    unknown.join(", "),
    "Unit options the app cannot read. A lot measured in one of these is dropped from its total.",
  ).toBe("");
});

test("L4.4 | Given the app reads fifteen columns, When the startup check runs, Then it covers all fifteen", () => {
  const uncovered = READS.filter(([s, c]) => c && !(EXPECTED_COLUMNS[s] ?? []).includes(c))
    .map(([s, c]) => `${s} → ${c}`);
  expect(uncovered.join("  |  "), "read by the app but absent from the load-time check").toBe("");
});

test("L4.2 | Given catalog, rin and qc map to no column, When the config is read, Then they are still unmapped", () => {
  expect([INV_COLS.catalog, INV_COLS.rin, INV_COLS.qc]).toEqual(["", "", ""]);
});
