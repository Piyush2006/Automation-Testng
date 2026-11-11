/**
 * Puts the stand-in SDK in front of the app, so the browser suite runs with no
 * Scispot token, no login and no network.
 *
 * The real app loads the SDK from eks.scispot.io in index.html. We answer that
 * request with e2e/fixtures/fake-sdk.js, so window.Scispot is defined in the
 * same place and at the same moment as in production.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { fixture, type Fixture } from "./data";

const FAKE_SDK = readFileSync("e2e/fixtures/fake-sdk.js", "utf8");

export async function installScispot(page: Page, over: Partial<Fixture> = {}): Promise<void> {
  await page.addInitScript((fx) => {
    (window as unknown as { __SCISPOT_FIXTURE__: unknown }).__SCISPOT_FIXTURE__ = fx;
  }, fixture(over) as unknown);

  await page.route("**/jazz-app-bff-v1.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FAKE_SDK }),
  );
  // The Jazz stylesheet is cosmetic; serving it empty keeps the run offline.
  await page.route("**/jazz-design-v1.css", (route) => route.fulfill({ contentType: "text/css", body: "" }));
}

/** Nothing opened the real SDK: the labsheet deep-links the app asked for. */
export async function openedLabsheets(page: Page): Promise<Array<{ uuid: string; newTab: boolean }>> {
  return page.evaluate(() => (window as unknown as { __OPENED__?: [] }).__OPENED__ ?? []);
}
