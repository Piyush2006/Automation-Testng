/**
 * Fixture labsheets for the browser suite.
 *
 * Column TYPES are read out of the captured Scispot schema, so the stand-in
 * enforces the same rules the real labsheets do (notably: `ID` is ID_BARCODE,
 * which refuses a `Contains` filter).
 */
import { readFileSync } from "node:fs";
import { INV_COLS, ITEM_COLS, SHEETS } from "../../src/config";

export type Column = { name: string; type: string };
export type Sheet = { columns: Column[]; rows: Record<string, string>[]; nameAs?: string };
export type Fixture = {
  sheets: Record<string, Sheet>;
  /** Reject connect() with this message, as a dead SDK or bad token does. */
  failConnect?: string;
  /** Make rows()/search() on this labsheet throw. */
  failSheet?: string;
  failMessage?: string;
  /** Drop openLabsheet, as happens outside the Jazz iframe. */
  omitOpenLabsheet?: boolean;
  /** Stand in for someone renaming a column in Scispot. */
  renameColumn?: { sheet: string; from: string; to: string };
};

const snapshot = JSON.parse(readFileSync("tests/deps/scispot-snapshot.json", "utf8")) as {
  sheets: Record<string, Column[]>;
};
const SHEET_SCHEMAS = snapshot.sheets;

function cols(sheet: string, names: string[]): Column[] {
  const live = SHEET_SCHEMAS[sheet] ?? [];
  return names.map((name) => {
    const hit = live.find((c) => c.name === name);
    if (!hit) throw new Error(`Fixture asks for "${sheet}" → "${name}", absent from the snapshot.`);
    return { name, type: hit.type };
  });
}

const ITEM_COLUMNS = cols(SHEETS.items, [ITEM_COLS.id, ITEM_COLS.name, ITEM_COLS.synonyms]);

const INV_COLUMNS = cols(SHEETS.inventory, [
  INV_COLS.internalId,
  INV_COLS.description,
  INV_COLS.lot,
  INV_COLS.expiry,
  INV_COLS.location,
  INV_COLS.locationFallback,
  INV_COLS.manufacturer,
  INV_COLS.quantity,
  INV_COLS.totalQuantity,
  INV_COLS.unit,
  INV_COLS.remaining,
  INV_COLS.used,
]);

const VENDOR_COLUMNS = cols(SHEETS.vendors, ["ID", "Supplier Name"]);

export const CHEMICALS = {
  mercaptoethanol: "2-Mercaptoethanol",
  salt: "Sodium Chloride",
  acetonitrile: "Acetonitrile",
  phosphate: "Potassium Phosphate",
  tris: "Tris Base",
  ethanol: "Ethanol",
} as const;

function item(id: string, name: string, note = ""): Record<string, string> {
  return { __uuid: `item-${id}`, [ITEM_COLS.id]: id, [ITEM_COLS.name]: name, [ITEM_COLS.synonyms]: note };
}

type LotSpec = {
  id: string;
  of: string;
  lot?: string;
  expiry?: string;
  assetLocation?: string;
  location?: string;
  supplier?: string;
  quantity?: string;
  total?: string;
  unit?: string;
  left?: string;
  used?: string;
};

function lot(spec: LotSpec): Record<string, string> {
  return {
    __uuid: `lot-${spec.id}`,
    [INV_COLS.internalId]: spec.id,
    [INV_COLS.description]: spec.of,
    [INV_COLS.lot]: spec.lot ?? "",
    [INV_COLS.expiry]: spec.expiry ?? "",
    [INV_COLS.location]: spec.assetLocation ?? "",
    [INV_COLS.locationFallback]: spec.location ?? "",
    [INV_COLS.manufacturer]: spec.supplier ?? "",
    [INV_COLS.quantity]: spec.quantity ?? "",
    [INV_COLS.totalQuantity]: spec.total ?? "",
    [INV_COLS.unit]: spec.unit ?? "",
    [INV_COLS.remaining]: spec.left ?? "",
    [INV_COLS.used]: spec.used ?? "",
  };
}

/** 28 filler rows so the catalogue exceeds LOOKUP_PAGE_SIZE (25). */
const FILLER = Array.from({ length: 28 }, (_, i) =>
  item(`IT1${String(i + 1).padStart(3, "0")}`, `Reagent Blank ${String(i + 1).padStart(2, "0")}`, "filler"),
);

