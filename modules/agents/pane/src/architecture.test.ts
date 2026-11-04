/**
 * A Pane reaches the engine only through the API, and looks like the rest
 * of the window only through app/ui (docs/architecture.md, "Checks that
 * hold the shape").
 */
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const PANE = [
  // The look and the settings contract too: the module's own files come
  // with the look, and it writes them (ADR 0016). The desktop bridge (ADR 0028), and the Harnesses' words,
  // which its Threads run on (ADR 0040).
  /^@banda\/contract(\/agents|\/harnesses|\/look|\/settings|\/bridge)?$/,
  /^@banda\/ui\//,
  /^react$/,
  /^lucide-react$/,
  /^\.\.?\//,
]
/** A test may also read files and use its runner. */
const TEST = [...PANE, /^node:/, /^vitest$/]

test("the agents Panes import only the API, app/ui and React", () => {
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
