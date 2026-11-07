/**
 * What the packed app carries (`electron-builder.config.mjs`, ADR 0033):
 * the ACP adapters the harnesses' host package builds, as
 * `resources/adapters` beside the engine, where the engine looks for them
 * and the engine's own copy takes them from (ADR 0059; program.ts).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { CARRIED, ELECTRON } from "./program"

const root = resolve(import.meta.dirname, "../../..")
const text = (path: string) => readFileSync(resolve(root, path), "utf8")

afterEach(() => vi.unstubAllEnvs())

test("the app carries the harnesses' host package's adapters beside its engine", async () => {
  vi.stubEnv("BANDA_VERSION", "0.0.0-test")
  // The config's own file, as electron-builder reads it; it has no types.
  const file = "../electron-builder.config.mjs"
  const { default: config } = (await import(/* @vite-ignore */ file)) as {
    default: { extraResources: unknown[] }
  }
  expect(config.extraResources).toContainEqual({
    from: "../../platform/harnesses/adapters/dist",
    to: CARRIED,
  })
  // The window's build builds them first, as scripts/package.sh runs it
  // before electron-builder; the host package builds them into dist/.
  expect(text("client/desktop/build.mjs")).toContain(
    'import "../../platform/harnesses/adapters/build.mjs"'
  )
  expect(text("platform/harnesses/adapters/build.mjs")).toContain(
    'join(here, "dist")'
  )
  expect(text("pnpm-workspace.yaml")).toContain(
    "  - platform/harnesses/adapters\n"
  )
  // The folder the engine looks for beside its program, and the file
  // beside its copy that names the app's Electron.
  const carried = text("platform/harnesses/engine/src/carried.rs")
  expect(carried).toContain(`pub const FOLDER: &str = "${CARRIED}";`)
  expect(carried).toContain(`pub const ELECTRON: &str = "${ELECTRON}";`)
})
