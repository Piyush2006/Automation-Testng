/**
 * DEPENDENCY MANIFEST — Chemical Chain of Custody (app d3340961-d93b-47b8-83ec-3c73032c01e1)
 *
 * The single source of truth for everything this app needs from Scispot.
 * Consult this BEFORE changing a labsheet: `npm run test:deps` fails if the
 * app's code, this manifest, and the captured Scispot schema disagree.
 *
 * severity:
 *   blocking — the app shows wrong data or an empty graph if this breaks
 *   degraded — a field or convenience stops working; the app still functions
 *   unused   — declared in config but mapped to nothing; nothing to break yet
 */

export type Severity = "blocking" | "degraded" | "unused";

export type SheetDep = {
  id: string;
  sheet: string;
  role: string;
  /** How the app touches it: reads rows, or only deep-links to it. */
  access: "read" | "open-only";
  severity: Severity;
  codeRef: string;
};

export type ColumnDep = {
  id: string;
  sheet: string;
  /** "" means config maps this concept to no column at all. */
  column: string;
  expectedType: string;
  usedFor: string;
  severity: Severity;
  codeRef: string;
};

export type CallDep = {
  id: string;
  call: string;
  triggeredBy: string;
  severity: Severity;
  codeRef: string;
};

export type ActionDep = {
  id: string;
  action: string;
  dependsOn: string[];
  severity: Severity;
};

export const SHEET_DEPS: SheetDep[] = [
  {
    id: "DEP-SHEET-001",
    sheet: "List of Inventory Items",
    role: "Chemical catalogue. Drives the search box and the top node of the graph.",
    access: "read",
    severity: "blocking",
    codeRef: "src/config.ts:5",
  },
  {
    id: "DEP-SHEET-002",
    sheet: "A. Materials Manager",
    role: "Lot / bottle rows. Every lot and vendor node, and all quantity maths.",
    access: "read",
    severity: "blocking",
    codeRef: "src/config.ts:7",
  },
  {
    id: "DEP-SHEET-003",
    sheet: "SUP. Suppliers",
    role: "Supplier registry. ONLY deep-linked from the vendor node; never read.",
    access: "open-only",
    severity: "degraded",
    codeRef: "src/config.ts:9",
  },
];

