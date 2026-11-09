import { defineConfig } from "@playwright/test"

// The window runs one at a time: each test starts the app and its engine.
export default defineConfig({
  testDir: "e2e",
  // Each test starts the engine and the fake agent from target/debug: none
  // runs unless both were built from this checkout's sources.
  globalSetup: "../../sdk/contract/test/built.ts",
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
  projects: [
    { name: "window" },
    // How the Tiling moves, once more on a screen of 1.6 pixels to the
    // point, as Roma's (ADR 0088, decision 13).
    {
      name: "scale 1.6",
      testMatch: /motion\.spec\.ts$/,
      metadata: { scale: 1.6 },
    },
  ],
})
