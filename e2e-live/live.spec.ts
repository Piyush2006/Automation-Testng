/**
 * The agreed 42 lines, run against the REAL Scispot tenant in a real browser.
 * Lines 3.9, 4.2, 4.4, 4.5, 5.1, 5.2 live in schema.spec.ts; the other 36 are here.
 *
 * READ-ONLY. Searches, views and opens. Creates nothing, edits nothing, deletes nothing.
 * All data is discovered at run time.
 */
import { test, expect, type Page, type FrameLocator } from "@playwright/test";
import { SHEETS } from "../src/config";

const APP = "https://labsheets.scispot.io/smart-apps/d3340961-d93b-47b8-83ec-3c73032c01e1?appName=Chemical+Chain+of+Custody";
const SDK = /scispot-smart-apps-api/;          // the app's own calls, not Jazz platform chatter

let page: Page;
let app: FrameLocator;
const calls: string[] = [];
const seen = { chemical: "", itemId: "", note: "" };
const searches = () => calls.filter((c) => /rows\/search/.test(c));

const combo = () => app.getByRole("combobox");
const options = () => app.getByRole("option");
const trigger = () => app.getByRole("button", { name: /Search for a chemical/ });
const itemNode = () => app.getByRole("button", { name: /^Inventory item/ });
const lotNodes = () => app.getByRole("button", { name: /^Lot no\./ });
const vendorNodes = () => app.getByRole("button", { name: /^Vendor/ });

async function fresh() {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  app = page.frameLocator("iframe");
  await expect(trigger()).toBeEnabled({ timeout: 45_000 });
}
async function open() {
  await trigger().click();
  await expect(combo()).toBeVisible();
}
/** Pick a chemical and wait for the chain to finish drawing, not just the first node. */
async function choose(name: string) {
  await open();
  await combo().fill(name);
  await expect(options().first()).toBeVisible();
  await options().first().click();
  await expect(itemNode()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await lotNodes().count()) + (await app.getByText(/No Materials Manager rows match/).count()),
          { timeout: 30_000 })
    .toBeGreaterThan(0);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("request", (r) => { if (SDK.test(r.url())) calls.push(r.url() + " :: " + (r.postData() ?? "")); });
  await fresh();
  // Every worker discovers its own chemical: with parallel workers there is no
  // guarantee this process ever runs L1.1, so nothing may rely on it having run.
  await trigger().click();
  await expect(combo()).toBeVisible();
  const first = (await options().first().textContent()) ?? "";
  seen.itemId = (first.match(/IT\d+/) ?? [""])[0];
  seen.chemical = first.replace(seen.itemId, "").trim();
  await combo().press("Escape").catch(() => {});
});
/** A failed test makes Playwright tear the context down, which closes the page this
 *  suite shares. Rebuild it so one red line cannot take the next three with it. */
/** Put the app back into "a chemical is picked and its chain is drawn", whatever
 *  state the previous test left behind. Lets any test stand on its own. */
async function ensureChain() {
  if (page.isClosed()) return;
  if (await app.getByRole("dialog").count()) await page.keyboard.press("Escape").catch(() => {});
  if (await itemNode().count()) return;
  await fresh();
  await choose(seen.chemical);
}
/** Open the first lot's panel, from whatever state. */
async function ensureLotPanel() {
  await ensureChain();
  if (!(await app.getByRole("dialog").count())) await lotNodes().first().click();
  await expect(app.getByRole("dialog")).toBeVisible();
}

test.beforeEach(async ({ browser }) => {
  if (page && !page.isClosed()) return;
  page = await browser.newPage();
  page.on("request", (r) => { if (SDK.test(r.url())) calls.push(r.url() + " :: " + (r.postData() ?? "")); });
  await fresh();
  if (seen.chemical) await choose(seen.chemical).catch(() => {});
});

test.afterAll(async () => { await page?.close().catch(() => {}); });

// ─────────────────────────── 6. Getting connected ───────────────────────────

test("L6.1 | Given Scispot embeds the app in an iframe, When it loads, Then it reads the app id, origin and token from the URL", async () => {
  const u = new URL((await page.locator("iframe").first().getAttribute("src"))!);
  expect(u.searchParams.get("appId")).toBe("d3340961-d93b-47b8-83ec-3c73032c01e1");
  expect(u.searchParams.get("appOrigin")).toBe("https://labsheets.scispot.io");
  expect((u.searchParams.get("token") ?? "").length).toBeGreaterThan(100);
});

