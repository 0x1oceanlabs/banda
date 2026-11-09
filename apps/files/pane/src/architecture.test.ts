/**
 * A Pane reaches the engine only through the API, and looks like the rest
 * of the window only through client/ui (docs/architecture.md, "Checks that
 * hold the shape").
 */
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const PANE = [
  // And the words of the modules it asks by name: the Agents' Threads and
  // the files their turns work on, and the Harnesses' colours (ADR 0073,
  // decision 9).
  /^@banda\/contract(\/files|\/settings|\/agents|\/harnesses)?$/,
  // The client's core, by the one door an App takes to it (ADR 0089).
  /^@banda\/core\/react$/,
  /^@banda\/ui\//,
  /^react$/,
  /^lucide-react$/,
  // PDF.js draws a PDF, loaded only as one is shown (ADR 0073, decision
  // 6), as Ghostty draws a terminal.
  /^pdfjs-dist(\/|$)/,
  /^\.\.?\//,
]
/** A test may also read files and use its runner. */
const TEST = [...PANE, /^node:/, /^vitest$/]

test("the files Panes import only the API, the core, client/ui, React and PDF.js", () => {
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
