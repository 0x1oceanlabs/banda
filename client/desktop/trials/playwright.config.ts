import { defineConfig } from "@playwright/test"

// Paid, opt-in trials. The default e2e configuration never discovers these.
export default defineConfig({
  testDir: ".",
  testMatch: "browser-real.spec.ts",
  // It starts the engine from target/debug, once built from this checkout;
  // unasked, it skips, and so does the check.
  globalSetup:
    process.env.BANDA_REAL_BROWSER_TRIAL === "1"
      ? "../../../sdk/contract/test/built.ts"
      : undefined,
  timeout: 12 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "/tmp/banda-browser-step6-trial/playwright",
  use: { trace: "retain-on-failure" },
})
