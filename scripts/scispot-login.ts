/**
 * Opens Scispot in a real browser, sends the magic link, and waits while YOU
 * complete the OTP. Nothing secret is typed by the script and no password is
 * involved — the sign-in page offers a magic link, which is the whole point.
 *
 *   npm run scispot:login -- you@example.com
 *   SCISPOT_EMAIL=you@example.com npm run scispot:login
 *   npm run scispot:login -- you@example.com --workspace="Test Environment"
 *   npm run scispot:login -- you@example.com --dry-run   # fills, never sends
 *
 * After the OTP, Scispot asks which customer account to enter. The script
 * picks "Sandbox Customer" by default — the tenant the MCP server reads and
 * the one tests/deps/scispot-snapshot.json was captured from.
 *
 * On success it writes .auth/scispot.json (the signed-in session), then tries
 * to open the Jazz app itself. If it cannot find the way there it says so and
 * keeps watching, so opening the app by hand works just as well. Either way it
 * prints a ready-to-paste localhost URL once the app's iframe loads.
 *
 *   --app-url=<url>   go straight to the app's page, skipping the menu hunt
 *
 * The browser profile persists under .auth/, so Scispot's device registration
 * is approved once instead of on every run.
 *
 * .auth/ is git-ignored. The profile, the session and the token are all
 * credentials: they act as you, with your permissions, and every call is
 * audit-logged.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Frame, type Page } from "@playwright/test";

const SIGNIN = "https://labsheets.scispot.io/signin";
const STATE_PATH = ".auth/scispot.json";
/**
 * A persistent browser profile, so Scispot's device registration is approved
 * once rather than on every run. A fresh profile looks like a new device.
 *
 * One directory per browser channel: a profile written by Chrome and one
 * written by Chromium are not interchangeable.
 */
const profileDir = (channel: string) => `.auth/${channel}-profile`;
const OTP_TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const email = (args.find((a) => !a.startsWith("--")) ?? process.env.SCISPOT_EMAIL ?? "").trim();
const APP_NAME = "Chemical Chain of Custody";
const APP_URL_FLAG = "--app-url=";
const appUrl = (
  args.find((a) => a.startsWith(APP_URL_FLAG))?.slice(APP_URL_FLAG.length) ??
  process.env.SCISPOT_APP_URL ??
  ""
).trim();
/** Real Google Chrome by default; `--chromium` uses Playwright's bundled build. */
const useChromium = args.includes("--chromium");
const WORKSPACE_FLAG = "--workspace=";
const workspace = (
  args.find((a) => a.startsWith(WORKSPACE_FLAG))?.slice(WORKSPACE_FLAG.length) ??
  process.env.SCISPOT_WORKSPACE ??
  "Sandbox Customer"
).trim();

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

if (!email) {
  console.error(`
${b("Which account?")}

  npm run scispot:login -- you@example.com
  SCISPOT_EMAIL=you@example.com npm run scispot:login

The email is never stored in the repo. Pass it each time, or export it.
`);
  process.exit(1);
}

/** A Jazz app is embedded with its session token in the iframe URL. */
function tokenFrom(url: string): string | null {
  try {
    const parsed = new URL(url);
    const direct = parsed.searchParams.get("token") ?? parsed.searchParams.get("sas_token");
    if (direct) return direct;
    const at = parsed.hash.indexOf("?");
    if (at < 0) return null;
    return new URLSearchParams(parsed.hash.slice(at + 1)).get("token");
  } catch {
    return null;
  }
}

let reported = "";
function reportToken(url: string, pageUrl = "") {
  const token = tokenFrom(url);
  if (!token || token === reported) return;
  reported = token;
  if (pageUrl) console.log(`\n${dim(`app page: ${pageUrl}`)}\n${dim("reuse it next time with --app-url=<that url>")}`);
  console.log(`
${green(b("Jazz session token captured."))}

${b("Open your local build against real Scispot data:")}

  http://localhost:3034/?token=${token}

${dim("Add &q=sodium to pre-fill the search, or &jazzDebug=1 for SDK logging.")}
${yellow("This token acts as you. Do not paste it anywhere shared; it expires.")}
`);
}

/**
 * After the OTP, Scispot shows a "Scispot Signin" modal with a customer
 * account dropdown. It is not a native <select>, so this opens the control,
 * clicks the option by name, and confirms.
 */
async function chooseWorkspace(page: Page, name: string): Promise<void> {
  const placeholder = page.locator(".select__placeholder, #react-select-signin-customer-account-placeholder").first();
  try {
    await placeholder.waitFor({ state: "visible", timeout: OTP_TIMEOUT_MS });
  } catch {
    if (page.isClosed()) throw new Error("The browser window was closed before sign-in finished.");
    console.log(`  ${dim("no workspace picker appeared — already chosen, carrying on")}`);
    return;
  }
  console.log(`  ${green("✓")} OTP accepted — workspace picker is up`);

  // It is a react-select. The placeholder is not the click target: an input
  // container is layered over it and swallows the click. Open the control.
  await page.locator(".select__control").first().click();

  const option = page.locator(".select__option").filter({ hasText: name }).first();
  try {
    await option.waitFor({ state: "visible", timeout: 10_000 });
    await option.click();
  } catch {
    // Fall back to react-select's own input: type the name and commit it.
    const input = page.locator("#react-select-signin-customer-account-input, .select__input-container input").first();
    await input.fill(name);
    await input.press("Enter");
  }

  const confirm = page.getByRole("button", { name: /^\s*select\s*$/i });
  await confirm.waitFor({ state: "visible", timeout: 20_000 });
  await confirm.click();
  console.log(`  ${green("✓")} entered "${name}"`);
}

