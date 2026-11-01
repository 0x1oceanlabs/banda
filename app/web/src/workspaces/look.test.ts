import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

// The tiles' look is a set of CSS variables that the look module sets
// (ADR 0007). Every one the window uses must have Banda's default.
const here = import.meta.dirname
const css = readFileSync(
  join(here, "../../../ui/src/styles/globals.css"),
  "utf8"
)
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
