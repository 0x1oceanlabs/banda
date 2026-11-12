/**
 * The updates module's part in main reaches main through nothing: what it
 * needs of the app, main hands it (`App`), and what it asks of the engine
 * goes through the contract (ADR 0028, decision 4; ADR 0119, decision 2).
 * No file of `client/desktop`.
 */
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const ALLOWED = [
  /^@banda\/contract(\/[a-z]+)?$/,
  /^@banda\/core$/,
  /^effect(\/[a-z]+)?$/,
  /^electron$/,
  /^electron-updater(\/out\/providers\/Provider)?$/,
  /^node:/,
  /^\.\.?\//,
]
/** A test may also use its runner. */
const TEST = [...ALLOWED, /^vitest$/, /^@banda\/ui\/testing\//]

test("the updates module's part in main reaches main through nothing of main's", () => {
  const folder = import.meta.dirname
  // This file names imports as examples; it is not the module's part.
  const parts = sources(folder).filter((file) => file !== import.meta.filename)
  const outside = parts.flatMap((file) => {
    const allowed = /\.test\.tsx?$|testing\.ts$/.test(file) ? TEST : ALLOWED
    return imports(readFileSync(file, "utf8"))
      .filter((name) => !allowed.some((rule) => rule.test(name)))
      .map((name) => `${relative(folder, file)}: ${name}`)
  })
  expect(outside).toEqual([])
})
