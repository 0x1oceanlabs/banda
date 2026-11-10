import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

// The tiles' look is a set of CSS variables that the look module sets
// (ADR 0007). Every one the window uses must have Banda's default: the
// tokens' in tokens.css, written from the token list (ADR 0080, decision
// 7), and what the page works out of them in globals.css.
const here = import.meta.dirname
const css = [
  join(here, "../../../ui/src/styles/globals.css"),
  createRequire(import.meta.url).resolve("@banda/contract/tokens.css"),
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n")
const LOOK =
  /--(gap-[a-z]+|tile-[a-z]+|focus(?:-[a-z]+)*|bar-height|font-family-[a-z]+|text-root)\b/g

test("every look variable the window uses has a default", () => {
  const used = new Set(
    sources(join(here, ".."), { tests: false }).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(LOOK)].map((m) => m[0])
    )
  )
  expect(used.size).toBeGreaterThan(0)
  for (const variable of used) {
    expect(css, variable).toMatch(new RegExp(`^\\s*${variable}:`, "m"))
  }
})