/**
 * Walk to the Jazz app. Best effort: the menu is Scispot's and may move, so a
 * miss is reported rather than thrown — the token watcher still catches the
 * iframe if you navigate there yourself.
 */
async function openJazzApp(page: Page): Promise<void> {
  if (appUrl) {
    console.log(`  ${dim(`going straight to ${appUrl}`)}`);
    await page.goto(appUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    return;
  }

  const jazz = page.getByRole("link", { name: /jazz/i }).or(page.getByRole("button", { name: /jazz/i })).first();
  try {
    await jazz.waitFor({ state: "visible", timeout: 15_000 });
    await jazz.click();
    console.log(`  ${green("✓")} opened the Jazz menu`);
  } catch {
    console.log(`  ${yellow("•")} could not find the Jazz menu — open it yourself, I am still watching`);
    return;
  }

  const app = page.getByText(APP_NAME, { exact: false }).first();
  try {
    await app.waitFor({ state: "visible", timeout: 15_000 });
    await app.click();
    console.log(`  ${green("✓")} opened "${APP_NAME}"`);
  } catch {
    console.log(`  ${yellow("•")} "${APP_NAME}" not visible in the Jazz list — open it yourself`);
  }
}

function watch(page: Page) {
  const check = (f: Frame) => reportToken(f.url(), page.url());
  page.on("frameattached", check);
  page.on("framenavigated", check);
}

async function main() {
  console.log(
    `\n${b("Scispot sign-in")}  ${dim(SIGNIN)}\n  account:   ${email}\n  workspace: ${workspace}${dryRun ? dim("  (dry run)") : ""}\n`,
  );

  const launch = async (channel: "chrome" | "chromium") => {
    const dir = profileDir(channel);
    mkdirSync(dir, { recursive: true });
    return chromium.launchPersistentContext(dir, {
      ...(channel === "chrome" ? { channel: "chrome" as const } : {}),
      headless: dryRun,
      slowMo: dryRun ? 0 : 120,
      viewport: { width: 1280, height: 900 },
      // Playwright opens a second browser instance with its own profile, and
      // macOS does not give it focus. Park it top-left so it is easy to spot.
      args: dryRun ? [] : ["--window-position=40,40", "--window-size=1320,960"],
    });
  };

  let context;
  if (useChromium) {
    context = await launch("chromium");
    console.log(`  ${dim("browser: Chromium (bundled)")}`);
  } else {
    try {
      context = await launch("chrome");
      console.log(`  ${dim("browser: Google Chrome")}`);
    } catch {
      console.log(`  ${yellow("•")} Google Chrome not found — falling back to bundled Chromium`);
      context = await launch("chromium");
    }
  }
  const page = context.pages()[0] ?? (await context.newPage());
  watch(page);
  context.on("page", watch);

  await page.goto(SIGNIN, { waitUntil: "domcontentloaded" });
  if (!dryRun) {
    await page.bringToFront().catch(() => undefined);
    console.log(`
  ${b("Look for a NEW browser window, top-left of your screen.")}
  ${dim("It is a separate instance with its own profile — not your usual tabs.")}
  ${dim("Hidden? Cmd+` cycles between windows of the same app, or use the Window menu.")}
`);
  }

  const field = page.getByPlaceholder("Enter your email here");
  const submit = page.getByRole("button", { name: /magic link to login/i });
  await field.waitFor({ state: "visible", timeout: 30_000 });
  await field.fill(email);
  console.log(`  ${green("✓")} email field found and filled`);
  console.log(`  ${green("✓")} "${(await submit.textContent())?.trim()}" button found`);

  if (dryRun) {
    console.log(`\n${yellow("Dry run — no magic link was sent.")} Selectors are good.\n`);
    await context.close();
    return;
  }

  await submit.click();
  console.log(`
  ${green("✓")} magic link requested

${b("Over to you, in the browser window:")}
  1. open the email from Scispot and follow it, or type the OTP on screen
  2. the script takes it from there and enters ${b(workspace)}

${dim("Nothing secret is typed for you. Waiting up to 10 minutes; close the window to cancel.")}
`);

  await chooseWorkspace(page, workspace);
  await page
    .waitForURL((url) => !url.pathname.includes("signin"), { timeout: 2 * 60 * 1000 })
    .catch((e: unknown) => {
      if (page.isClosed()) throw new Error("The browser window was closed before sign-in finished.");
      throw e;
    });
  console.log(`  ${green("✓")} signed in — ${page.url()}`);

  mkdirSync(".auth", { recursive: true });
  const state = await context.storageState();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`  ${green("✓")} session saved to ${STATE_PATH} ${dim("(git-ignored)")}`);

  await openJazzApp(page);

  console.log(`
${b("Watching for the app's iframe.")}
If it did not open by itself, go to the Jazz menu and open "${APP_NAME}".
The token is printed the moment that iframe loads.

${dim("Press Ctrl-C when you are done. The browser stays open until you do.")}
`);

  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    context.on("close", resolve);
  });
  await context.close().catch(() => undefined);
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`\n\x1b[31m${message}\x1b[0m`);
  if (/closed/i.test(message)) {
    console.error(`${dim("Run it again and leave the window open until the token is printed.")}`);
    console.error(`${dim("If Chrome is awkward on this machine, add --chromium to use the bundled browser.")}`);
  }
  console.error("");
  process.exit(1);
});