export const COLUMN_DEPS: ColumnDep[] = [
  // --- List of Inventory Items -------------------------------------------
  {
    id: "DEP-COL-001",
    sheet: "List of Inventory Items",
    column: "ID",
    expectedType: "ID_BARCODE",
    usedFor: "Item ID shown in the dropdown and detail panel; deep-link target (?q=IT001).",
    severity: "degraded",
    codeRef: "src/config.ts:13",
  },
  {
    id: "DEP-COL-002",
    sheet: "List of Inventory Items",
    column: "Item Name",
    expectedType: "TEXT",
    usedFor: "Search term AND the join key to A. Materials Manager. Renaming the column OR editing a value breaks the graph.",
    severity: "blocking",
    codeRef: "src/config.ts:14",
  },
  {
    id: "DEP-COL-003",
    sheet: "List of Inventory Items",
    column: "Note",
    expectedType: "TEXT",
    usedFor: "Searchable synonyms; shown under the name in the dropdown.",
    severity: "degraded",
    codeRef: "src/config.ts:15",
  },

  // --- A. Materials Manager ----------------------------------------------
  {
    id: "DEP-COL-010",
    sheet: "A. Materials Manager",
    column: "ID",
    expectedType: "TEXT",
    usedFor: "Inventory row id; lot node title when Lot Number is blank; sort key.",
    severity: "blocking",
    codeRef: "src/config.ts:19",
  },
  {
    id: "DEP-COL-011",
    sheet: "A. Materials Manager",
    column: "Name",
    expectedType: "TEXT",
    usedFor: "THE JOIN KEY. Matched by exact text against Item Name. Highest-risk dependency in the app.",
    severity: "blocking",
    codeRef: "src/config.ts:20",
  },
  {
    id: "DEP-COL-012",
    sheet: "A. Materials Manager",
    column: "Lot Number",
    expectedType: "TEXT",
    usedFor: "Lot node title.",
    severity: "degraded",
    codeRef: "src/config.ts:22",
  },
  {
    id: "DEP-COL-013",
    sheet: "A. Materials Manager",
    column: "Expiry Date",
    expectedType: "DATE",
    usedFor: "Expiration date in the lot detail panel.",
    severity: "degraded",
    codeRef: "src/config.ts:23",
  },
  {
    id: "DEP-COL-014",
    sheet: "A. Materials Manager",
    column: "Asset Location",
    expectedType: "TEXT",
    usedFor: "Location in the lot detail panel (primary).",
    severity: "degraded",
    codeRef: "src/config.ts:24",
  },
  {
    id: "DEP-COL-015",
    sheet: "A. Materials Manager",
    column: "Location",
    expectedType: "LOCATION",
    usedFor: "Location fallback when Asset Location is blank. Reads back as a breadcrumb.",
    severity: "degraded",
    codeRef: "src/config.ts:25",
  },
  {
    id: "DEP-COL-016",
    sheet: "A. Materials Manager",
    column: "Supplier",
    expectedType: "TEXT",
    usedFor: "Vendor node title. The ONLY source of vendor data — SUP. Suppliers is never read.",
    severity: "blocking",
    codeRef: "src/config.ts:26",
  },
  {
    id: "DEP-COL-017",
    sheet: "A. Materials Manager",
    column: "Quantity",
    expectedType: "QUANTITY",
    usedFor: "Container size; third fallback for amount left.",
    severity: "blocking",
    codeRef: "src/config.ts:28",
  },
  {
    id: "DEP-COL-018",
    sheet: "A. Materials Manager",
    column: "Total Quantity",
    expectedType: "NUMBER",
    usedFor: "Second fallback for amount left.",
    severity: "blocking",
    codeRef: "src/config.ts:29",
  },
  {
    id: "DEP-COL-019",
    sheet: "A. Materials Manager",
    column: "Unit",
    expectedType: "LIST",
    usedFor: "Unit for every amount. A value outside the known table degrades to a bare count.",
    severity: "blocking",
    codeRef: "src/config.ts:30",
  },
  {
    id: "DEP-COL-020",
    sheet: "A. Materials Manager",
    column: "Quantity Left",
    expectedType: "QUANTITY_LEFT",
    usedFor: "PRIMARY source of amount left. Feeds every lot total and the reconcile banner.",
    severity: "blocking",
    codeRef: "src/config.ts:31",
  },
  {
    id: "DEP-COL-021",
    sheet: "A. Materials Manager",
    column: "Quantity Consumed",
    expectedType: "QUANTITY_CONSUMED",
    usedFor: "Quantity consumed in the lot detail panel.",
    severity: "degraded",
    codeRef: "src/config.ts:32",
  },

  // --- Declared but mapped to nothing ------------------------------------
  {
    id: "DEP-COL-030",
    sheet: "A. Materials Manager",
    column: "",
    expectedType: "",
    usedFor: "INV_COLS.catalog — 'Catalog number' in the UI. Mapped to no column, so the field never renders and a vendor node can never be titled 'Catalog …'.",
    severity: "unused",
    codeRef: "src/config.ts:21",
  },
  {
    id: "DEP-COL-031",
    sheet: "A. Materials Manager",
    column: "",
    expectedType: "",
    usedFor: "INV_COLS.rin — 'RIN number' in the UI. Mapped to no column; field never renders.",
    severity: "unused",
    codeRef: "src/config.ts:27",
  },
  {
    id: "DEP-COL-032",
    sheet: "A. Materials Manager",
    column: "",
    expectedType: "",
    usedFor: "INV_COLS.qc — drives the QC badge in the detail panel. Mapped to no column; badge never renders.",
    severity: "unused",
    codeRef: "src/config.ts:33",
  },
];

