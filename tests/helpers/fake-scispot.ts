import type { Row, ScispotClient, SearchFilter } from "@/lib/sdk";

export type RowPage = { headers?: string[]; rows?: unknown[][]; total?: number; data?: unknown };

export type SearchCall = { sheet: string; filters: SearchFilter[]; match: string; page: number; pageSize: number };
export type RowsCall = { sheet: string; page: number; pageSize: number };

export type FakeHandlers = {
  list?: (opts?: { search?: string; page?: number; pageSize?: number }) => unknown;
  schema?: (name: string) => unknown;
  rows?: (name: string, opts: { page: number; pageSize: number }) => unknown;
  search?: (name: string, opts: { filters: SearchFilter[]; match: "all" | "any"; page: number; pageSize: number }) => unknown;
  openLabsheet?: (uuid: string, opts?: { newTab?: boolean }) => void;
  /** Omit openLabsheet entirely, as happens outside the Jazz iframe. */
  withoutOpenLabsheet?: boolean;
};

export type Fake = {
  client: ScispotClient;
  calls: {
    list: Array<{ search?: string; page?: number; pageSize?: number } | undefined>;
    schema: string[];
    rows: RowsCall[];
    search: SearchCall[];
    openLabsheet: Array<{ uuid: string; newTab?: boolean }>;
  };
};

/** Build a page in the shape the Jazz BFF returns: headers[0] is the row uuid. */
export function page(headers: string[], rows: unknown[][], total?: number): RowPage {
  const out: RowPage = { headers: ["uuid", ...headers], rows };
  if (total !== undefined) out.total = total;
  return out;
}

/** Wrap a page the way some Jazz responses nest it under `data`. */
export function nested(p: RowPage): RowPage {
  return { data: p };
}

export function makeFake(handlers: FakeHandlers = {}): Fake {
  const calls: Fake["calls"] = { list: [], schema: [], rows: [], search: [], openLabsheet: [] };

  const client: ScispotClient = {
    labsheets: {
      list: async (opts) => {
        calls.list.push(opts);
        const result = handlers.list ? handlers.list(opts) : { labsheets: [] };
        return result as { labsheets?: Array<{ uuid: string; name: string }> };
      },
      schema: async (name) => {
        calls.schema.push(name);
        const result = handlers.schema ? handlers.schema(name) : { columns: [] };
        return result as { columns?: Array<{ name: string; type: string }> };
      },
      rows: async (name, opts) => {
        calls.rows.push({ sheet: name, ...opts });
        return (handlers.rows ? handlers.rows(name, opts) : {}) as never;
      },
      search: async (name, opts) => {
        calls.search.push({ sheet: name, ...opts });
        return (handlers.search ? handlers.search(name, opts) : {}) as never;
      },
    },
  };

  if (!handlers.withoutOpenLabsheet) {
    client.openLabsheet = (uuid, opts) => {
      calls.openLabsheet.push({ uuid, newTab: opts?.newTab });
      handlers.openLabsheet?.(uuid, opts);
    };
  }

  return { client, calls };
}

/** Item rows for `List of Inventory Items`. */
export function itemPage(items: Array<[uuid: string, id: string, name: string, note: string]>, total?: number) {
  return page(["ID", "Item Name", "Note"], items, total);
}

/** Lot rows for `A. Materials Manager`, with only the columns the app reads. */
export function lotPage(
  lots: Array<{
    uuid: string;
    id: string;
    name: string;
    lot?: string;
    expiry?: string;
    assetLocation?: string;
    location?: string;
    supplier?: string;
    quantity?: string;
    totalQuantity?: string;
    unit?: string;
    left?: string;
    consumed?: string;
  }>,
  total?: number,
) {
  return page(
    [
      "ID",
      "Name",
      "Lot Number",
      "Expiry Date",
      "Asset Location",
      "Location",
      "Supplier",
      "Quantity",
      "Total Quantity",
      "Unit",
      "Quantity Left",
      "Quantity Consumed",
    ],
    lots.map((l) => [
      l.uuid,
      l.id,
      l.name,
      l.lot ?? "",
      l.expiry ?? "",
      l.assetLocation ?? "",
      l.location ?? "",
      l.supplier ?? "",
      l.quantity ?? "",
      l.totalQuantity ?? "",
      l.unit ?? "",
      l.left ?? "",
      l.consumed ?? "",
    ]),
    total,
  );
}

export function rowOf(values: Record<string, unknown>): Row {
  return { __uuid: "u1", ...values } as Row;
}
