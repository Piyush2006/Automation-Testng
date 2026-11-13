import { defineConfig } from "@playwright/test";

/**
 * Live run against the real Scispot tenant, using the session saved by
 * `npm run scispot:login`. READ-ONLY: searches, views and opens. Never writes.
 * Kept out of the default suite on purpose — it needs a session and real data.
 */
export default defineConfig({
  testDir: "./e2e-live",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  // WORKERS sets the parallelism. Each worker signs in and discovers its own
  // chemical, so the suite is safe above 1.
  workers: Number(process.env.WORKERS ?? 2),
  reporter: [["list"], ["json", { outputFile: "reports/live.json" }]],
  use: {
    storageState: ".auth/scispot.json",
    viewport: { width: 1440, height: 960 },
    // Tracing is OFF on purpose. Saving a trace tears the browser context down
    // after a failed test, which closes the page this suite shares and makes the
    // next tests fail for no reason. TRACE=1 turns it back on when debugging one test.
    trace: process.env.TRACE === "1" ? "retain-on-failure" : "off",
    // Real Chrome, not the bundled Chromium. CHANNEL=chromium falls back if Chrome is absent.
    channel: (process.env.CHANNEL ?? "chrome") as "chrome" | "chromium",
    // HEADED=1 opens a real window and slows the actions down so a person can follow them.
    headless: process.env.HEADED !== "1",
    launchOptions: {
      slowMo: process.env.HEADED === "1" ? Number(process.env.SLOWMO ?? 350) : 0,
      args: process.env.HEADED === "1" ? ["--window-position=30,30", "--window-size=1480,1000"] : [],
    },
  },
});