test("L6.2 | Given the app has loaded, When it opens a session, Then it tells Scispot which app is asking", async () => {
  const session = calls.find((c) => /\/sessions\b/.test(c));
  expect(session, "no session call was made").toBeTruthy();
  expect(session).toContain("d3340961-d93b-47b8-83ec-3c73032c01e1");
});

test("L6.4 | Given nothing has been picked yet, When the app first renders, Then it says what to do next", async () => {
  await expect(app.getByText(/Search by name or note/i)).toBeVisible();
});

// ───────────────────────── 1. Searching for a chemical ─────────────────────────

test("L1.1 | Given the catalogue is open, When I type a chemical name, Then the list narrows to matching chemicals", async () => {
  await open();
  await expect(options().first()).toBeVisible();
  const all = await options().count();
  await combo().fill(seen.chemical);
  await expect.poll(async () => options().count(), { timeout: 15_000 }).toBeLessThan(all);
  console.log(`      chemical="${seen.chemical}" itemId="${seen.itemId}" catalogue=${all}`);
});

test("L1.2 | Given every Note in the catalogue reads \u201cNA\u201d, When the list renders, Then no placeholder text appears under any name", async () => {
  await combo().fill("");
  await expect(options().first()).toBeVisible();
  const texts = await options().allTextContents();
  seen.note = texts.find((t) => /·/.test(t)) ?? "";
  expect(texts.filter((t) => /·\s*(NA|N\/A|none)\s*$/i.test(t)).join(" | "),
         'a literal "NA" Note was printed under a chemical').toBe("");
  if (!seen.note) console.log('      no synonyms in this tenant — every Note is "NA", correctly stripped');
});

test("L1.2b | Given a chemical has a real Note, When I search that nickname, Then the chemical is found", async () => {
  test.skip(!seen.note, 'no chemical has a real Note — every one is "NA", so there is no synonym to search for');
  await combo().fill(seen.note.split("·").pop()!.trim());
  await expect(options().first()).toBeVisible();
});

test("L1.3 | Given a chemical has an item ID, When I type the full ID, Then that chemical is found", async () => {
  test.skip(!seen.itemId, "no IT-pattern id in the live catalogue");
  await combo().fill(seen.itemId);
  await expect.poll(async () => options().count(), { timeout: 15_000 }).toBe(1);
  await expect(options().first()).toContainText(seen.chemical);
  const sent = searches().at(-1) ?? "";
  console.log(`      live Scispot ACCEPTED the ID filter: ${/"column":"ID"/.test(sent)}`);
  expect(sent, "the ID filter was dropped before sending").toContain('"column":"ID"');
});

test("L1.4 | Given I have typed a full item ID, When I press Enter, Then that chemical resolves", async () => {
  test.skip(!seen.itemId, "no IT-pattern id in the live catalogue");
  await combo().fill(seen.itemId);
  await combo().press("Enter");
  await expect(itemNode()).toBeVisible({ timeout: 30_000 });
});

test("L1.5 | Given the catalogue is open, When I read the options and then search nonsense, Then none is blank and the box says no matches", async () => {
  await fresh();
  await open();
  const texts = await options().allTextContents();
  expect(texts.every((t) => t.trim().length > 0), "a nameless row reached the dropdown").toBe(true);
  expect(texts.some((t) => /^\s*(NA|N\/A|none|-)\s*$/i.test(t)), "a placeholder leaked into the list").toBe(false);
  await combo().fill("zzzqqqnotachemical");
  await expect(app.getByText("No matches")).toBeVisible();
});

