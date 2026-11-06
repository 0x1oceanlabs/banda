/**
 * The adapters as Banda carries them, with its patches
 * (`pnpm-workspace.yaml`'s `patchedDependencies`, ADR 0062 decision 16).
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"

const require = createRequire(import.meta.url)

/** The variable the engine sets on a Project's Harness processes when the
 * Person has not trusted it (`UNTRUSTED_VARIABLE` in the engine). */
const untrusted = (() => {
  const list = join(import.meta.dirname, "../../engine/src/list.rs")
  const said = /UNTRUSTED_VARIABLE: &str = "([A-Z_]+)"/.exec(
    readFileSync(list, "utf8")
  )
  if (!said) throw new Error("the engine names no UNTRUSTED_VARIABLE")
  return said[1]
})()

test("Codex's adapter marks a session's folder trusted only in a trusted Project", () => {
  const manifest =
    require.resolve("@agentclientprotocol/codex-acp/package.json")
  const adapter = readFileSync(join(dirname(manifest), "dist/index.js"), "utf8")
  // The one place it says what Codex trusts, for every session it opens.
  const levels = [...adapter.matchAll(/trust_level: (.+)$/gm)]
  expect(levels).toHaveLength(1)
  const level = (env: Record<string, string>) =>
    runInNewContext(levels[0][1], { process: { env } })
  expect(level({})).toBe("trusted")
  expect(level({ [untrusted]: "1" })).toBe("untrusted")
})
