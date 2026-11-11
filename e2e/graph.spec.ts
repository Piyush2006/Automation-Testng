/** The custody graph: item node, lot nodes, vendor nodes, totals, failures. */
import { expect, test } from "@playwright/test";
import { SHEETS } from "../src/config";
import { CHEMICALS } from "./fixtures/data";
import { pick } from "./fixtures/actions";
import { installScispot } from "./fixtures/stub";

const itemNode = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /Inventory item/ });
const banner = (page: import("@playwright/test").Page) => page.getByText(/reconcile to inventory total|is the inventory total/);

test.describe("custody graph", () => {
  test.beforeEach(async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();
  });

  test("UI-030 | picking a chemical renders the item node with its total || RCA: the item node is the answer to 'how much of this do we have'. If the total is missing or wrong, the whole app is misinformation.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await expect(itemNode(page)).toContainText(CHEMICALS.mercaptoethanol);
    await expect(itemNode(page)).toContainText("60 mL");
  });

  test("UI-031 | the worked example reconciles: 10 mL + 50 mL = 60 mL || RCA: this is the sum from the original ticket. If the arithmetic or the unit grouping breaks, people order stock they already have, or run out mid-experiment.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await expect(banner(page)).toBeVisible();
    await expect(page.getByText("10 mL + 50 mL =")).toBeVisible();
  });

  test("UI-032 | every matching lot gets its own node with the amount left || RCA: the per-lot breakdown is how a chemist finds the physical bottle. One missing lot node means stock nobody can locate.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await expect(page.getByRole("button", { name: /M22-114/ })).toContainText("10 mL");
    await expect(page.getByRole("button", { name: /M23-008/ })).toContainText("50 mL");
  });

  test("UI-033 | a lot's supplier renders as its own vendor node || RCA: the vendor node answers 'who sold us this batch', which is the point of a chain of custody. Losing it collapses the chain to stock levels.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await expect(page.getByRole("button", { name: /Vendor.*Sigma-Aldrich/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Vendor.*Thermo Fisher/ })).toBeVisible();
  });

  test("UI-034 | a lot with no Unit is named as not counted || RCA: silently excluding it makes the total read low with no hint. Naming the row tells someone which record to go and fix.", async ({ page }) => {
    await pick(page, CHEMICALS.salt);
    await expect(page.getByText(/Not counted \(no amount in Unit\): MAT12/)).toBeVisible();
  });

  test("UI-035 | more than three lots switch from the tree to the stacked list || RCA: the tree is unreadable past three branches on a laptop; if it does not switch, nodes overlap and the page scrolls sideways.", async ({ page }) => {
    await pick(page, CHEMICALS.acetonitrile);
    await expect(page.locator("ol")).toBeVisible();
    for (const lot of ["A-01", "A-02", "A-03", "A-04"]) {
      await expect(page.getByRole("button", { name: new RegExp(lot) })).toBeVisible();
    }
  });

  test("UI-036 | a chemical with no inventory rows says so plainly || RCA: this message and a broken join look identical to a user, which is exactly why the wording matters. A blank panel would be worse still.", async ({ page }) => {
    await pick(page, CHEMICALS.phosphate);
    await expect(page.getByText(/No Materials Manager rows match this item name yet/)).toBeVisible();
  });

  test("UI-037 | a lot whose product name differs only in case still attaches || RCA: the join is plain text. If capitalisation breaks it, a lot sitting on the shelf disappears from the graph and the total under-reports.", async ({ page }) => {
    await pick(page, CHEMICALS.ethanol);
    await expect(page.getByRole("button", { name: /E-01/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /E-02/ })).toBeVisible();
  });

  test("UI-043 | litres are normalised into the volume base unit || RCA: 1 L + 2 L is shown as 3,000 mL, because every volume is reduced to mL before summing. Correct, but worth pinning: if the base unit or the thousands separator changes, every total on screen changes with it.", async ({ page }) => {
    await pick(page, CHEMICALS.ethanol);
    await expect(itemNode(page)).toContainText("3,000 mL");
  });

  test("UI-038 | a near-miss product name is not pulled in || RCA: 'Potassium Phosphate dibasic' is a different chemical. Attaching it would put another substance's stock into this total and into this chain of custody.", async ({ page }) => {
    await pick(page, CHEMICALS.phosphate);
    await expect(page.getByRole("button", { name: /P-01/ })).toBeHidden();
    await expect(page.getByText(/No Materials Manager rows match/)).toBeVisible();
  });

  test("UI-039 | a lot measured in ng is left out of the reconciled total || RCA: KNOWN DEFECT (GUARD-020 / LOGIC-015). `ng` is a real Unit option in Scispot that UNIT_TABLE does not know, so the lot is typed as a count and never joins the mass total. This case pins the user-visible effect.", async ({ page }) => {
    await pick(page, CHEMICALS.tris);
    await expect(page.getByRole("button", { name: /T-101/ })).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await expect(itemNode(page)).toContainText("10 mL");
    await expect(banner(page)).not.toContainText("ng");
  });

  test("UI-040 | the 'Matched by name' badge never appears, though every lot is name-matched || RCA: KNOWN DEFECT (CHAIN-015). toLot() is called with linked=true for every row, so the badge and the 'not linked yet' note are dead code. The app's own warning about its weakest join can never fire.", async ({ page }) => {
    await pick(page, CHEMICALS.mercaptoethanol);
    await expect(itemNode(page)).toBeVisible();
    await expect(page.getByText("Matched by name", { exact: true })).toHaveCount(0);
  });

  test("UI-041 | a Scispot failure while loading lots shows a retry card naming the chemical || RCA: without it the user sees an item node with no lots, indistinguishable from empty stock, and acts on a total of zero.", async ({ page }) => {
    await installScispot(page, { failSheet: SHEETS.inventory, failMessage: "Inventory request timed out." });
    await page.goto("/");
    await pick(page, CHEMICALS.mercaptoethanol);

    await expect(page.getByText(`Could not load lots for ${CHEMICALS.mercaptoethanol}`)).toBeVisible();
    await expect(page.getByText("Inventory request timed out.")).toBeVisible();
  });

  test("UI-042 | that retry card recovers once Scispot answers || RCA: a retry that does not actually re-request leaves the user stuck on an error for a fault that has already cleared.", async ({ page }) => {
    await installScispot(page, { failSheet: SHEETS.inventory, failMessage: "Inventory request timed out." });
    await page.goto("/");
    await pick(page, CHEMICALS.mercaptoethanol);
    await expect(page.getByText("Inventory request timed out.")).toBeVisible();

    await page.evaluate(() => {
      const fx = (window as unknown as { __SCISPOT_FIXTURE__: { failSheet?: string } }).__SCISPOT_FIXTURE__;
      delete fx.failSheet;
    });
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(itemNode(page)).toContainText("60 mL");
  });
});
