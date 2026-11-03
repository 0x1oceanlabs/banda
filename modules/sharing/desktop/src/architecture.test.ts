/**
 * The sharing module's part in main reaches main only through
 * `@banda/desktop-kit` (ADR 0028, decision 4): no file of `app/desktop`.
 */
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const ALLOWED = [
  /^@banda\/desktop-kit$/,
  /^@banda\/contract(\/[a-z]+)?$/,
  /^effect(\/[a-z]+)?$/,
  /^@effect\//,
  /^electron$/,
  /^node:/,
  /^\.\.?\//,
]
/** A test may also use its runner. */
const TEST = [...ALLOWED, /^vitest$/, /^@banda\/ui\/testing\//]

test("the sharing module's part in main reaches main only through the kit", () => {
  const folder = import.meta.dirname
  // This file names imports as examples; it is not the sharing module's part.
  const parts = sources(folder).filter((file) => file !== import.meta.filename)
  const outside = parts.flatMap((file) => {
    const allowed = /\.test\.tsx?$|testing\.ts$/.test(file) ? TEST : ALLOWED
    return imports(readFileSync(file, "utf8"))
      .filter((name) => !allowed.some((rule) => rule.test(name)))
      .map((name) => `${relative(folder, file)}: ${name}`)
  })
  expect(outside).toEqual([])
})
