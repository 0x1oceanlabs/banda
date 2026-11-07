import { defineConfig } from "@playwright/test"

// The window runs one at a time: each test starts the app and its engine.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  // CI's shards split the tests one by one, not file by file: window.spec.ts
  // alone holds half of them. Each test starts and closes its own window,
  // so none needs another to have run first.
  fullyParallel: true,
  // In CI a test that fails runs once more; the report still names it.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: { trace: "retain-on-failure" },
})