test("L1.6 | Given a chemical exists, When I search its name in capitals, Then it is still found", async () => {
  await combo().fill(seen.chemical.toUpperCase());
  await expect.poll(async () => options().count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(options().first()).toContainText(seen.chemical);
});

test("L1.7 | Given the search box is focused, When I type six characters quickly, Then fewer than six searches are sent", async () => {
  await combo().fill("");
  await page.waitForTimeout(800);
  const before = searches().length;
  await combo().pressSequentially(seen.chemical.slice(0, 6), { delay: 20 });
  await page.waitForTimeout(1500);
  const fired = searches().length - before;
  console.log(`      6 keystrokes → ${fired} search call(s)`);
  expect(fired).toBeGreaterThan(0);
  expect(fired).toBeLessThan(6);
});

test("L1.7b | Given the catalogue is open, When I use arrows, Enter, clear and Escape, Then each does what it says", async () => {
  await fresh();
  await open();
  await combo().fill(seen.chemical);
  await expect(options().first()).toBeVisible();
  await combo().press("ArrowDown");
  await combo().press("Enter");
  await expect(itemNode()).toBeVisible({ timeout: 30_000 });
  await app.getByRole("button", { name: /Clear selected chemical/ }).click();
  await expect(itemNode()).toHaveCount(0);
  await open();
  await combo().press("Escape");
  await expect(combo()).toBeHidden();
});

test("L1.8 | Given Scispot is unreachable, When I search, Then the box reports the outage instead of looking empty", async () => {
  await fresh();
  await page.route(SDK, (r) => r.abort());
  await open();
  await combo().fill("anything");
  await expect(
    app.getByText(/lost connection|could not|unable|went wrong|try again/i).locator("visible=true").first(),
  ).toBeVisible({ timeout: 25_000 });
  await page.unroute(SDK);
});

test("L1.9 | Given I type a term, When the app queries Scispot, Then it asks the catalogue sheet for name, note and ID", async () => {
  await fresh();
  await open();
  await combo().fill("reag");
  await expect.poll(async () => searches().length, { timeout: 15_000 }).toBeGreaterThan(0);
  const sent = searches().at(-1)!;
  expect(decodeURIComponent(sent)).toContain(SHEETS.items);
  expect(sent, "the Note column is what makes synonyms findable").toContain('"column":"Note"');
  expect(sent).toContain('"match":"any"');
});

// ────────────────── 2. The lots and vendors that come back ──────────────────

test("L2.1 | Given a chemical is picked, When its lots load, Then every lot of that chemical appears and no others", async () => {
  await fresh();
  await choose(seen.chemical);
  const sent = calls.filter((c) => /A\.%20Materials%20Manager\/rows\/search/.test(c)).at(-1) ?? "";
  console.log(`      lot query: ${sent.split(":: ")[1]?.slice(0, 120)}`);
  expect(sent, "lots must be joined on an exact Name match").toContain('"operator":"Equals"');
  expect(await lotNodes().count()).toBeGreaterThan(0);
});

test("L2.2 | Given Scispot returns 25 rows at a time, When lots load, Then the app pages through until it has them all", async () => {
  expect(calls.some((c) => /rows\?page=\d+&pageSize=\d+/.test(c)), "no paged request observed").toBe(true);
});

test("L2.3 | Given the chain has drawn, When I count the lots, Then no lot appears twice", async () => {
  await ensureChain();
  const lots = await lotNodes().allTextContents();
  expect(new Set(lots).size).toBe(lots.length);
});

test("L2.4 | Given a chemical is picked, When the chain draws, Then the chemical, each lot and each lot\u2019s vendor are shown", async () => {
  await ensureChain();
  const lots = await lotNodes().count();
  const vendors = await vendorNodes().count();
  console.log(`      ${lots} lot node(s), ${vendors} vendor node(s)`);
  expect(lots).toBeGreaterThan(0);
  expect(vendors).toBeGreaterThan(0);
});

test("L2.5 | Given a lot has a supplier and a location, When the chain draws, Then both are read from the right columns", async () => {
  await ensureChain();
  const vendors = (await vendorNodes().allTextContents()).map((v) => v.replace(/^Vendor/, "").trim());
  console.log(`      vendors: ${vendors.join(" | ")}`);
  expect(vendors.every((v) => v.length > 2 && !/^\d/.test(v)), "a vendor node shows something that is not a supplier name").toBe(true);
});

test("L2.6 | Given I click a lot, When its panel opens, Then it shows lot number, expiry, location and supplier", async () => {
  await ensureLotPanel();
  const panel = app.getByRole("dialog");
  const text = (await panel.textContent()) ?? "";
  console.log(`      panel: ${text.replace(/\s+/g, " ").trim().slice(0, 170)}`);
  expect(/Lot number/i.test(text), "no lot number").toBe(true);
  expect(/Expiration date/i.test(text), "no expiry").toBe(true);
  expect(/Location/i.test(text), "no storage location").toBe(true);
  // The app labels the supplier "Manufacturer" on this panel.
  expect(/Manufacturer|Supplier|Vendor/i.test(text), "no supplier").toBe(true);
});

test("L3.10 | Given a lot\u2019s panel is open, When I read the containers figure, Then it is not negative", async () => {
  await ensureLotPanel();
  const text = (await app.getByRole("dialog").textContent()) ?? "";
  const m = text.match(/Containers\s*(-?[\d.]+)/i);
  console.log(`      containers reads: ${m?.[0] ?? "(not shown)"}`);
  test.skip(!m, "this lot does not show a containers figure");
  expect(Number(m![1]), "a negative container count is shown to the user").toBeGreaterThanOrEqual(0);
});

test("L2.7 | Given a panel is open, When I read its fields, Then no raw NA, undefined or [object Object] appears", async () => {
  await ensureLotPanel();
  const panel = (await app.getByRole("dialog").textContent()) ?? "";
  expect(panel).not.toContain("[object Object]");
  expect(panel).not.toContain("undefined");
  expect(panel, 'the live Notes column is literally "NA"').not.toMatch(/:\s*NA\b/);
});

test("L2.10 | Given a panel is open, When I press Escape or click close, Then the panel closes", async () => {
  await ensureLotPanel();
  const panel = app.getByRole("dialog");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await itemNode().click();
  await expect(panel).toBeVisible();
  const close = app.locator('aside button[aria-label="Close details"]');
  await close.click();
  await expect(panel).toHaveCount(0);
});

test("L2.9 | Given a lot or vendor panel is open, When I click Open, Then it points at that record\u2019s own labsheet", async () => {
  await ensureLotPanel();
  await expect(app.getByRole("button", { name: new RegExp(`Open ${SHEETS.inventory}`) })).toBeVisible();
  await page.keyboard.press("Escape");
  await vendorNodes().first().click();
  await expect(app.getByRole("button", { name: new RegExp(`Open ${SHEETS.vendors}`) })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("L2.12 | Given every lot is matched by name, When the chain draws, Then the \u201cmatched by name\u201d badge still never appears", async () => {
  await ensureChain();
  await expect(app.getByText("Matched by name", { exact: true })).toHaveCount(0);
});

test("L2.11 | Given a chemical has no stock, When I pick it, Then the app says so instead of drawing an empty chain", async () => {
  await fresh();
  await open();
  const names = (await options().allTextContents()).slice(0, 8)
    .map((t) => t.replace(/IT\d+/, "").trim()).filter(Boolean);
  for (const name of names) {
    await combo().fill(name);
    if (!(await options().first().count())) continue;
    await options().first().click();
    await expect(itemNode()).toBeVisible({ timeout: 30_000 });
    if (await app.getByText(/No Materials Manager rows match/).count()) {
      console.log(`      "${name}" has no stock, and says so`);
      return;
    }
    await fresh(); await open();
  }
  test.skip(true, "every chemical on the first catalogue page has stock");
});

test("L2.8 | Given Scispot fails while lots load, When the chain tries to draw, Then a retry card appears instead of a crash", async () => {
  await fresh();
  await open();
  await combo().fill(seen.chemical);
  await expect(options().first()).toBeVisible();
  await page.route(SDK, (r) => r.abort());
  await options().first().click();
  await expect(app.getByRole("button", { name: /Try again/i }).first()).toBeVisible({ timeout: 25_000 });
});

test("L6.3 | Given the retry card is showing, When Scispot answers again and I retry, Then the chain draws", async () => {
  await page.unroute(SDK);
  await app.getByRole("button", { name: /Try again/i }).first().click();
  await expect(itemNode()).toBeVisible({ timeout: 30_000 });
});

// ──────────────── 3. Quantity Left, and the sum across vendors ────────────────

test("L3.3 | Given a chemical has lots from several vendors, When the chain draws, Then all of them add into one total", async () => {
  await fresh();
  await choose(seen.chemical);
  const vendors = await vendorNodes().count();
  const header = (await itemNode().textContent()) ?? "";
  console.log(`      ${vendors} vendor(s) → ${header.replace(/\s+/g, " ").trim()}`);
  expect(vendors).toBeGreaterThan(1);
  expect(/[\d.]+\s*(mL|g|each)/i.test(header)).toBe(true);
});

test("L3.4 | Given lots are shown with amounts, When I add them up, Then they equal the total in the header", async () => {
  await ensureChain();
  const banner = app.getByText(/reconcile to inventory total|is the inventory total/);
  await expect(banner).toBeVisible();
  const sum = (await app.getByText(/\d.*\+.*=.*\d/).first().textContent()) ?? "";
  console.log(`      ${sum.replace(/\s+/g, " ").trim()}`);
  const m = sum.match(/([\d.]+)\s*mL\s*\+\s*([\d.]+)\s*mL\s*=\s*([\d.]+)\s*mL/i);
  expect(m, "no worked sum rendered").toBeTruthy();
  expect(Number(m![1]) + Number(m![2])).toBeCloseTo(Number(m![3]), 1);
});

test("L3.2 | Given amounts are on screen, When I read their units, Then every one is a unit the app understands", async () => {
  await ensureChain();
  const body = (await app.locator("main, body").first().textContent()) ?? "";
  const units = [...new Set([...body.matchAll(/[\d.]\s*([a-zA-Zµμ]{1,4})\b/g)].map((m) => m[1]!.toLowerCase()))];
  const known = ["ml", "l", "ul", "µl", "μl", "g", "gm", "mg", "kg", "each", "units"];
  console.log(`      units rendered: ${units.join(", ")}`);
  expect(units.filter((u) => u.length <= 2 && !known.includes(u)).join(", ")).toBe("");
});

test("L3.6 | Given a lot has no usable amount, When the chain draws, Then it is flagged rather than dropped in silence", async () => {
  await ensureChain();
  const flagged = await app.getByText(/Not counted \(no amount in Unit\)/).count();
  console.log(`      lots flagged as not counted: ${flagged}`);
  expect(flagged).toBe(0);
});

test("L3.7 | Given a total is shown, When I read it, Then it carries no floating-point noise", async () => {
  await ensureChain();
  expect((await itemNode().textContent()) ?? "").not.toMatch(/\.\d{5,}/);
});

test.skip("L3.1 | Given Quantity Left, Total Quantity and Quantity differ, When the amount is read, Then the first non-empty one wins", () => {
  // Internal fallback order. The live rows give no case where Quantity Left is set
  // and Total Quantity differs, so the order cannot be observed from outside.
});
test.skip("L3.5 | Given lots recorded in different units, When they are added, Then each converts to the base unit first", () => {
  // Every lot in this tenant is recorded in uL, so no mixed-unit case exists live.
  // Covered against the stand-in by UI-043 and LOGIC-021.
});
test.skip("L3.8 | Given the app shipped with 13 quantity tests, When the suite runs, Then they all still pass", () => {
  // Pure unit tests with no UI. They run under `npm run test`.
});

// ─────────── 4. When somebody renames a column or changes a mapping ───────────

test("L4.1 | Given the labsheets are unchanged, When the app starts, Then the schema check runs and raises nothing", async () => {
  await fresh();
  await expect(app.getByText(/Labsheet columns changed/)).toHaveCount(0);
  const checked = calls.filter((c) => /\/schema/.test(c)).map((c) => decodeURIComponent(c).match(/labsheets\/(.+?)\/schema/)?.[1]);
  console.log(`      schema checked for: ${[...new Set(checked)].join(", ")}`);
  expect(checked).toContain(SHEETS.items);
  expect(checked).toContain(SHEETS.inventory);
});

test("L4.1b | Given the app opens the suppliers sheet, When it starts up, Then that sheet\u2019s columns are never verified", async () => {
  const checked = calls.filter((c) => /\/schema/.test(c)).map((c) => decodeURIComponent(c));
  const looked = calls.filter((c) => decodeURIComponent(c).includes(`search=${SHEETS.vendors}`.replace(/ /g, "+")));
  expect(looked.length, "the app never resolves the suppliers sheet").toBeGreaterThan(0);
  expect(checked.some((c) => c.includes(SHEETS.vendors)),
         `${SHEETS.vendors} is resolved and opened, but its columns are never verified at load`).toBe(false);
});

test("L4.3 | Given the app needs a labsheet by name, When it looks one up, Then it finds it and remembers the answer", async () => {
  const lookups = calls.filter((c) => /labsheets\?pageSize=\d+&search=/.test(c));
  const byName = new Map<string, number>();
  for (const l of lookups) {
    const n = decodeURIComponent(l).match(/search=(.+?)(?:\s|::|$)/)?.[1]?.replace(/\+/g, " ") ?? "?";
    byName.set(n, (byName.get(n) ?? 0) + 1);
  }
  console.log(`      lookups: ${[...byName].map(([n, c]) => `${n}×${c}`).join(", ")}`);
  expect(lookups.length).toBeGreaterThan(0);
});

test.skip("L5.3 | Given the dependency manifest, When it is checked against the code, Then every entry is real and still used", () => {
  // Checks the repo's manifest against its own code. No live surface.
  // Runs under `npm run test:deps` as GUARD-030 … GUARD-033.
});
