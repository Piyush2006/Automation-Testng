/** The detail panel behind each node, and the Open-in-Scispot deep links. */
import { expect, test } from "@playwright/test";
import { SHEETS } from "../src/config";
import { CHEMICALS } from "./fixtures/data";
import { pick } from "./fixtures/actions";
import { installScispot, openedLabsheets } from "./fixtures/stub";

const sheet = (page: import("@playwright/test").Page) => page.getByRole("dialog");
const closeButton = (page: import("@playwright/test").Page) => page.locator('aside button[aria-label="Close details"]');

async function openLot(page: import("@playwright/test").Page, lotNumber: string) {
  await page.getByRole("button", { name: new RegExp(lotNumber) }).click();
  await expect(sheet(page)).toBeVisible();
}

test.describe("node detail sheet", () => {
  test.beforeEach(async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();
  });

  test("UI-050 | clicking the item node opens its detail sheet || RCA: the nodes are the only way into the detail. If the click does nothing, item ID, synonyms and lot count are all unreachable.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await page.getByRole("button", { name: /Inventory item/ }).click();

    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole("heading")).toContainText(CHEMICALS.mercaptoethanol);
    await expect(sheet(page)).toContainText("IT0001");
    await expect(sheet(page)).toContainText("BME, beta-mercaptoethanol");
  });

  test("UI-051 | a lot sheet shows lot number, expiry, location and supplier || RCA: this panel is the audit record for a physical bottle. A missing field means the custody trail has a hole in it.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");

    await expect(sheet(page)).toContainText("M22-114");
    await expect(sheet(page)).toContainText("2027-03-31");
    await expect(sheet(page)).toContainText("Sigma-Aldrich");
    await expect(sheet(page)).toContainText("10 mL");
  });

  test("UI-052 | Asset Location is shown when both location columns are filled || RCA: the two columns disagree in practice. Showing the fallback instead sends someone to the wrong fridge.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");
    await expect(sheet(page)).toContainText("Cold Room A / Shelf 2");
  });

  test("UI-053 | Location is used when Asset Location is empty || RCA: without the fallback, every lot recorded in the older column shows no location at all and the bottle cannot be found.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M23-008");
    await expect(sheet(page)).toContainText("Bench 4");
  });

  test("UI-054 | empty fields are left out rather than shown blank || RCA: a long list of empty labels buries the fields that are filled, and reads as data loss rather than data that was never entered.", async ({ page }) => {
    await pick(page, CHEMICALS.acetonitrile);
    await openLot(page, "A-01");
    await expect(sheet(page)).not.toContainText("Expiration date");
    await expect(sheet(page)).toContainText("Lot number");
  });

  test("UI-055 | Escape closes the sheet || RCA: it is a modal over the whole page. No keyboard exit traps keyboard and screen-reader users behind it.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("UI-056 | the close button closes the sheet || RCA: the mouse path out. If only Escape works, most users force a page reload and lose their place.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");
    await closeButton(page).click();
    await expect(sheet(page)).toBeHidden();
  });

  test("UI-057 | a lot opens A. Materials Manager, not the catalogue || RCA: each node must deep-link its own labsheet. Sending a lot to the wrong sheet drops the user into unrelated rows and they edit the wrong record.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");

    await page.getByRole("button", { name: new RegExp(`Open ${SHEETS.inventory}`) }).click();
    await expect(async () => {
      const opened = await openedLabsheets(page);
      expect(opened.length).toBe(1);
      expect(opened[0]!.uuid).toContain("materials-manager");
      expect(opened[0]!.newTab).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test("UI-058 | a vendor opens SUP. Suppliers, never the inventory sheet || RCA: the vendor node is the one place the supplier registry is reachable. Pointing it at inventory would quietly make that sheet unreachable from the app.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await page.getByRole("button", { name: /Vendor.*Sigma-Aldrich/ }).click();
    await expect(sheet(page)).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`Open ${SHEETS.vendors}`) }).click();
    await expect(async () => {
      const opened = await openedLabsheets(page);
      expect(opened.length).toBe(1);
      expect(opened[0]!.uuid).toContain("sup-suppliers");
    }).toPass({ timeout: 5000 });
  });

  test("UI-059 | the item node opens the catalogue labsheet || RCA: the third of the three deep links. Each is a separate code path and each has been wrong at least once.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await page.getByRole("button", { name: /Inventory item/ }).click();

    await page.getByRole("button", { name: new RegExp(`Open ${SHEETS.items}`) }).click();
    await expect(async () => {
      const opened = await openedLabsheets(page);
      expect(opened[0]!.uuid).toContain("list-of-inventory-items");
    }).toPass({ timeout: 5000 });
  });

  test("UI-060 | outside Jazz, Open explains itself instead of failing silently || RCA: openLabsheet does not exist when the app is not embedded in Scispot. A dead button with no message reads as a broken app.", async ({ page }) => {
    await installScispot(page, { omitOpenLabsheet: true });
    await page.goto("/");
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");

    await page.getByRole("button", { name: new RegExp(`Open ${SHEETS.inventory}`) }).click();
    await expect(page.getByText("Opening Scispot works when the app runs inside Jazz.")).toBeVisible();
  });

  test("UI-061 | the lot sheet never reports an unlinked Chemical Item || RCA: KNOWN DEFECT (CHAIN-015). 'Not set; matched by product name' is unreachable because lot.linked is hardcoded true, so this panel cannot tell a real relation from a text match.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");
    await expect(sheet(page)).not.toContainText("Not set; matched by product name");
  });

  test("UI-062 | the copy button reports back after copying || RCA: clipboard access is refused in some embeds. Without the confirmation the user cannot tell whether the ID was copied before they paste.", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await pick(page, CHEMICALS.mercaptoethanol);
    await openLot(page, "M22-114");

    await page.getByRole("button", { name: /Copy inventory ID/ }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  });
});
