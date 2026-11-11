/** The load-time column check, labsheet lookup, and connection. */
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_COLUMNS, SHEETS } from "@/config";
import { checkSchema } from "@/lib/data";
import { connectScispot, labsheetUuid, queryParam, readBootParams } from "@/lib/sdk";
import { makeFake } from "../helpers/fake-scispot";
import snapshot from "../deps/scispot-snapshot.json";

const liveColumns = (sheet: string) => ({
  columns: (snapshot.sheets as Record<string, Array<{ name: string; type: string }>>)[sheet] ?? [],
});

describe("checkSchema() — the load-time drift warning", () => {
  it("SCHEMA-001 | reports nothing when every expected column is present", async () => {
    const fake = makeFake({ schema: liveColumns });
    expect(await checkSchema(fake.client)).toEqual([]);
  });

  it("SCHEMA-002 | names the sheet and column when one has been renamed", async () => {
    const fake = makeFake({
      schema: (sheet) =>
        sheet === SHEETS.inventory
          ? { columns: liveColumns(sheet).columns.filter((c) => c.name !== "Quantity Left") }
          : liveColumns(sheet),
    });
    expect(await checkSchema(fake.client)).toEqual([`${SHEETS.inventory} → Quantity Left`]);
  });

  it("SCHEMA-003 | reports every missing column, not just the first", async () => {
    const fake = makeFake({
      schema: (sheet) =>
        sheet === SHEETS.inventory
          ? { columns: liveColumns(sheet).columns.filter((c) => !["Unit", "Supplier"].includes(c.name)) }
          : liveColumns(sheet),
    });
    const missing = await checkSchema(fake.client);
    expect(missing).toHaveLength(2);
    expect(missing.join(" ")).toContain("Unit");
    expect(missing.join(" ")).toContain("Supplier");
  });

  it("SCHEMA-004 | an empty schema response reports every expected column as missing", async () => {
    const fake = makeFake({ schema: () => ({ columns: [] }) });
    const expectedTotal = Object.values(EXPECTED_COLUMNS).reduce((n, cols) => n + cols.length, 0);
    expect(await checkSchema(fake.client)).toHaveLength(expectedTotal);
  });

  it("SCHEMA-005 | a failing schema call rejects so the caller must decide what to do", async () => {
    const fake = makeFake({ schema: () => { throw new Error("schema unavailable"); } });
    // NOTE: App.tsx:61 swallows this and clears the warning, so a Scispot outage
    // during startup looks identical to a healthy schema. Intentional today.
    await expect(checkSchema(fake.client)).rejects.toThrow("schema unavailable");
  });

  it("SCHEMA-006 | every labsheet the app depends on is covered by the load-time check || RCA: EXPECTED_COLUMNS (src/config.ts:36) lists only SHEETS.items and SHEETS.inventory. SHEETS.vendors ('SUP. Suppliers') is never verified at load, even though the vendor node's 'Open ...' button resolves it by exact name. If that sheet is renamed or archived, nothing warns at startup; the user discovers it as 'Could not find labsheet' only after clicking. Fix: add an existence check for every sheet in SHEETS.", () => {
    const declared = Object.values(SHEETS).filter(Boolean);
    const checked = Object.keys(EXPECTED_COLUMNS);
    expect(declared.filter((sheet) => !checked.includes(sheet))).toEqual([]);
  });
});

describe("labsheetUuid() — resolving a sheet for the 'Open ...' button", () => {
  it("UUID-001 | searches by name and returns the matching uuid", async () => {
    const fake = makeFake({ list: () => ({ labsheets: [{ uuid: "sheet-1", name: "UUID-001 Sheet" }] }) });
    expect(await labsheetUuid(fake.client, "UUID-001 Sheet")).toBe("sheet-1");
    expect(fake.calls.list[0]).toEqual({ search: "UUID-001 Sheet", pageSize: 25 });
  });

  it("UUID-002 | the result is cached, so a second lookup makes no request", async () => {
    const fake = makeFake({ list: () => ({ labsheets: [{ uuid: "sheet-2", name: "UUID-002 Sheet" }] }) });
    await labsheetUuid(fake.client, "UUID-002 Sheet");
    await labsheetUuid(fake.client, "UUID-002 Sheet");
    expect(fake.calls.list).toHaveLength(1);
  });

  it("UUID-003 | an unknown sheet resolves to undefined so the UI can explain itself", async () => {
    const fake = makeFake({ list: () => ({ labsheets: [] }) });
    expect(await labsheetUuid(fake.client, "UUID-003 Missing")).toBeUndefined();
  });

  it("UUID-004 | a sheet name differing only in case or trailing space still resolves || RCA: src/lib/sdk.ts:174 matches with strict equality (ls.name === name). Any difference in capitalisation or surrounding whitespace between src/config.ts and Scispot makes the lookup return undefined and the 'Open ...' button reports 'Could not find labsheet'. Fix: compare trimmed and lower-cased.", async () => {
    const fake = makeFake({ list: () => ({ labsheets: [{ uuid: "sheet-4", name: "UUID-004 sheet " }] }) });
    expect(await labsheetUuid(fake.client, "UUID-004 Sheet")).toBe("sheet-4");
  });
});

