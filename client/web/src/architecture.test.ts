/**
 * The window knows no module (ADR 0022, decision 2): only `modules.ts`
 * names one, in the page and in the desktop's main process, and every
 * registry is built from it; the bridge's table takes in each module's
 * part of it (ADR 0028). The files listed here still reach a module's
 * package, each by an unstable mark its module's `module.toml` names
 * (decision 6); one that no longer does leaves the list.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const app = join(import.meta.dirname, "../..")
const root = join(app, "..")

/** Each module's folder, by its id: an App's in apps/, the platform's in
 * platform/ (ADR 0062, decision 11), with its `module.toml`. */
const folders = new Map(
  ["apps", "platform"].flatMap((bucket) =>
    readdirSync(join(root, bucket))
      .map((module) => [module, join(root, bucket, module)] as const)
      .filter(([, folder]) => existsSync(join(folder, "module.toml")))
  )
)

/** The modules' window parts, the page's and main's, by their packages'
 * names. */
const packages = [...folders.values()].flatMap((folder) =>
  ["pane", "desktop"].flatMap((part) => {
    const file = join(folder, part, "package.json")
    if (!existsSync(file)) return []
    return [(JSON.parse(readFileSync(file, "utf8")) as { name: string }).name]
  })
)
const reachesModule = (name: string) =>
  packages.some((pkg) => name === pkg || name.startsWith(`${pkg}/`))

/** Each file that still reaches a module, and the mark that says why:
 * `<module>.<mark>`, from `[unstable]` in its module's `module.toml`. */
const STILL: Record<string, string> = {
  "web/src/settings/Agents.tsx": "agents.settings-section",
  "desktop/src/preload.ts": "browser.desktop-preload",
}

/** The files that name modules by design. */
const NAMING = [
  "web/src/modules.ts",
  "desktop/src/modules.ts",
  "web/src/host.ts",
]

const reaching = ["web/src", "desktop/src"]
  .flatMap((folder) => sources(join(app, folder)))
  .filter((file) => file !== import.meta.filename)
  .filter((file) => imports(readFileSync(file, "utf8")).some(reachesModule))
  .map((file) => relative(app, file))

test("only modules.ts, and the bridge's table, name a module's package", () => {
  expect(packages).toContain("@banda/agents-pane")
  expect(packages).toContain("@banda/browser-desktop")
  const known = new Set([...NAMING, ...Object.keys(STILL)])
  expect(reaching.filter((file) => !known.has(file))).toEqual([])
})

test("a file that no longer reaches a module leaves the list", () => {
  expect(Object.keys(STILL).filter((file) => !reaching.includes(file))).toEqual(
    []
  )
})

/** The `[unstable]` marks a module's `module.toml` names. */
function marksOf(module: string): string[] {
  const folder = folders.get(module)
  if (!folder) return []
  const text = readFileSync(join(folder, "module.toml"), "utf8")
  const table = text.split(/^\[unstable\]$/m)[1] ?? ""
  return [...table.matchAll(/^([a-z-]+) = /gm)].map((found) => found[1])
}

test("each file on the list names an unstable mark its module holds, and each mark a file", () => {
  for (const [file, mark] of Object.entries(STILL)) {
    const [module, name] = mark.split(".")
    expect(marksOf(module), `${file}: ${mark}`).toContain(name)
  }
  // A mark whose last file left the list goes too, and the ceiling falls.
  const named = new Set(Object.values(STILL))
  const held = [...folders.keys()].flatMap((module) =>
    marksOf(module).map((mark) => `${module}.${mark}`)
  )
  expect(held.filter((mark) => !named.has(mark))).toEqual([])
})
