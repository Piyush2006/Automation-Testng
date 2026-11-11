import { APP_ID } from "@/config";

export type Row = { __uuid: string; [column: string]: unknown };

export type SearchFilter = { column: string; operator: string; value: string };

type RowPage = { headers?: string[]; rows?: unknown[][]; total?: number; data?: unknown };

export type ScispotClient = {
  labsheets: {
    list: (opts?: { search?: string; page?: number; pageSize?: number }) => Promise<{
      labsheets?: Array<{ uuid: string; name: string }>;
    }>;
    schema: (name: string) => Promise<{ columns?: Array<{ name: string; type: string }> }>;
    rows: (name: string, opts: { page: number; pageSize: number }) => Promise<RowPage>;
    search: (
      name: string,
      opts: { filters: SearchFilter[]; match: "all" | "any"; page: number; pageSize: number },
    ) => Promise<RowPage>;
  };
  openLabsheet?: (uuid: string, opts?: { newTab?: boolean }) => void;
};

type ScispotGlobal = {
  connect: (opts?: {
    appId?: string;
    token?: string;
    appOrigin?: string;
    debug?: boolean;
    scrubToken?: boolean;
  }) => Promise<ScispotClient>;
};

declare global {
  interface Window {
    Scispot?: ScispotGlobal;
  }
}

/** Query param from `location.search`, or after `#/…?` when the hash carries it. */
export function queryParam(name: string): string {
  const fromSearch = new URLSearchParams(window.location.search).get(name)?.trim();
  if (fromSearch) return fromSearch;
  const hash = window.location.hash;
  const at = hash.indexOf("?");
  if (at < 0) return "";
  return new URLSearchParams(hash.slice(at + 1)).get(name)?.trim() ?? "";
}

export type BootParams = { token: string; appOrigin: string; debug: boolean; q: string };

const LOCAL_APP_ORIGIN = "https://labsheets.scispot.io";

function isLocalHost(): boolean {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

/** Read every param before connect(): it strips `?token` from the URL. */
export function readBootParams(): BootParams {
  return {
    token:
      queryParam("token") ||
      queryParam("sas_token") ||
      (import.meta.env.DEV ? (import.meta.env.VITE_JAZZ_TOKEN ?? "").trim() : ""),
    appOrigin: queryParam("appOrigin") || (isLocalHost() ? LOCAL_APP_ORIGIN : ""),
    debug: queryParam("jazzDebug") === "1" || queryParam("jazzDebug") === "true",
    q: queryParam("q"),
  };
}

export async function connectScispot(boot: BootParams): Promise<ScispotClient> {
  const sdk = window.Scispot;
  if (!sdk?.connect) {
    throw new Error("The Scispot Jazz SDK did not load. Open this app from Jazz in Scispot.");
  }
  return sdk.connect({
    appId: APP_ID,
    ...(boot.token ? { token: boot.token } : {}),
    ...(boot.appOrigin ? { appOrigin: boot.appOrigin } : {}),
    ...(boot.debug ? { debug: true } : {}),
    ...(import.meta.env.DEV ? { scrubToken: false } : {}),
  });
}

function asPage(raw: unknown): RowPage {
  if (!raw || typeof raw !== "object") return {};
  const page = raw as RowPage;
  if (Array.isArray(page.headers) && Array.isArray(page.rows)) return page;
  const nested = page.data as RowPage | undefined;
  if (nested && Array.isArray(nested.headers) && Array.isArray(nested.rows)) return nested;
  return page;
}

export function rowsToObjects(raw: unknown): Row[] {
  const page = asPage(raw);
  if (!Array.isArray(page.headers) || !Array.isArray(page.rows)) return [];
  const headers = page.headers.map(String);
  return page.rows
    .filter((cells): cells is unknown[] => Array.isArray(cells))
    .map((cells) => {
      const row: Row = { __uuid: "" };
      headers.forEach((header, i) => {
        row[header === "uuid" ? "__uuid" : header] = cells[i];
      });
      return row;
    })
    .filter((row) => row.__uuid);
}

function display(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["label", "name", "value", "display"]) {
      const inner = display(o[key]);
      if (inner) return inner;
    }
  }
  return "";
}

export function cell(row: Row, column: string): string {
  return display(row[column]);
}

export type PageResult = { rows: Row[]; hasMore: boolean; total?: number };

export async function loadPage(
  sci: ScispotClient,
  sheet: string,
  opts: { page: number; pageSize: number; filters?: SearchFilter[]; match?: "all" | "any" },
): Promise<PageResult> {
  const raw = opts.filters?.length
    ? await sci.labsheets.search(sheet, {
        filters: opts.filters,
        match: opts.match ?? "all",
        page: opts.page,
        pageSize: opts.pageSize,
      })
    : await sci.labsheets.rows(sheet, { page: opts.page, pageSize: opts.pageSize });
  const rows = rowsToObjects(raw);
  const total = asPage(raw).total;
  const trustworthy = typeof total === "number" && total >= rows.length;
  const hasMore = trustworthy
    ? (opts.page - 1) * opts.pageSize + rows.length < (total as number)
    : rows.length === opts.pageSize;
  return trustworthy ? { rows, hasMore, total } : { rows, hasMore };
}

/** Walk search pages until exhausted. Jazz may cap a page below the requested size. */
export async function collectPages(
  load: (page: number) => Promise<PageResult>,
  maxPages = 40,
): Promise<Row[]> {
  const seen = new Map<string, Row>();
  for (let page = 1; page <= maxPages; page++) {
    const result = await load(page);
    const before = seen.size;
    for (const row of result.rows) seen.set(row.__uuid, row);
    if (!result.hasMore || seen.size === before) break;
  }
  return [...seen.values()];
}

const sheetUuids = new Map<string, string>();

export async function labsheetUuid(sci: ScispotClient, name: string): Promise<string | undefined> {
  const cached = sheetUuids.get(name);
  if (cached) return cached;
  const { labsheets = [] } = await sci.labsheets.list({ search: name, pageSize: 25 });
  const hit = labsheets.find((ls) => ls.name === name);
  if (hit) sheetUuids.set(name, hit.uuid);
  return hit?.uuid;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong talking to Scispot.";
}
