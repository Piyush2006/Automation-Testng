export const APP_ID = "d3340961-d93b-47b8-83ec-3c73032c01e1";

export const SHEETS = {
  /** Catalog / chemical item hub — Open link for the item node. */
  items: "List of Inventory Items",
  /** Lot / bottle rows — Open link for the lot node. */
  inventory: "A. Materials Manager",
  /** Supplier / vendor registry — Open link for the vendor node. Never reuse inventory. */
  vendors: "SUP. Suppliers",
} as const;

export const ITEM_COLS = {
  id: "ID",
  name: "Item Name",
  synonyms: "Note",
} as const;

export const INV_COLS = {
  internalId: "ID",
  description: "Name",
  catalog: "",
  lot: "Lot Number",
  expiry: "Expiry Date",
  location: "Asset Location",
  locationFallback: "Location",
  manufacturer: "Supplier",
  rin: "",
  quantity: "Quantity",
  totalQuantity: "Total Quantity",
  unit: "Unit",
  remaining: "Quantity Left",
  used: "Quantity Consumed",
  qc: "",
} as const;

export const EXPECTED_COLUMNS: Record<string, string[]> = {
  [SHEETS.items]: [ITEM_COLS.id, ITEM_COLS.name, ITEM_COLS.synonyms],
  [SHEETS.inventory]: [
    INV_COLS.internalId,
    INV_COLS.description,
    INV_COLS.lot,
    INV_COLS.expiry,
    INV_COLS.location,
    INV_COLS.manufacturer,
    INV_COLS.quantity,
    INV_COLS.totalQuantity,
    INV_COLS.unit,
    INV_COLS.remaining,
    INV_COLS.used,
  ],
};

export const LOOKUP_PAGE_SIZE = 25;
export const SEARCH_DEBOUNCE_MS = 220;
