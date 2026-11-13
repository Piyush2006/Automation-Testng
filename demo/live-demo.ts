/**
 * The actual demo: logs into REAL Scispot, opens the real app, drives it
 * against live data. Nothing is recorded — this is meant to be watched live.
 *
 *   npm run demo:live -- you@example.com
 *   npm run demo:live -- you@example.com --workspace="Sandbox Customer"
 *   npm run demo:live -- you@example.com --app-url=<the app's Scispot page>
 *   npm run demo:live -- you@example.com --chemicals="Reagent A,Reagent B"
 *
 * Default chemicals cover the fixture demo's scenarios with THIS tenant's
 * real catalogue: a multi-lot reconcile, a catalogue item with zero lots,
 * and a plain single-lot item. Findings are written to demo/live-findings.json.
 *
 * Scispot sign-in is passwordless: it emails a magic link / OTP. No script can
 * complete that step for you — it fills the email, requests the link, then
 * waits (printing what to do) until you finish it in the browser window that
 * pops up. Everything before and after that is automatic.
 *
 * This does not touch the regression suite. That's `npm run test:gate` —
 * run it in another terminal to show the two halves side by side: the real
 * app on live data here, the guardrail that protects it there.
 */
import { writeFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const SIGNIN = "https://labsheets.scispot.io/signin";
const APP_NAME = "Chemical Chain of Custody";
const SIZE = { width: 1280, height: 920 };
const OTP_TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") =>
  (args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback).trim();

const email = (args.find((a) => !a.startsWith("--")) ?? process.env.SCISPOT_EMAIL ?? "").trim();
const workspace = flag("workspace", process.env.SCISPOT_WORKSPACE || "Sandbox Customer");
const appUrl = flag("app-url", process.env.SCISPOT_APP_URL || "");
const useChromium = args.includes("--chromium");

/** Real catalogue entries from this tenant's "List of Inventory Items" (via the MCP
 * server), chosen to cover the scenarios the fixture demo showed: multi-lot reconcile,
 * a catalogue item with zero lots, and a plain single-lot item. */
const DEFAULT_CHEMICALS = ["Reagent A", "Reagent B", "Trypsin-EDTA. 0.25%.", "Na₂CO₃"];
const chemicalsFlag = flag("chemicals") || flag("chemical");
const chemicals = chemicalsFlag ? chemicalsFlag.split(",").map((c) => c.trim()).filter(Boolean) : DEFAULT_CHEMICALS;

type Finding = {
  chemical: string;
  foundInCatalogue: boolean;
  selected: boolean;
  resultText: string;
  /** Each lot card's own text, read individually — not sliced out of one flattened blob, which is easy to mis-attribute. */
  lots: string[];
};
const findings: Finding[] = [];
/** Written after every chemical, not just at the end, so a later crash doesn't lose earlier results. */
function saveFindings() {
  writeFileSync("demo/live-findings.json", JSON.stringify({ capturedAt: new Date().toISOString(), workspace, findings }, null, 2));
}

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

if (!email) {
  console.error(`\n${b("Which account?")}\n\n  npm run demo:live -- you@example.com\n`);
  process.exit(1);
}

/** The post-OTP "which customer account" modal. Not a native <select>. */
async function chooseWorkspace(page: Page, name: string) {
  const placeholder = page
    .locator(".select__placeholder, #react-select-signin-customer-account-placeholder")
    .first();
  try {
    await placeholder.waitFor({ state: "visible", timeout: OTP_TIMEOUT_MS });
  } catch {
    if (page.isClosed()) throw new Error("The browser window was closed before sign-in finished.");
    console.log(`  ${dim("no workspace picker appeared — already chosen, carrying on")}`);
    return;
  }
  console.log(`  ${green("✓")} OTP accepted — choosing "${name}"`);

  await page.locator(".select__control").first().click();
  const option = page.locator(".select__option").filter({ hasText: name }).first();
  try {
    await option.waitFor({ state: "visible", timeout: 10_000 });
    await option.click();
  } catch {
    const input = page
      .locator("#react-select-signin-customer-account-input, .select__input-container input")
      .first();
    await input.fill(name);
    await input.press("Enter");
  }
  const confirm = page.getByRole("button", { name: /^\s*select\s*$/i });
  await confirm.waitFor({ state: "visible", timeout: 20_000 });
  await confirm.click();
}

/** Walk to the Jazz app, unless --app-url was given. */
async function openJazzApp(page: Page) {
  if (appUrl) {
    console.log(`  ${dim(`going straight to ${appUrl}`)}`);
    await page.goto(appUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    return;
  }
  const jazz = page
    .getByRole("link", { name: /jazz/i })
    .or(page.getByRole("button", { name: /jazz/i }))
    .first();
  try {
    await jazz.waitFor({ state: "visible", timeout: 20_000 });
    await jazz.click();
    console.log(`  ${green("✓")} opened the Jazz menu`);
  } catch {
    console.log(`  ${yellow("•")} could not find the Jazz menu — open "${APP_NAME}" yourself, I am still watching`);
    return;
  }
  const app = page.getByText(APP_NAME, { exact: false }).first();
  try {
    await app.waitFor({ state: "visible", timeout: 20_000 });
    await app.click();
    console.log(`  ${green("✓")} opened "${APP_NAME}"`);
  } catch {
    console.log(`  ${yellow("•")} "${APP_NAME}" not visible in the Jazz list — open it yourself`);
  }
}

/** Never log a full URL: Scispot embeds a live session token in the query string. */
const redact = (url: string) => url.split("?")[0] + (url.includes("?") ? "?[redacted]" : "");

/**
 * The page hosts more than one iframe — Magic Link keeps its own hidden
 * auth.magic.link/send/idle iframe alive for session refresh — so "any
 * non-main frame" is not enough. The real app is hosted on its own S3
 * bucket, always containing "smartapp" in the URL. Exclude magic.link and
 * require that marker so the right one is picked even if more iframes exist.
 */
const isAppFrame = (url: string) => !url.includes("magic.link") && (url.includes("smartapp") || url.includes("amazonaws.com"));

/** Drive the app where it really lives: inside Scispot's iframe. */
async function driveApp(page: Page) {
  // The iframe is injected by the shell's own JS after it loads, so find the
  // frame object directly rather than trust frameLocator to catch it in time.
  console.log(`  ${dim("waiting for the app's iframe to attach…")}`);
  const attachDeadline = Date.now() + 30_000;
  let childUrl = page.frames().find((f) => isAppFrame(f.url()))?.url();
  while (!childUrl && Date.now() < attachDeadline) {
    await page.waitForTimeout(500);
    childUrl = page.frames().find((f) => isAppFrame(f.url()))?.url();
  }
  if (!childUrl) {
    const seen = page.frames().map((f) => redact(f.url()));
    console.log(`  ${yellow("•")} no app iframe attached in 30s — open it by hand`);
    console.log(`  ${dim(`frames seen: ${seen.join(", ") || "(none)"}`)}`);
    return;
  }
  console.log(`  ${green("✓")} iframe attached: ${redact(childUrl)}`);

  const frame = page.frameLocator('iframe[src*="smartapp"], iframe[src*="amazonaws.com"]').last();
  // Once a chemical is selected, the trigger's visible text becomes that
  // chemical's name instead of "Search for a chemical" (ChemicalSearch.tsx:171),
  // so match it by its stable aria-haspopup attribute, not by changing text.
  const trigger = frame.locator('button[aria-haspopup="listbox"]');

  try {
    await trigger.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    // The selector guess was wrong. Dump what's actually there instead of
    // failing blind, so the next run can be fixed from real data.
    console.log(`  ${yellow("•")} expected search control not found — here is what IS in the frame:\n`);
    const hits = await frame
      .locator("button, input, [role], [class*='search' i], [class*='combo' i]")
      .evaluateAll((els) =>
        els
          .slice(0, 40)
          .map(
            (el) =>
              `${el.tagName.toLowerCase()} role=${el.getAttribute("role")} aria-label=${el.getAttribute("aria-label")} class="${(el.className + "").slice(0, 50)}" text="${(el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 70)}"`,
          ),
      )
      .catch((e: unknown) => [`  (could not inspect: ${e instanceof Error ? e.message : String(e)})`]);
    hits.forEach((h) => console.log("    " + h));
    return;
  }
  console.log(`  ${green("✓")} the app is live inside Scispot — this is real tenant data now`);

  for (const chemical of chemicals) {
    console.log(`\n  ${b(chemical)}`);
    const clear = frame.getByRole("button", { name: /Clear selected chemical/ });
    if (await clear.isVisible().catch(() => false)) await clear.click();
    await trigger.click();
    const box = frame.getByRole("combobox");
    await box.fill(chemical);
    // Real Scispot API calls, not the instant fixture SDK — give the debounced
    // search (220ms) real network round-trip time before checking for a result.
    await page.waitForTimeout(2500);

    const option = frame.getByRole("option").filter({ hasText: chemical }).first();
    let found = await option.isVisible().catch(() => false);
    if (!found) {
      // One retry with a longer wait before calling it a miss — a slow first
      // request on a cold connection is not the same thing as "not in the catalogue".
      await page.waitForTimeout(3000);
      found = await option.isVisible().catch(() => false);
    }
    if (!found) {
      console.log(`    ${yellow("•")} not found in the catalogue search`);
      findings.push({ chemical, foundInCatalogue: false, selected: false, resultText: "", lots: [] });
      await box.fill("");
      await page.keyboard.press("Escape").catch(() => undefined);
      saveFindings();
      continue;
    }
    await option.click();
    await page.waitForTimeout(2000);

    const resultText = await frame
      .locator("body")
      .innerText()
      .then((t) => t.replace(/\s+/g, " ").trim())
      .catch(() => "(could not read the page)");

    // Each lot's own text, read individually, so a reconcile total can be
    // checked against the SPECIFIC lot it came from, not a flattened blob
    // where it is easy to misattribute which number belongs to which lot.
    const lotButtons = frame.getByRole("button", { name: /LOT/i });
    const lotCount = await lotButtons.count().catch(() => 0);
    const lots: string[] = [];
    for (let i = 0; i < lotCount; i++) {
      lots.push(
        await lotButtons
          .nth(i)
          .innerText()
          .then((t) => t.replace(/\s+/g, " ").trim())
          .catch(() => "(unreadable)"),
      );
    }

    console.log(`    ${green("✓")} selected — ${dim(resultText.slice(0, 160))}${resultText.length > 160 ? "…" : ""}`);
    lots.forEach((l, i) => console.log(`      lot[${i}]: ${dim(l)}`));
    findings.push({ chemical, foundInCatalogue: true, selected: true, resultText, lots });
    saveFindings();
  }
}

async function main() {
  console.log(`\n${b("Live demo — real Scispot, real data")}  ${dim(SIGNIN)}`);
  console.log(`  account:   ${email}\n  workspace: ${workspace}\n`);

  const launch = (channel: "chrome" | "chromium") =>
    chromium.launchPersistentContext(`.auth/${channel}-profile`, {
      ...(channel === "chrome" ? { channel: "chrome" as const } : {}),
      headless: false,
      slowMo: 150,
      viewport: SIZE,
      args: ["--window-position=40,40", "--window-size=1320,960"],
    });

  let context: BrowserContext;
  try {
    context = useChromium ? await launch("chromium") : await launch("chrome");
    console.log(`  ${dim(`browser: ${useChromium ? "Chromium (bundled)" : "Google Chrome"}`)}`);
  } catch {
    console.log(`  ${yellow("•")} Chrome unavailable — using bundled Chromium`);
    context = await launch("chromium");
  }

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
    await page.bringToFront().catch(() => undefined);
    console.log(`\n  ${b("Look for a NEW browser window, top-left of your screen.")}\n`);

    if (!page.url().includes("signin")) {
      console.log(`  ${green("✓")} existing session is still valid — skipping sign-in`);
    } else {
      const field = page.getByPlaceholder("Enter your email here");
      await field.waitFor({ state: "visible", timeout: 30_000 });
      await field.fill(email);
      await page.getByRole("button", { name: /magic link to login/i }).click();
      console.log(`
  ${green("✓")} magic link requested

${b("Over to you, in the browser window:")}
  1. open the email from Scispot and follow it, or type the OTP on screen
  2. this script takes it from there

${dim("Nothing secret is typed for you. Waiting up to 10 minutes.")}
`);

      await chooseWorkspace(page, workspace);
      await page
        .waitForURL((u) => !u.pathname.includes("signin"), { timeout: 2 * 60 * 1000 })
        .catch((e: unknown) => {
          if (page.isClosed()) throw new Error("The browser window was closed before sign-in finished.");
          throw e;
        });
      console.log(`  ${green("✓")} signed in`);
    }

    await openJazzApp(page);
    await driveApp(page);

    if (findings.length) {
      console.log(`\n  ${green("✓")} wrote demo/live-findings.json (${findings.length} chemical${findings.length === 1 ? "" : "s"})`);
    }

    console.log(`
${b("That's the live half.")} To show the guardrail that protects it, in another
terminal run:

  ${b("npm run test:gate")}        the regression gate, against this same code
  ${b("npm run demo:guard")}       a live break-and-catch, narrated

${dim("Press Ctrl-C here when you're done. The browser stays open until you do.")}
`);

    await new Promise<void>((resolve) => {
      process.on("SIGINT", resolve);
      context.on("close", resolve);
    });
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`\n\x1b[31m${message}\x1b[0m`);
  if (/closed/i.test(message)) {
    console.error(`${dim("Run it again and leave the window open until signed in.")}`);
  }
  console.error("");
  process.exit(1);
});