export const ITEM_ROWS: Record<string, string>[] = [
  item("IT0001", CHEMICALS.mercaptoethanol, "BME, beta-mercaptoethanol"),
  item("IT0002", CHEMICALS.salt, "NaCl, table salt"),
  item("IT0003", CHEMICALS.acetonitrile, "ACN"),
  item("IT0004", CHEMICALS.phosphate, ""),
  item("IT0005", CHEMICALS.tris, "THAM"),
  item("IT0007", CHEMICALS.ethanol, "EtOH"),
  item("IT0006", "", "a row with no Item Name, which the dropdown must hide"),
  ...FILLER,
];

export const LOT_ROWS: Record<string, string>[] = [
  // The ticket's worked example: 10 mL + 50 mL = 60 mL.
  lot({
    id: "MAT1", of: CHEMICALS.mercaptoethanol, lot: "M22-114", expiry: "2027-03-31",
    assetLocation: "Cold Room A / Shelf 2", supplier: "Sigma-Aldrich",
    quantity: "1", total: "100", unit: "mL", left: "10", used: "90",
  }),
  lot({
    id: "MAT2", of: CHEMICALS.mercaptoethanol, lot: "M23-008", expiry: "2028-01-15",
    location: "Bench 4", supplier: "Thermo Fisher",
    quantity: "1", total: "50", unit: "mL", left: "50", used: "0",
  }),

  // Three lots: tree layout, plus one row with no Unit -> "Not counted".
  lot({ id: "MAT10", of: CHEMICALS.salt, lot: "S24-001", supplier: "Sigma-Aldrich", total: "500", unit: "g", left: "250", used: "250" }),
  lot({ id: "MAT11", of: CHEMICALS.salt, lot: "S24-002", supplier: "VWR", total: "500", unit: "g", left: "500" }),
  lot({ id: "MAT12", of: CHEMICALS.salt, lot: "S24-003", supplier: "VWR", left: "", unit: "" }),

  // Four lots: forces the list layout instead of the tree.
  lot({ id: "MAT20", of: CHEMICALS.acetonitrile, lot: "A-01", supplier: "Honeywell", unit: "L", left: "1" }),
  lot({ id: "MAT21", of: CHEMICALS.acetonitrile, lot: "A-02", supplier: "Honeywell", unit: "L", left: "2" }),
  lot({ id: "MAT22", of: CHEMICALS.acetonitrile, lot: "A-03", supplier: "Merck", unit: "L", left: "1" }),
  lot({ id: "MAT23", of: CHEMICALS.acetonitrile, lot: "A-04", supplier: "Merck", unit: "L", left: "4" }),

  // One mL lot and one ng lot. `ng` is a real Scispot Unit option that
  // UNIT_TABLE does not know, so the ng lot vanishes from the total.
  lot({ id: "MAT30", of: CHEMICALS.tris, lot: "T-100", supplier: "Bio-Rad", unit: "mL", left: "10" }),
  lot({ id: "MAT31", of: CHEMICALS.tris, lot: "T-101", supplier: "Bio-Rad", unit: "ng", left: "500" }),

  // Two lots whose Name differs only in capitalisation. Both must attach:
  // the join is re-checked case-insensitively after Scispot answers.
  lot({ id: "MAT50", of: CHEMICALS.ethanol, lot: "E-01", supplier: "Merck", unit: "L", left: "1" }),
  lot({ id: "MAT51", of: CHEMICALS.ethanol.toUpperCase(), lot: "E-02", supplier: "Merck", unit: "L", left: "2" }),

  // Potassium Phosphate deliberately has no lots at all.
  // A near-miss row that the client-side guard must reject.
  lot({ id: "MAT40", of: `${CHEMICALS.phosphate} dibasic`, lot: "P-01", supplier: "Sigma-Aldrich", unit: "g", left: "100" }),
];

export function fixture(over: Partial<Fixture> = {}): Fixture {
  const built: Fixture = {
    sheets: {
      [SHEETS.items]: { columns: ITEM_COLUMNS, rows: ITEM_ROWS },
      [SHEETS.inventory]: { columns: INV_COLUMNS, rows: LOT_ROWS },
      [SHEETS.vendors]: { columns: VENDOR_COLUMNS, rows: [{ ID: "SUP1", "Supplier Name": "Sigma-Aldrich" }] },
    },
    ...over,
  };

  const rename = over.renameColumn;
  if (rename) {
    const sheet = built.sheets[rename.sheet];
    if (!sheet) throw new Error(`renameColumn names an unknown labsheet: ${rename.sheet}`);
    built.sheets[rename.sheet] = {
      ...sheet,
      columns: sheet.columns.map((c) => (c.name === rename.from ? { ...c, name: rename.to } : c)),
      rows: sheet.rows.map((r) => {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) next[k === rename.from ? rename.to : k] = v;
        return next;
      }),
    };
  }
  return built;
}
