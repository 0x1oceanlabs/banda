/**
 * The driver runs on the host's Node, beside the engine, and the window's
 * main process takes what the hands do from it: so it takes nothing of
 * Electron, of Effect or of main (ADR 0132, decision 3). And nothing
 * given to the program starts Chromium without its sandbox (decision 2).
 */
import { readFileSync } from "node:fs"
import { basename, relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const ALLOWED = [
  /^@banda\/contract(\/[a-z]+)?$/,
  /^playwright-core$/,
  /^node:/,
  /^\.\.?\//,
]
/** A test may also use its runner. */
const TEST = [...ALLOWED, /^vitest$/, /^@banda\/ui\/testing\//]

const folder = import.meta.dirname
// This file names what it looks for; it is not the driver.
const parts = sources(folder).filter((file) => file !== import.meta.filename)
const isTest = (file: string) => /\.test\.ts$/.test(file)

test("no file of the driver imports Electron, Effect or main's kit", () => {
  const outside = parts.flatMap((file) =>
    imports(readFileSync(file, "utf8"))
      .filter(
        (name) =>
          !(isTest(file) ? TEST : ALLOWED).some((rule) => rule.test(name))
      )
      .map((name) => `${relative(folder, file)}: ${name}`)
  )
  expect(outside).toEqual([])
})

test("what the window takes of it loads no Playwright", () => {
  // The window loads Playwright on an Agent's first call (drive.ts).
  const seen = new Set<string>()
  const loaded: string[] = []
  const follow = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = readFileSync(file, "utf8")
    // Its types alone, which load nothing.
    const taken = text.matchAll(
      /^import\s+(type\s+)?[\s\S]*?from\s+"([^"]+)"/gm
    )
    for (const [, type, name] of taken)
      if (name === "playwright-core" && !type) loaded.push(basename(file))
    for (const name of imports(text))
      if (name.startsWith("./")) follow(`${folder}/${name.slice(2)}.ts`)
  }
  follow(`${folder}/index.ts`)
  expect(loaded).toEqual([])
})

test("nothing given to the program starts Chromium without its sandbox", () => {
  const code = parts.filter((file) => !isTest(file))
  // Only the library's option, for tests, names the sandbox at all.
  const naming = code
    .filter((file) => /sandbox\??:/i.test(readFileSync(file, "utf8")))
    .map((file) => basename(file))
  expect(naming).toEqual(["browsers.ts"])
  // And no part of it reads the environment.
  const reading = code
    .filter((file) => /process\.env/.test(readFileSync(file, "utf8")))
    .map((file) => basename(file))
  expect(reading).toEqual([])
})
