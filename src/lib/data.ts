import { EXPECTED_COLUMNS, INV_COLS, ITEM_COLS, LOOKUP_PAGE_SIZE, SHEETS } from "@/config";
import { lotQuantityFromFields, sumAmounts, type Amount, type LotQuantity } from "./quantity";
import { cell, collectPages, loadPage, type Row, type ScispotClient, type SearchFilter } from "./sdk";

export type ChemicalItem = {
  uuid: string;
  id: string;
  name: string;
  synonyms: string;
};

export type Lot = {
  uuid: string;
  internalId: string;
  description: string;
  catalog: string;
  lotNumber: string;
  expiry: string;
  location: string;
  manufacturer: string;
  rin: string;
  qc: string;
  quantityText: string;
  unitText: string;
  quantity: LotQuantity;
  /** True when Materials Manager.Name exactly matches the item name (no LOOKUP_REFERENCE on this tenant yet). */
  linked: boolean;
};

export type Chain = {
  item: ChemicalItem;
  lots: Lot[];
  totals: Amount[];
  unmeasured: Lot[];
};

function toItem(row: Row): ChemicalItem {
  return {
    uuid: row.__uuid,
    id: cell(row, ITEM_COLS.id),
    name: cell(row, ITEM_COLS.name),
    synonyms: filled(cell(row, ITEM_COLS.synonyms)),
  };
}

function toLot(row: Row, linked: boolean): Lot {
  const unitText = cell(row, INV_COLS.unit);
  const remaining = cell(row, INV_COLS.remaining);
  const totalQuantity = cell(row, INV_COLS.totalQuantity);
  const quantityText = cell(row, INV_COLS.quantity);
  const location = filled(cell(row, INV_COLS.location)) || filled(cell(row, INV_COLS.locationFallback));
  return {
    uuid: row.__uuid,
    internalId: cell(row, INV_COLS.internalId),
    description: cell(row, INV_COLS.description),
    catalog: "",
    lotNumber: cell(row, INV_COLS.lot),
    expiry: cell(row, INV_COLS.expiry),
    location,
    manufacturer: cell(row, INV_COLS.manufacturer),
    rin: "",
    qc: "",
    quantityText: remaining || totalQuantity || quantityText,
    unitText,
    quantity: lotQuantityFromFields({
      quantity: quantityText,
      totalQuantity,
      remaining,
      consumed: cell(row, INV_COLS.used),
      unit: unitText,
    }),
    linked,
  };
}

/** "NA" and similar fill-ins mean the field was not recorded. */
export function filled(value: string): string {
  const v = value.trim();
  return /^(n\/?a|none|-+|—)$/i.test(v) ? "" : v;
}

export type ItemPage = { items: ChemicalItem[]; hasMore: boolean };

export async function searchItems(sci: ScispotClient, term: string, page: number): Promise<ItemPage> {
  const q = term.trim();
  if (!q) {
    const result = await loadPage(sci, SHEETS.items, { page, pageSize: LOOKUP_PAGE_SIZE });
    return { items: result.rows.map(toItem).filter((i) => i.name), hasMore: result.hasMore };
  }
  const textFilters: SearchFilter[] = [
    { column: ITEM_COLS.name, operator: "Contains", value: q },
    { column: ITEM_COLS.synonyms, operator: "Contains", value: q },
  ];
  let result;
  try {
    result = await loadPage(sci, SHEETS.items, {
      page,
      pageSize: LOOKUP_PAGE_SIZE,
      match: "any",
      filters: [...textFilters, { column: ITEM_COLS.id, operator: "Contains", value: q }],
    });
  } catch {
    result = await loadPage(sci, SHEETS.items, { page, pageSize: LOOKUP_PAGE_SIZE, match: "any", filters: textFilters });
  }
  return { items: result.rows.map(toItem).filter((i) => i.name), hasMore: result.hasMore };
}

/** Deep link / Enter: an exact item ID or name, otherwise a single unambiguous match. */
export async function resolveItem(sci: ScispotClient, query: string): Promise<ChemicalItem | null> {
  const q = query.trim();
  if (!q) return null;
  if (/^it\d+$/i.test(q)) {
    const byId = await loadPage(sci, SHEETS.items, {
      page: 1,
      pageSize: 5,
      filters: [{ column: ITEM_COLS.id, operator: "Equals", value: q.toUpperCase() }],
    });
    const hit = byId.rows.map(toItem).find((i) => i.id.toLowerCase() === q.toLowerCase());
    if (hit) return hit;
  }
  const byName = await loadPage(sci, SHEETS.items, {
    page: 1,
    pageSize: 5,
    filters: [{ column: ITEM_COLS.name, operator: "Equals", value: q }],
  });
  const exact = byName.rows.map(toItem).find((i) => i.name.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  const loose = await searchItems(sci, q, 1);
  return loose.items.length === 1 ? loose.items[0]! : null;
}

export async function loadChain(sci: ScispotClient, item: ChemicalItem): Promise<Chain> {
  // No LOOKUP_REFERENCE on Materials Manager yet: exact Name match is the graph edge.
  const nameRows = await collectPages((page) =>
    loadPage(sci, SHEETS.inventory, {
      page,
      pageSize: LOOKUP_PAGE_SIZE,
      filters: [{ column: INV_COLS.description, operator: "Equals", value: item.name }],
    }),
  );

  const lots = new Map<string, Lot>();
  for (const row of nameRows) {
    const name = cell(row, INV_COLS.description);
    if (name.toLowerCase() !== item.name.toLowerCase()) continue;
    lots.set(row.__uuid, toLot(row, true));
  }

  const sorted = [...lots.values()].sort((a, b) =>
    a.internalId.localeCompare(b.internalId, undefined, { numeric: true }),
  );
  return {
    item,
    lots: sorted,
    totals: sumAmounts(sorted.map((l) => l.quantity.left)),
    unmeasured: sorted.filter((l) => !l.quantity.left),
  };
}

export async function checkSchema(sci: ScispotClient): Promise<string[]> {
  const missing: string[] = [];
  for (const [sheet, columns] of Object.entries(EXPECTED_COLUMNS)) {
    const { columns: defs = [] } = await sci.labsheets.schema(sheet);
    const names = new Set(defs.map((c) => c.name));
    for (const column of columns) {
      if (!names.has(column)) missing.push(`${sheet} → ${column}`);
    }
  }
  return missing;
}
