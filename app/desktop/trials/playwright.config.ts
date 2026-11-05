import { defineConfig } from "@playwright/test"

// Paid, opt-in trials. The default e2e configuration never discovers these.
export default defineConfig({
  testDir: ".",
  testMatch: "browser-real.spec.ts",
  timeout: 12 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "/tmp/banda-browser-step6-trial/playwright",
  use: { trace: "retain-on-failure" },
})
