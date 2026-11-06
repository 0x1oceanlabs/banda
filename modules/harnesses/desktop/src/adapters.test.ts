/**
 * The adapters as Banda carries them, with its patches
 * (`pnpm-workspace.yaml`'s `patchedDependencies`, ADR 0062 decision 16)
 * and its shim of Claude Code's SDK (`claude-sdk.mjs`).
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"
import { resolving, untrusted } from "./trust"

const require = createRequire(import.meta.url)

/** The variable that tells each of a Project's Harness processes whether
 * the Person has not trusted it (`UNTRUSTED_VARIABLE` in the engine). */
const variable = (() => {
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
  expect(level({ [variable]: "" })).toBe("trusted")
  expect(level({ [variable]: "1" })).toBe("untrusted")
})

test("Claude Code's adapter resolves only the Person's own settings in a Project not trusted", () => {
  expect(untrusted({ [variable]: "1" })).toBe(true)
  expect(untrusted({ [variable]: "" })).toBe(false)
  expect(untrusted({})).toBe(false)

  expect(resolving({ cwd: "/p" }, false)).toEqual({ cwd: "/p" })
  expect(resolving({ cwd: "/p" }, true)).toEqual({
    cwd: "/p",
    settingSources: ["user"],
  })
  expect(resolving(undefined, true)).toEqual({ settingSources: ["user"] })
  // The adapter's read of the managed policy names its sources: none.
  expect(resolving({ settingSources: [] }, true)).toEqual({
    settingSources: [],
  })
})
