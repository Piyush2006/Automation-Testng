/**
 * The client demo, recorded as video.
 *
 * Four acts, one continuous recording:
 *   1. the custody graph working        — what the suite exists to protect
 *   2. a Scispot column rename          — caught at load, not by a user
 *   3. a real pinned defect             — the suite documents bugs, it does not hide them
 *   4. the generated QA report          — all 191 checks, each with its root cause
 *
 * Nothing here is mocked for show: it drives the real app against the same
 * stand-in Scispot SDK the CI suite uses.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { SHEETS } from "../src/config";
import { CHEMICALS } from "../e2e/fixtures/data";
import { pick, openDropdown } from "../e2e/fixtures/actions";
import { installScispot } from "../e2e/fixtures/stub";

/** Bottom-third caption bar. pointer-events:none so clicks pass straight through. */
async function caption(page: import("@playwright/test").Page, act: string, line: string, hold = 2400) {
  await page.evaluate(
    ({ act, line }) => {
      const ID = "__demo_caption__";
      let bar = document.getElementById(ID);
      if (!bar) {
        bar = document.createElement("div");
        bar.id = ID;
        bar.style.cssText = [
          "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483647",
          "pointer-events:none", "padding:20px 32px 24px",
          "background:linear-gradient(to top, rgba(8,11,20,0.97) 55%, rgba(8,11,20,0))",
          "font-family:ui-sans-serif,-apple-system,'Segoe UI',sans-serif",
          "transition:opacity .25s ease",
        ].join(";");
        const eyebrow = document.createElement("div");
        eyebrow.id = ID + "_act";
        eyebrow.style.cssText = "color:#5eead4;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px";
        const body = document.createElement("div");
        body.id = ID + "_line";
        body.style.cssText = "color:#f8fafc;font-size:21px;font-weight:500;line-height:1.4;max-width:1000px";
        bar.append(eyebrow, body);
        document.body.appendChild(bar);
      }
      document.getElementById(ID + "_act")!.textContent = act;
      document.getElementById(ID + "_line")!.textContent = line;
    },
    { act, line },
  );
  await page.waitForTimeout(hold);
}

/** Deck-ready still, saved alongside the video. */
async function shot(page: import("@playwright/test").Page, name: string) {
  await page.screenshot({ path: `demo-output/stills/${name}.png` });
}

test("Chemical Chain of Custody — automated regression guardrail", async ({ page }) => {
  // ───────────────────────── ACT 1 — the product ─────────────────────────
  await installScispot(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();

  await caption(page, "Act 1 of 4 — the product",
    "A chain-of-custody view over Scispot labsheets: every lot of a chemical, who supplied it, and how much is left.", 3200);

  await openDropdown(page);
  await caption(page, "Act 1 — search",
    "Chemists search by name, by synonym, or by item ID. 2-Mercaptoethanol is also known as BME.", 2600);

  await page.getByRole("combobox").fill("BME");
  await caption(page, "Act 1 — synonym search",
    "Typing the synonym 'BME' finds it. The Note column is indexed, not just the catalogue name.", 2800);
  await shot(page, "01-synonym-search");

  await page.getByRole("combobox").fill("");
  await page.keyboard.press("Escape");
  await pick(page, CHEMICALS.mercaptoethanol);

  await caption(page, "Act 1 — the custody graph",
    "Two lots on the shelf. 10 mL left in one, 50 mL in the other.", 3000);
  await expect(page.getByRole("button", { name: /Inventory item/ })).toContainText("60 mL");

  await caption(page, "Act 1 — the number that matters",
    "60 mL total, and the app shows its working: 10 mL + 50 mL. An unexplained total is how people reorder stock they already have.", 3600);

  await caption(page, "Act 1 — provenance",
    "Each lot carries its supplier as its own node: Sigma-Aldrich and Thermo Fisher. That is the custody chain.", 3200);
  await shot(page, "02-custody-graph");

  await page.getByRole("button", { name: /M22-114/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await caption(page, "Act 1 — the audit record",
    "Lot M22-114: expiry, cold-room location, supplier, amount remaining. One click back to the Scispot row it came from.", 3800);
  await shot(page, "03-lot-audit-record");

  await page.locator('aside button[aria-label="Close details"]').click();

  // ──────────────── ACT 2 — the dependency nobody controls ────────────────
  await caption(page, "Act 2 of 4 — the risk",
    "This app reads 15 named columns out of Scispot. Any lab admin can rename one, and nobody tells the engineering team.", 4000);

  await installScispot(page, {
    renameColumn: { sheet: SHEETS.items, from: "Item Name", to: "Chemical Name" },
  });
  await page.goto("/");

  await expect(page.getByText(/Labsheet columns changed/)).toBeVisible();
  await caption(page, "Act 2 — drift caught at load",
    "'Item Name' was just renamed in Scispot. The app checks its schema on every load and names the exact column that moved.", 4200);
  await shot(page, "04-schema-drift-banner");

  await caption(page, "Act 2 — the alternative",
    "Without that check the field silently reads empty, and a chemist trusts a screen that is confidently wrong.", 3800);

  // ─────────────── ACT 3 — a defect the suite refuses to hide ───────────────
  await installScispot(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();
  await pick(page, CHEMICALS.salt);

  await caption(page, "Act 3 of 4 — honest totals",
    "Sodium Chloride: two weighed lots, and a third row where nobody recorded a Unit.", 4000);

  await expect(page.getByText(/Not counted \(no amount in Unit\): MAT12/)).toBeVisible();
  await caption(page, "Act 3 — what cannot be counted is named",
    "Lot MAT12 is called out by ID rather than dropped in silence. A total that quietly omits stock is worse than no total.", 4400);
  await shot(page, "05-unmeasured-lot-named");

  await caption(page, "Act 3 — and the defects we have not fixed yet",
    "Scispot also offers 'ng' and 'ug' as units, which this app still mis-types as counts. Two checks fail on purpose for it: GUARD-020 and LOGIC-015.", 4800);
  await shot(page, "06-defect-on-record");

  // ───────────────────── ACT 4 — the automation itself ─────────────────────
  await page.goto("file://" + resolve("reports/test-report.html"));
  await page.waitForTimeout(1200);

  await caption(page, "Act 4 of 4 — the guardrail",
    "191 automated checks: 142 logic and contract tests, 49 browser tests. 183 green, 8 red — and every red one is a defect we already have on the record.", 5000);
  await shot(page, "07-report-summary");

  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(600);
  await caption(page, "Act 4 — coverage by area",
    "Quantity maths, schema drift, paging, the custody graph, and every screen in the browser.", 4200);
  await shot(page, "08-report-areas");

  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(600);
  await caption(page, "Act 4 — root cause, not just red",
    "Each failure names its root cause and the file and line that owns it, so a red build is a work order rather than a mystery.", 4600);
  await shot(page, "09-report-rca");

  await caption(page, "The guarantee",
    "These run automatically on every commit. Nobody can add a feature that quietly breaks an existing one — the build refuses it before review, not after release.", 5200);
  await shot(page, "10-guarantee");
});