export const CALL_DEPS: CallDep[] = [
  {
    id: "DEP-CALL-001",
    call: "Scispot.connect({ appId, token?, appOrigin?, debug?, scrubToken? })",
    triggeredBy: "App mount. Everything is blocked until it resolves.",
    severity: "blocking",
    codeRef: "src/lib/sdk.ts:76",
  },
  {
    id: "DEP-CALL-002",
    call: "labsheets.schema(name)",
    triggeredBy: "App mount — the load-time column check. Covers 2 of 3 sheets.",
    severity: "degraded",
    codeRef: "src/lib/data.ts:163",
  },
  {
    id: "DEP-CALL-003",
    call: "labsheets.list({ search, pageSize })",
    triggeredBy: "App mount (uuid prefetch for all 3 sheets) and the 'Open …' button.",
    severity: "degraded",
    codeRef: "src/lib/sdk.ts:173",
  },
  {
    id: "DEP-CALL-004",
    call: "labsheets.rows(name, { page, pageSize })",
    triggeredBy: "Opening the search dropdown with no term typed.",
    severity: "blocking",
    codeRef: "src/lib/sdk.ts:143",
  },
  {
    id: "DEP-CALL-005",
    call: "labsheets.search(name, { filters, match, page, pageSize })",
    triggeredBy: "Typing in the search box, deep-link resolve, and loading a chain.",
    severity: "blocking",
    codeRef: "src/lib/sdk.ts:137",
  },
  {
    id: "DEP-CALL-006",
    call: "openLabsheet(uuid, { newTab: true })",
    triggeredBy: "The 'Open …' button in the detail panel.",
    severity: "degraded",
    codeRef: "src/App.tsx:102",
  },
];

export const ACTION_DEPS: ActionDep[] = [
  { id: "DEP-ACT-001", action: "Open the search dropdown (no term)", dependsOn: ["DEP-CALL-004", "DEP-COL-002"], severity: "blocking" },
  { id: "DEP-ACT-002", action: "Type a chemical name or note", dependsOn: ["DEP-CALL-005", "DEP-COL-002", "DEP-COL-003"], severity: "blocking" },
  { id: "DEP-ACT-003", action: "Search by item ID", dependsOn: ["DEP-CALL-005", "DEP-COL-001"], severity: "degraded" },
  { id: "DEP-ACT-004", action: "Scroll the dropdown for more results", dependsOn: ["DEP-CALL-004", "DEP-CALL-005"], severity: "degraded" },
  { id: "DEP-ACT-005", action: "Select a chemical and draw the graph", dependsOn: ["DEP-CALL-005", "DEP-COL-002", "DEP-COL-011"], severity: "blocking" },
  { id: "DEP-ACT-006", action: "Read the total quantity left", dependsOn: ["DEP-COL-017", "DEP-COL-018", "DEP-COL-019", "DEP-COL-020"], severity: "blocking" },
  { id: "DEP-ACT-007", action: "Open a lot detail panel", dependsOn: ["DEP-COL-010", "DEP-COL-012", "DEP-COL-013", "DEP-COL-014", "DEP-COL-021"], severity: "degraded" },
  { id: "DEP-ACT-008", action: "Open a vendor detail panel", dependsOn: ["DEP-COL-016"], severity: "degraded" },
  { id: "DEP-ACT-009", action: "Deep-link into Scispot via 'Open …'", dependsOn: ["DEP-CALL-003", "DEP-CALL-006", "DEP-SHEET-003"], severity: "degraded" },
  { id: "DEP-ACT-010", action: "Load the app from a ?q= deep link", dependsOn: ["DEP-CALL-005", "DEP-COL-001", "DEP-COL-002"], severity: "degraded" },
];
