/**
 * Browser suite. Runs the real app in Chromium against a stand-in Scispot SDK,
 * so it needs no token, no login and no network.
 *
 * Its own dev server on port 3099, so it never collides with yours on 3034.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/playwright", open: "never" }],
    ["json", { outputFile: "reports/playwright.json" }],
  ],
  use: {
    baseURL: "http://localhost:3099",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3099 --strictPort",
    url: "http://localhost:3099",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
  },
});
