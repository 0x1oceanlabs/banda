/**
 * The window's shape, as its tests hold it.
 *
 * - The window knows no module (ADR 0022, decision 2): only `modules.ts`
 *   names one, in the page and in the desktop's main process, and every
 *   registry is built from it; the bridge's table takes in each module's
 *   part of it (ADR 0028). The files listed here still reach a module's
 *   package, each by an unstable mark its module's `module.toml` names
 *   (decision 6); one that no longer does leaves the list.
 * - Nothing more animates a size or a place (ADR 0088, decision 2): the
 *   cases of today are listed, and the list only falls.
 * - What calls has one order, the sidebar's (ADR 0087, decision 8): a
 *   mark's rank is read only to pick the loudest, on the lines listed,
 *   and no list sorts by it.
 * - The Tiling imports no more of the Window than its list holds (ADR
 *   0087, decision 5); the calls part reads no page, and of the Tiling
 *   only its model (decision 9).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { imports, layoutMotion, sources } from "@banda/ui/testing/architecture"
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

/**
 * What the Tiling still imports of the Window, its Bar, the sidebar list,
 * a Thread's titles and the menu, by file: the Window may import the
 * Tiling, never the other way (ADR 0087, decision 5). None joins the list,
 * and an import that goes leaves it.
 */
const TILING_STILL: Record<string, string[]> = {
  "web/src/tiling/PaneFrame.tsx": ["../window/attach", "../titles/Title"],
  "web/src/tiling/store.ts": ["../sidebar/width"],
}

test("the Tiling imports no more of the Window than the list holds", () => {
  const outside = /^\.\.\/(window|bar|sidebar|titles|menu)(\/|$)/
  const imported = Object.fromEntries(
    sources(join(app, "web/src/tiling")).flatMap((file) => {
      const names = imports(readFileSync(file, "utf8")).filter((name) =>
        outside.test(name)
      )
      return names.length > 0 ? [[relative(app, file), names]] : []
    })
  )
  expect(imported).toEqual(TILING_STILL)
})

/**
 * The calls part reads no page: where the Person looks comes from the
 * model and from what the Tiling measures, handed in (ADR 0087, decision
 * 9), so plain tests cover it. Of the Tiling it imports the model alone.
 */
test("the calls part reads no layout, and of the Tiling only its model", () => {
  const files = sources(join(app, "web/src/calls"), { tests: false })
  expect(files).toContain(join(app, "web/src/calls/sight.ts"))
  // As code reads the page, not as prose says "a document".
  const page =
    /\bdocument\.|\bgetComputedStyle\s*\(|\.(?:getBoundingClientRect|getClientRects)\s*\(|\.(?:offset|client|scroll)(?:Left|Top|Width|Height)\b/
  const reading = files.filter((file) => page.test(readFileSync(file, "utf8")))
  expect(reading.map((file) => relative(app, file))).toEqual([])
  const tiling = files.flatMap((file) =>
    imports(readFileSync(file, "utf8"))
      .filter((name) => /^\.\.\/tiling\//.test(name))
      .filter((name) => name !== "../tiling/model")
      .map((name) => `${relative(app, file)}: ${name}`)
  )
  expect(tiling).toEqual([])
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

/**
 * Only compositor properties animate (ADR 0088, decision 2): a transition
 * or keyframes of a size, a place, a margin or a padding lays the page out
 * again on every tick, on the main thread. Today's cases are listed here,
 * each by its file and what it animates, once for each place it does, and
 * the list only falls.
 */
const LAYOUT_MOTION = [
  "apps/agents/pane/src/thread/Minimap.tsx: transition-all",
  "apps/files/pane/src/acts.tsx: transition-[width]",
  "client/ui/src/components/button.tsx: transition-all",
  "client/ui/src/components/level-slider.tsx: transition-[inset-inline-start,scale,box-shadow]",
  "client/ui/src/components/level-slider.tsx: transition-[width]",
  "client/ui/src/components/trace.tsx: transition-[height]",
  "client/ui/src/styles/globals.css: @keyframes update-in",
  "client/ui/src/styles/globals.css: @keyframes update-out",
  "client/web/src/bar/Update.tsx: transition-[width]",
  "client/web/src/tiling/PaneMenu.tsx: transition-[width]",
  "client/web/src/window/Peek.tsx: transition-[width,height]",
]

/** The window's own code and the Panes', with their stylesheets; not
 * what only tests use. */
const drawing = [
  ...["web/src", "ui/src", "ghostty/src"].map((folder) => join(app, folder)),
  ...[...folders.values()]
    .map((folder) => join(folder, "pane/src"))
    .filter((folder) => existsSync(folder)),
]
  .flatMap((folder) => sources(folder, { tests: false, styles: true }))
  .filter((file) => !file.startsWith(join(app, "ui/src/testing")))

const moving = drawing.flatMap((file) =>
  layoutMotion(readFileSync(file, "utf8")).map(
    (what) => `${relative(root, file)}: ${what}`
  )
)

/** What `list` holds more often than `than` does: once for each time
 * more. */
function beyond(list: string[], than: string[]): string[] {
  const left = [...than]
  return list.filter((each) => {
    const at = left.indexOf(each)
    if (at >= 0) left.splice(at, 1)
    return at < 0
  })
}

test("nothing more animates a size or a place: only what does today", () => {
  expect(drawing).toContain(join(app, "ui/src/styles/globals.css"))
  expect(beyond(moving, LAYOUT_MOTION)).toEqual([])
})

test("a case that no longer animates one leaves the list", () => {
  expect(beyond(LAYOUT_MOTION, moving)).toEqual([])
})

/**
 * A mark's rank (`MARK_ORDER`) is read only to pick the loudest of a few:
 * each line that reads it is listed here, by its file. What calls has one
 * order, the Person's sidebar arrangement, which the sidebar list, the
 * bar's counts and Alt+U go by (ADR 0087, decision 8), so no list sorts
 * by the rank. A line that goes leaves the list; a new one is added on
 * purpose.
 */
const RANKING = [
  // `loudest`
  "client/ui/src/components/banda-mark.tsx",
  // the loudest of what an Agent's Thread calls about
  "client/web/src/bar/attention.ts",
  // the loudest chime, and whether it is louder than the last
  "platform/notifications/pane/src/sound.ts",
  "platform/notifications/pane/src/sound.ts",
]

test("a mark's rank is read only to pick the loudest, where the list holds", () => {
  const reading = drawing
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /\bMARK_ORDER\[/.test(line))
        .map(() => relative(root, file))
    )
    .sort()
  expect(reading).toEqual(RANKING)
})
