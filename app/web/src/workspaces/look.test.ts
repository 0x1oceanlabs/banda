import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

// The tiles' look is a set of CSS variables that the look module sets
// (ADR 0007). Every one the window uses must have Banda's default.
const here = import.meta.dirname
const css = readFileSync(
  join(here, "../../../ui/src/styles/globals.css"),
  "utf8"
)
const LOOK = /--(gap-[a-z]+|tile-[a-z]+|focus(?:-[a-z]+)?|bar-height)\b/g

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : []
  })
}

test("every look variable the window uses has a default", () => {
  const used = new Set(
    sources(join(here, "..")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(LOOK)].map((m) => m[0])
    )
  )
  expect(used.size).toBeGreaterThan(0)
  for (const variable of used) {
    expect(css, variable).toMatch(new RegExp(`^\\s*${variable}:`, "m"))
  }
})
