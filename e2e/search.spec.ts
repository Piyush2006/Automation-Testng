/** The chemical search box: browsing, filtering, keyboard, paging, failure. */
import { expect, test } from "@playwright/test";
import { SHEETS } from "../src/config";
import { CHEMICALS } from "./fixtures/data";
import { calls, openDropdown, pick } from "./fixtures/actions";
import { installScispot } from "./fixtures/stub";

test.beforeEach(async ({ page }) => {
  await installScispot(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();
});

test("UI-010 | opening the box browses the catalogue with no term || RCA: if an empty term does not list anything, a user who does not know the exact spelling has no way in at all.", async ({ page }) => {
  await openDropdown(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(await page.getByRole("option").count()).toBeGreaterThan(5);

  const browse = (await calls(page)).rows;
  expect(browse.some((r) => r.sheet === SHEETS.items)).toBe(true);
});

test("UI-011 | typing narrows the list to matching chemicals || RCA: the search filter is the app's main control. A broken filter returns everything or nothing, and the graph below is never reached.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("mercapto");

  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toContainText(CHEMICALS.mercaptoethanol);
});

test("UI-012 | a row with no Item Name never reaches the dropdown || RCA: a nameless option is unclickable and unreadable; it looks like a rendering fault and it cannot lead anywhere.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("a row with no Item Name");
  await expect(page.getByText("No matches")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("UI-013 | six keystrokes do not fire six searches || RCA: the 220 ms debounce is what stops a typist generating a request per character. Without it Scispot is hammered and the dropdown flickers between stale result sets.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").pressSequentially("sodium", { delay: 25 });
  // Wait for the list to actually narrow, so the debounced request has landed.
  await expect(page.getByRole("option")).toHaveCount(1);

  const searches = (await calls(page)).search.filter((s) => s.sheet === SHEETS.items);
  expect(searches.length).toBeGreaterThan(0);
  expect(searches.length).toBeLessThanOrEqual(3);
});

test("UI-014 | the Note is shown under the name, so synonyms are findable || RCA: chemists search by synonym far more than by catalogue name. If the Note is not visible, the user cannot tell which of two similar rows is theirs.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("NaCl");
  const option = page.getByRole("option").first();
  await expect(option).toContainText(CHEMICALS.salt);
  await expect(option).toContainText("NaCl, table salt");
});

test("UI-015 | ArrowDown then Enter picks the highlighted chemical || RCA: keyboard selection is the fast path and an accessibility requirement. If Enter does nothing, the box can only be used with a mouse.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("Acetonitrile");
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.getByRole("combobox").press("ArrowDown");
  await page.getByRole("combobox").press("Enter");

  await expect(page.getByRole("button", { name: new RegExp(CHEMICALS.acetonitrile) }).first()).toBeVisible();
});

test("UI-016 | Escape closes the box without selecting || RCA: with no way out, a user who opened the box by accident is stuck behind an overlay covering the page.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").press("Escape");
  await expect(page.getByRole("combobox")).toBeHidden();
  await expect(page.getByText("Pick one to see each lot")).toBeVisible();
});

test("UI-017 | clearing the selection returns to the starting state || RCA: without a clear, looking up a second chemical means reloading the app, and the stale graph stays on screen beside the new search.", async ({ page }) => {
  await pick(page, CHEMICALS.mercaptoethanol);
  await expect(page.getByRole("button", { name: /Inventory item/ })).toBeVisible();

  await page.getByRole("button", { name: "Clear selected chemical" }).click();
  await expect(page.getByText("Pick one to see each lot")).toBeVisible();
});

test("UI-018 | a full item ID typed into the box matches nothing || RCA: KNOWN DEFECT (CONTRACT-004). The placeholder offers 'item ID' but the only ID filter sent is `Contains` on an ID_BARCODE column, which Scispot rejects; the fallback drops the ID filter entirely. This case pins the current behaviour so a fix is visible.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("IT0003");
  await expect(page.getByText("No matches")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("UI-019 | pressing Enter on that same item ID does resolve it || RCA: the workaround for UI-018. If Enter stops resolving IDs too, item IDs become entirely unusable and the placeholder is a lie.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("IT0003");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.getByRole("combobox").press("Enter");

  await expect(page.getByRole("button", { name: new RegExp(CHEMICALS.acetonitrile) }).first()).toBeVisible();
});

test("UI-020 | a term that matches nothing says so instead of going quiet || RCA: a blank dropdown is read as a loading failure. The user retypes the same thing instead of trying a different word.", async ({ page }) => {
  await openDropdown(page);
  await page.getByRole("combobox").fill("zzzz-not-a-chemical");
  await expect(page.getByText("No matches")).toBeVisible();
});

test("UI-021 | the first page is capped and more load on scroll || RCA: a catalogue of thousands cannot arrive in one response. If paging breaks, chemicals past the first page are unreachable through the dropdown.", async ({ page }) => {
  await openDropdown(page);
  await expect(page.getByRole("option").first()).toBeVisible();

  const firstPage = await page.getByRole("option").count();
  expect(firstPage).toBeLessThanOrEqual(25);
  await expect(page.getByText("Scroll for more")).toBeVisible();

  await page.getByRole("listbox").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(async () => {
    expect(await page.getByRole("option").count()).toBeGreaterThan(firstPage);
  }).toPass({ timeout: 5000 });
});

test("UI-022 | a Scispot failure while browsing is reported in the box || RCA: swallowing the error leaves an empty list that looks like an empty catalogue, so nobody reports the outage.", async ({ page }) => {
  await installScispot(page, { failSheet: SHEETS.items, failMessage: "Scispot is unavailable (503)." });
  await page.goto("/");
  await openDropdown(page);
  await expect(page.getByText("Scispot is unavailable (503).")).toBeVisible();
});

test("UI-023 | the search asks Scispot for the right sheet and columns || RCA: the request is the dependency. Searching the wrong labsheet, or dropping the Note column, silently changes what a user can find.", async ({ page }) => {
  await openDropdown(page);
  // The browse results are still on screen until the debounced search lands,
  // so wait for the list to narrow before reading what was requested.
  await page.getByRole("combobox").fill("mercapto");
  await expect(page.getByRole("option")).toHaveCount(1);

  const searches = (await calls(page)).search.filter((s) => s.sheet === SHEETS.items);
  expect(searches.length).toBeGreaterThan(0);
  const last = searches[searches.length - 1]!;
  expect(last.match).toBe("any");
  expect(last.filters.map((f) => f.column)).toEqual(["Item Name", "Note"]);
});
