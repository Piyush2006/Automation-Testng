import { expect, type Page } from "@playwright/test";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Open the dropdown, type, and click the chemical.
 * Anchored on the start of the name: "Ethanol" is also a substring of
 * "2-Mercaptoethanol", so a loose match picks the wrong row.
 */
export async function pick(page: Page, name: string): Promise<void> {
  await openDropdown(page);
  await page.getByRole("combobox").fill(name);
  const option = page
    .getByRole("option")
    .filter({ hasText: new RegExp(`^${escapeRe(name)}`) })
    .first();
  await expect(option).toBeVisible();
  await option.click();
}

export async function openDropdown(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /Search for a chemical/ });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByRole("combobox")).toBeVisible();
}

/** Requests the app made through the SDK, as the stand-in recorded them. */
export async function calls(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __CALLS__?: {
            list: unknown[];
            schema: Array<{ sheet: string }>;
            rows: Array<{ sheet: string; page: number; pageSize: number }>;
            search: Array<{ sheet: string; filters: Array<{ column: string; operator: string; value: string }>; match: string; page: number }>;
          };
        }
      ).__CALLS__ ?? { list: [], schema: [], rows: [], search: [] },
  );
}
