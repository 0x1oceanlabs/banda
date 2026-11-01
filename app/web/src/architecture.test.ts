/**
 * The window knows no module (ADR 0022, decision 2): only `modules.ts`
 * names one, and every registry is built from it. The files listed here,
 * in the page or in the desktop's main process, still reach a module's
 * package, each until the step that ends it; one that no longer does
 * leaves the list.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { imports, sources } from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"

const app = join(import.meta.dirname, "../..")
const root = join(app, "..")

/** The modules' window parts, by their packages' names. */
const packages = readdirSync(join(root, "modules")).flatMap((module) => {
  try {
    const file = join(root, "modules", module, "pane", "package.json")
    return [(JSON.parse(readFileSync(file, "utf8")) as { name: string }).name]
  } catch {
    return []
  }
})
const reachesModule = (name: string) =>
  packages.some((pkg) => name === pkg || name.startsWith(`${pkg}/`))

const SOURCES = "the menu's rows come from sources (ADR 0022, step 4)"
const MAIN =
  "the browser's part in the window's main process, an unstable path (ADR 0022, decision 6)"

const STILL: Record<string, string> = {
  "web/src/shell/actions.ts":
    "the actions move to their modules (ADR 0022, step 3)",
  "web/src/menu/menu.ts": SOURCES,
  "web/src/menu/menu.test.ts": SOURCES,
  "web/src/menu/BandaMenu.tsx": SOURCES,
  "web/src/settings/Agents.tsx":
    "the settings window draws the agents module's section (ADR 0016) until a module declares its own",
  "web/src/host.ts": MAIN,
  "desktop/src/blocker.ts": MAIN,
  "desktop/src/browser.ts": MAIN,
  "desktop/src/extensions.ts": MAIN,
  "desktop/src/popup.ts": MAIN,
  "desktop/src/preload.ts": MAIN,
}

const reaching = ["web/src", "desktop/src"]
  .flatMap((folder) => sources(join(app, folder)))
  .filter((file) => file !== import.meta.filename)
  .filter((file) => imports(readFileSync(file, "utf8")).some(reachesModule))
  .map((file) => relative(app, file))

test("only modules.ts names a module's package", () => {
  expect(packages).toContain("@banda/agents-pane")
  const known = new Set(["web/src/modules.ts", ...Object.keys(STILL)])
  expect(reaching.filter((file) => !known.has(file))).toEqual([])
})

test("a file that no longer reaches a module leaves the list", () => {
  expect(Object.keys(STILL).filter((file) => !reaching.includes(file))).toEqual(
    []
  )
})
