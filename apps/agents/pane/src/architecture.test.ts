/**
 * A Pane reaches the engine only through the API, and looks like the rest
 * of the window only through client/ui (docs/architecture.md, "Checks that
 * hold the shape").
 */
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const PANE = [
  // The look and the settings contract too: the module's own files come
  // with the look, and it writes them (ADR 0016). The desktop bridge (ADR 0028), and the Harnesses' words,
  // which its Threads run on (ADR 0040).
  /^@banda\/contract(\/agents|\/harnesses|\/look|\/settings|\/bridge)?$/,
  // The client's core, by the one door an App takes to it (ADR 0089).
  /^@banda\/core\/react$/,
  /^@banda\/ui\//,
  /^react$/,
  /^lucide-react$/,
  /^\.\.?\//,
]
/** A test may also read files and use its runner. */
const TEST = [...PANE, /^node:/, /^vitest$/]

test("the agents Panes import only the API, the core, client/ui and React", () => {
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

test("entries/ and lines/ import no Pane API, ThreadPane or thread/Thread, and read no window.banda (ADR 0091, decision 7)", () => {
  const folder = import.meta.dirname
  const parts = ["entries", "lines"].flatMap((under) =>
    sources(join(folder, under), { tests: false })
  )
  const crossing = parts.flatMap((file) => {
    const source = readFileSync(file, "utf8")
    const named = imports(source)
      .filter(
        (name) =>
          name === "@banda/ui/pane" ||
          /\/ThreadPane$/.test(name) ||
          /\/thread\/Thread$/.test(name)
      )
      .map((name) => `${relative(folder, file)}: ${name}`)
    // Nor the Pane's words the core holds, as a Pane's host.
    const fromCore = [
      ...source.matchAll(
        /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"@banda\/core(?:\/react)?"/g
      ),
    ]
      .flatMap(([, names]) => names.split(","))
      .map((name) => name.replace(/^\s*type\s+/, "").trim())
      .filter((name) => /^(?:PaneState|Place|paneHost|withHost)$/.test(name))
      .map((name) => `${relative(folder, file)}: ${name}`)
    return /\bwindow\.banda\b/.test(source)
      ? [...named, ...fromCore, `${relative(folder, file)}: window.banda`]
      : [...named, ...fromCore]
  })
  expect(crossing).toEqual([])
})

/**
 * The Person's marks go to a Thread's host only through list/sent.ts
 * (ADR 0096), which shows each at once until its fact comes back and
 * queues none while the host is away: no other file of the module sends
 * one, so none goes around that.
 */
test("only list/sent.ts sends a Thread's marks to its host", () => {
  const folder = import.meta.dirname
  const marking = /["'`]agents\.(?:read|unread|archive|unarchive)["'`]/
  const sending = sources(folder, { tests: false })
    .filter((file) => marking.test(readFileSync(file, "utf8")))
    .map((file) => relative(folder, file))
  expect(sending).toEqual([join("list", "sent.ts")])
})
