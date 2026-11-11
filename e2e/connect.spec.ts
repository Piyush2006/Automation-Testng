/**
 * Boot, connection and the load-time schema warning.
 * Case titles follow the repo convention: ID | what it checks || RCA: why a failure matters.
 */
import { expect, test } from "@playwright/test";
import { SHEETS } from "../src/config";
import { calls } from "./fixtures/actions";
import { installScispot } from "./fixtures/stub";

test.describe("connection", () => {
  test("UI-001 | the app connects through the Jazz SDK and sends its app id || RCA: connect() is the only way in. A wrong or missing appId means Scispot answers for the wrong app, or refuses, and every screen is empty.", async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();

    const opts = await page.evaluate(() => (window as unknown as { __SCISPOT_CONNECT__?: Record<string, unknown> }).__SCISPOT_CONNECT__);
    expect(opts?.appId).toBe("d3340961-d93b-47b8-83ec-3c73032c01e1");
  });

  test("UI-002 | no token in the URL means no token is sent || RCA: the app must not invent or cache a token. On localhost it has none, and sending an empty one would be rejected rather than falling through to the host session.", async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();

    const opts = await page.evaluate(() => (window as unknown as { __SCISPOT_CONNECT__?: Record<string, unknown> }).__SCISPOT_CONNECT__);
    expect(opts).not.toHaveProperty("token");
  });

  test("UI-003 | a failed connect shows the retry card and the SDK's own message || RCA: if this degrades to a blank page or a silent spinner, the user cannot tell a dead session from an empty inventory, and support has nothing to go on.", async ({ page }) => {
    await installScispot(page, { failConnect: "Session expired. Reopen the app from Jazz." });
    await page.goto("/");

    await expect(page.getByText("Could not connect to Scispot")).toBeVisible();
    await expect(page.getByText("Session expired. Reopen the app from Jazz.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("UI-004 | Try again reconnects without a page reload || RCA: tokens expire mid-session. Without a working retry the user has to close and reopen the app from Scispot, losing whatever they were looking at.", async ({ page }) => {
    await installScispot(page, { failConnect: "Temporary outage." });
    await page.goto("/");
    await expect(page.getByText("Could not connect to Scispot")).toBeVisible();

    // The outage clears, as it would in life.
    await page.evaluate(() => {
      const fx = (window as unknown as { __SCISPOT_FIXTURE__: { failConnect?: string } }).__SCISPOT_FIXTURE__;
      delete fx.failConnect;
    });
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(page.getByText("Could not connect to Scispot")).toBeHidden();
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();
  });

  test("UI-005 | before anything is picked, the page says what to do || RCA: an empty panel with no prompt reads as a broken app. This is the first thing every user sees.", async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByText("Pick one to see each lot, who supplied it, how much is left")).toBeVisible();
  });

  test("UI-006 | a renamed column raises the warning banner at load || RCA: this banner is the app's only defence against schema drift. If it stays silent the renamed field just empties and the user reads a confidently wrong screen.", async ({ page }) => {
    await installScispot(page, { renameColumn: { sheet: SHEETS.inventory, from: "Quantity Left", to: "Qty Remaining" } });
    await page.goto("/");

    await expect(page.getByText(/Labsheet columns changed/)).toBeVisible();
    await expect(page.getByText(/A\. Materials Manager → Quantity Left/)).toBeVisible();
  });

  test("UI-007 | a matching schema raises no banner || RCA: a warning that shows when nothing is wrong gets ignored, and then it is worthless when something is.", async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();
    await expect(page.getByText(/Labsheet columns changed/)).toBeHidden();
  });

  test("UI-008 | the schema check covers the catalogue and the inventory sheet || RCA: a sheet left out of the check can be renamed or archived with no warning at all; the user meets it as a dead button later.", async ({ page }) => {
    await installScispot(page);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();

    const checked = (await calls(page)).schema.map((c) => c.sheet);
    expect(checked).toContain(SHEETS.items);
    expect(checked).toContain(SHEETS.inventory);
  });
});
