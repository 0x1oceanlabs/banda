/**
 * The browser's part in main reaches main only through
 * `@banda/desktop-kit` (ADR 0028, decision 4): no file of `client/desktop`,
 * and of the browser's Pane only what it says to the desktop.
 */
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const ALLOWED = [
  /^@banda\/desktop-kit$/,
  /^@banda\/browser-pane\/desktop$/,
  /^@banda\/contract(\/[a-z]+)?$/,
  /^effect(\/[a-z]+)?$/,
  /^@effect\//,
  /^electron(-chrome-extensions|-chrome-web-store)?$/,
  /^@ghostery\/adblocker-electron$/,
  /^playwright-core$/,
  /^tldts-experimental$/,
  /^node:/,
  /^\.\.?\//,
]
/** A test may also use its runner. */
const TEST = [...ALLOWED, /^vitest$/, /^@banda\/ui\/testing\//]

test("the browser's part in main reaches main only through the kit", () => {
  const folder = import.meta.dirname
  // This file names imports as examples; it is not the browser's part.
  const parts = sources(folder).filter((file) => file !== import.meta.filename)
  const outside = parts.flatMap((file) => {
    const allowed = /\.test\.tsx?$|testing\.ts$/.test(file) ? TEST : ALLOWED
    return imports(readFileSync(file, "utf8"))
      .filter((name) => !allowed.some((rule) => rule.test(name)))
      .map((name) => `${relative(folder, file)}: ${name}`)
  })
  expect(outside).toEqual([])
})
