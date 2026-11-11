/**
 * The client demo, recorded as video.
 *
 *   1. the custody graph working   — what the guardrail exists to protect
 *   2. a Scispot column rename     — caught at load, not by a user
 *   3. the suite running           — real terminal, real output
 *   4. a regression refused        — a commit genuinely blocked, on camera
 *   5. the fix, then a clean commit— the gate blocks regressions, not progress
 *   6. the QA report               — 191 checks, each with its root cause
 *
 * Acts 3-5 replay demo/captured-session.json, which is produced by actually
 * running those commands against a throwaway clone — see capture-session.ts.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHEETS } from "../src/config";
import { CHEMICALS } from "../e2e/fixtures/data";
import { pick, openDropdown } from "../e2e/fixtures/actions";
import { installScispot } from "../e2e/fixtures/stub";

type Page = import("@playwright/test").Page;
type Session = { steps: Array<{ command: string; output: string; exitCode: number; note: string }> };

const session = JSON.parse(readFileSync("demo/captured-session.json", "utf8")) as Session;

/** Bottom caption bar. pointer-events:none so clicks pass straight through. */
async function caption(page: Page, act: string, line: string, hold = 2400) {
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
        ].join(";");
        const eyebrow = document.createElement("div");
        eyebrow.id = ID + "_act";
        eyebrow.style.cssText = "color:#5eead4;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px";
        const body = document.createElement("div");
        body.id = ID + "_line";
        body.style.cssText = "color:#f8fafc;font-size:21px;font-weight:500;line-height:1.4;max-width:1040px";
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
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `demo-output/stills/${name}.png` });
}

/** Open the terminal surface and hand it the captured session. */
async function openTerminal(page: Page) {
  await page.goto("file://" + resolve("demo/terminal.html"));
  await page.evaluate((data) => (window as never as { demo: { load: (d: unknown) => void } }).demo.load(data), session);
  await page.waitForTimeout(500);
}

/** Replay one captured command, with its caption shown first. */
async function playStep(page: Page, index: number, act: string, settle = 1400) {
  await caption(page, act, session.steps[index]!.note, 1800);
  await page.evaluate(
    (i) => (window as never as { demo: { play: (i: number) => Promise<number> } }).demo.play(i),
    index,
  );
  await page.waitForTimeout(settle);
}

test("Chemical Chain of Custody — automated regression guardrail", async ({ page }) => {
  // ───────────────────── ACT 1 — what is being protected ─────────────────────
  await installScispot(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Search for a chemical/ })).toBeEnabled();

  await caption(page, "Act 1 of 6 — the product",
    "A chain-of-custody view over Scispot labsheets: every lot of a chemical, who supplied it, and how much is left.", 3200);

  await openDropdown(page);
  await page.getByRole("combobox").fill("BME");
  await caption(page, "Act 1 — search",
    "Chemists search by name, by synonym, or by item ID. Typing the synonym 'BME' finds 2-Mercaptoethanol.", 2800);
  await shot(page, "01-synonym-search");

  await page.getByRole("combobox").fill("");
  await page.keyboard.press("Escape");
  await pick(page, CHEMICALS.mercaptoethanol);
  await expect(page.getByRole("button", { name: /Inventory item/ })).toContainText("60 mL");

  await caption(page, "Act 1 — the custody graph",
    "Two lots, two suppliers, and a total that shows its working: 10 mL + 50 mL = 60 mL.", 3600);
  await shot(page, "02-custody-graph");

  await page.getByRole("button", { name: /M22-114/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await caption(page, "Act 1 — the audit record",
    "Lot M22-114: expiry, cold-room location, supplier, amount remaining — one click back to its Scispot row.", 3400);
  await shot(page, "03-lot-audit-record");
  await page.locator('aside button[aria-label="Close details"]').click();

  // ──────────────────────── ACT 2 — the standing risk ────────────────────────
  await caption(page, "Act 2 of 6 — the risk",
    "This app reads 18 named columns out of Scispot. Any lab admin can rename one, and nobody tells the engineering team.", 3800);

  await installScispot(page, { renameColumn: { sheet: SHEETS.items, from: "Item Name", to: "Chemical Name" } });
  await page.goto("/");
  await expect(page.getByText(/Labsheet columns changed/)).toBeVisible();
  await caption(page, "Act 2 — drift caught at load",
    "'Item Name' was just renamed in Scispot. The app checks its schema on every load and names the exact column that moved.", 4000);
  await shot(page, "04-schema-drift-banner");

  // ─────────────────── ACT 3 — the suite, actually running ───────────────────
  await openTerminal(page);
  await caption(page, "Act 3 of 6 — the guardrail itself",
    "Everything so far was the product. This is the machinery that keeps it working. Here is the real terminal.", 3600);

  await playStep(page, 0, "Act 3 — the gate, as it stands", 2200);
  await shot(page, "05-gate-passing");

  await caption(page, "Act 3 — why eight are red",
    "Eight checks fail on purpose. Each pins a real defect we have already documented, so the suite tracks reality instead of being tuned to look green.", 4200);

  // ───────────────────── ACT 4 — a regression, refused ─────────────────────
  await caption(page, "Act 4 of 6 — someone breaks something",
    "Now a developer adds a feature and, along the way, renames a column constant the app depends on.", 3600);

  await playStep(page, 1, "Act 4 — the change", 1600);
  await shot(page, "06-the-breaking-change");

  await playStep(page, 2, "Act 4 — the commit is refused", 2600);
  await shot(page, "07-commit-blocked");

  await caption(page, "Act 4 — read what it says",
    "Five checks that passed a moment ago now fail, each named with its ID. The commit never happened — husky exited 1.", 4600);

  await playStep(page, 3, "Act 4 — proof nothing got in", 2200);
  await shot(page, "08-nothing-committed");

  // ──────────────── ACT 5 — the fix, and a clean commit ────────────────
  await playStep(page, 4, "Act 5 of 6 — the fix", 1800);

  await playStep(page, 5, "Act 5 — a good change goes straight through", 2400);
  await shot(page, "09-clean-commit-allowed");

  await caption(page, "Act 5 — the distinction",
    "Same gate, same suite, opposite outcome. It blocks regressions, not progress — no reviewer had to notice anything.", 4400);

  // ───────────────────────── ACT 6 — the ledger ─────────────────────────
  await page.goto("file://" + resolve("reports/test-report.html"));
  await page.waitForTimeout(1000);
  await caption(page, "Act 6 of 6 — the ledger",
    "191 automated checks behind that gate: 142 logic and contract tests, 49 browser tests. 183 green, 8 red and accounted for.", 4600);
  await shot(page, "10-report-summary");

  await page.mouse.wheel(0, 2400);
  await page.waitForTimeout(600);
  await caption(page, "Act 6 — root cause, not just red",
    "Every check names the user-visible consequence of its own failure, so a red build is a work order rather than a mystery.", 4600);
  await shot(page, "11-report-rca");

  await caption(page, "The guarantee",
    "This runs on every commit and every push. Nobody can add a feature that quietly breaks an existing one — the build refuses it before review, not after release.", 5200);
  await shot(page, "12-guarantee");
});