describe("boot parameters and connect()", () => {
  type FakeWindow = { location: { search: string; hash: string; hostname: string }; Scispot?: unknown };
  const global = globalThis as unknown as { window?: FakeWindow };

  const setUrl = (search: string, hash: string, hostname = "localhost"): FakeWindow => {
    global.window = { location: { search, hash, hostname } };
    return global.window;
  };

  afterEach(() => {
    delete global.window;
  });

  it("BOOT-001 | reads ?token from the query string", () => {
    setUrl("?token=abc123", "");
    expect(readBootParams().token).toBe("abc123");
  });

  it("BOOT-002 | accepts ?sas_token as an alias", () => {
    setUrl("?sas_token=sas_xyz", "");
    expect(readBootParams().token).toBe("sas_xyz");
  });

  it("BOOT-003 | finds a param after the '?' inside the hash", () => {
    setUrl("", "#/?token=hashtoken&q=IT001");
    const boot = readBootParams();
    expect(boot.token).toBe("hashtoken");
    expect(boot.q).toBe("IT001");
  });

  it("BOOT-004 | the query string wins over the hash", () => {
    setUrl("?q=FROM_SEARCH", "#/?q=FROM_HASH");
    expect(readBootParams().q).toBe("FROM_SEARCH");
  });

  it("BOOT-005 | jazzDebug is on for '1' and 'true' only", () => {
    setUrl("?jazzDebug=1", "");
    expect(readBootParams().debug).toBe(true);
    setUrl("?jazzDebug=true", "");
    expect(readBootParams().debug).toBe(true);
    setUrl("?jazzDebug=yes", "");
    expect(readBootParams().debug).toBe(false);
  });

  it("BOOT-006 | on localhost appOrigin defaults to the Scispot labsheets origin", () => {
    setUrl("", "", "localhost");
    expect(readBootParams().appOrigin).toBe("https://labsheets.scispot.io");
  });

  it("BOOT-007 | when hosted, appOrigin comes only from the host's query param", () => {
    setUrl("", "", "scispot-smartapp-d3340961.s3.amazonaws.com");
    expect(readBootParams().appOrigin).toBe("");
    setUrl("?appOrigin=https://app.scispot.io", "", "scispot-smartapp-d3340961.s3.amazonaws.com");
    expect(readBootParams().appOrigin).toBe("https://app.scispot.io");
  });

  it("BOOT-008 | values are trimmed and a missing param is an empty string", () => {
    setUrl("?q=%20%20IT001%20%20", "");
    expect(readBootParams().q).toBe("IT001");
    setUrl("", "");
    expect(queryParam("nothing")).toBe("");
  });

  it("CONN-001 | a missing SDK script produces an actionable error, not a crash", async () => {
    setUrl("", "");
    await expect(connectScispot({ token: "", appOrigin: "", debug: false, q: "" })).rejects.toThrow(
      /Scispot Jazz SDK did not load/,
    );
  });

  it("CONN-002 | the app id is always sent, and blank boot values are omitted", async () => {
    const seen: Array<Record<string, unknown>> = [];
    setUrl("", "").Scispot = {
      connect: async (opts: Record<string, unknown>) => {
        seen.push(opts);
        return { labsheets: {} };
      },
    };
    await connectScispot({ token: "", appOrigin: "", debug: false, q: "" });
    expect(seen[0]!.appId).toBe("d3340961-d93b-47b8-83ec-3c73032c01e1");
    expect(seen[0]).not.toHaveProperty("token");
    expect(seen[0]).not.toHaveProperty("appOrigin");
    expect(seen[0]).not.toHaveProperty("debug");
  });

  it("CONN-003 | token, appOrigin and debug are forwarded when present", async () => {
    const seen: Array<Record<string, unknown>> = [];
    setUrl("", "").Scispot = {
      connect: async (opts: Record<string, unknown>) => {
        seen.push(opts);
        return { labsheets: {} };
      },
    };
    await connectScispot({ token: "t", appOrigin: "https://app.scispot.io", debug: true, q: "" });
    expect(seen[0]!.token).toBe("t");
    expect(seen[0]!.appOrigin).toBe("https://app.scispot.io");
    expect(seen[0]!.debug).toBe(true);
  });
});
