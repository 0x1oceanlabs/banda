/**
 * The browser Pane names no Electron API: the window gives it its layer,
 * and the desktop its keys. It looks like the rest of the window only
 * through client/ui (docs/architecture.md, "Checks that hold the shape").
 */
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const PANE = [
  // The browser's contract says what `browser.toml` holds: where the tabs
  // go, and the search. The bridge says what the desktop does for the
  // browser (ADR 0028). The settings' say what its section of Settings
  // is about, and write a value as TOML.
  /^@banda\/contract(\/browser|\/bridge|\/settings)?$/,
  // The client's core, by the one door an App takes to it (ADR 0089).
  /^@banda\/core\/react$/,
  /^@banda\/ui\//,
  /^react$/,
  /^lucide-react$/,
  /^\.\.?\//,
]
/** A test may also read files and use its runner. */
const TEST = [...PANE, /^node:/, /^vitest$/]

test("the browser Pane imports only the API, the core, client/ui and React", () => {
  const folder = import.meta.dirname
  // This file names imports as examples; it is not a Pane.
  const panes = sources(folder).filter((file) => file !== import.meta.filename)
  const outside = panes.flatMap((file) => {
    const allowed = /\.test\.tsx?$|testing\.ts$/.test(file) ? TEST : PANE
    return imports(readFileSync(file, "utf8"))
      .filter((name) => !allowed.some((rule) => rule.test(name)))
      .map((name) => `${relative(folder, file)}: ${name}`)
  })
  expect(outside).toEqual([])
})
