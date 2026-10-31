import { defineConfig } from "@playwright/test"

// The window runs one at a time: each test starts the app and its engine.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: { trace: "retain-on-failure" },
})
