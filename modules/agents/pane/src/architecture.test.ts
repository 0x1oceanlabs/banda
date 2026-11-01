/**
 * A Pane reaches the engine only through the API, and looks like the rest
 * of the window only through app/ui (docs/architecture.md, "Checks that
 * hold the shape").
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { expect, test } from "vitest"

const PANE = [
  // The look and the settings contract too: the module's own files come
  // with the look, and it writes them (ADR 0016).
  /^@banda\/contract(\/agents|\/look|\/settings)?$/,
  /^@banda\/ui\//,
  /^react$/,
  /^lucide-react$/,
  /^\.\.?\//,
]
/** A test may also read files and use its runner. */
const TEST = [...PANE, /^node:/, /^vitest$/]

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Every module a file names: `from "…"`, `import "…"`, `import("…")`. */
function imports(source: string): string[] {
  const found = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g
  )
  return [...found].map((match) => match[1])
}

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

test("the check sees every kind of import", () => {
  expect(
    imports(
      `import a from "x"\nimport "y"\nconst z = import("z")\nexport { b } from 'w'`
    )
  ).toEqual(["x", "y", "z", "w"])
})
