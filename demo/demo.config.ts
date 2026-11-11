/**
 * Recording config for the client demo. Separate from playwright.config.ts so
 * the CI suite stays fast and headless while this one runs slowly and records.
 *
 *   npm run demo:video      -> writes demo-output/<name>/video.webm
 *
 * Its own dev server on port 3098, so it collides with neither the e2e suite
 * (3099) nor your own (3034).
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../demo-output",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3098",
    // Tall enough that the app's content clears the caption bar at the bottom.
    viewport: { width: 1280, height: 920 },
    video: { mode: "on", size: { width: 1280, height: 920 } },
    // Slow every action down so a human can follow the recording.
    launchOptions: { slowMo: 450 },
  },
  webServer: {
    command: "npm run dev -- --port 3098 --strictPort",
    cwd: "..",
    url: "http://localhost:3098",
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
  },
});
