/**
 * The window's shape, as its tests hold it.
 *
 * - The window knows no module (ADR 0022, decision 2): only `modules.ts`
 *   names one, in the page and in the desktop's main process, and every
 *   registry is built from it; the bridge's table takes in each module's
 *   part of it (ADR 0028). The files listed here still reach a module's
 *   package, each by an unstable mark its module's manifest names
 *   (decision 6); one that no longer does leaves the list.
 * - The Window holds the areas and the Tiling the Panes (ADR 0087,
 *   decisions 1 and 5): the Tiling imports no more of the Window than it
 *   does today, neither names an App more than it does today, and the
 *   Window's root keeps under a line ceiling, 400 at last. Each count only
 *   falls.
 * - Nothing more animates a size or a place (ADR 0088, decision 2): the
 *   cases of today are listed, and the list only falls.
 * - The window ticks on one clock, which stops while nothing moves (ADR
 *   0088, decision 3): what still asks the browser for a frame of its own
 *   is listed, and the list only falls.
 * - A Pane reads its Tile's state, never as a prop, and only the Tiling
 *   gives it (ADR 0088, decision 4): the files that do are listed, and
 *   the list only falls.
 * - A Pane's content takes its size from its Tile, through the resize
 *   gate's one observer (ADR 0088, decision 5): what else observes a size
 *   is listed with what it measures, and what still sizes a Pane's
 *   content by itself only falls.
 * - What calls has one order, the sidebar's (ADR 0087, decision 8): a
 *   mark's rank is read only to pick the loudest, on the lines listed,
 *   and no list sorts by it.
 * - The calls part reads no page, and of the Tiling only its model (ADR
 *   0087, decision 9).
 * - The Window and the Tiling reach the desktop only through the Window's
 *   device part (ADR 0089, decision 2): what else in the page reads the
 *   desktop's bridge is listed, and the list only falls.
 * - Only the Window keeps Here (ADR 0087, decision 4): one place gives it
 *   to what the Window draws. Where the Person looks is the calls part's
 *   to work out: only the files listed ask the Window, and the list only
 *   falls.
 * - One action goes to an Agent, `pane.pick` (ADR 0087, decision 7): the
 *   Window answers it in one place, and gives no App another way.
 * - What the Window draws on every move it makes is drawn again only as
 *   its own props change (ADR 0088, decision 7): the parts listed stay
 *   memoized, and the list only grows.
 * - What a change makes takes IDs derived from its command's ID (ADR
 *   0088, decision 11): the places in the Tiling that make an ID of their
 *   own are counted, and the counts only fall.
 * - The client's copy of the arrangement's commands is a leaf, as the
 *   crate compiled to WebAssembly that takes its place will be (ADR 0088,
 *   decision 11): it imports the contract alone.
 * - What the Person does to an Item is its App's item actions (ADR 0087,
 *   decision 12): no page code but Threads' names a Thread's verb, no
 *   module global asks a Thread's card to show, the Window asks an App's
 *   engine part by name only where listed, and an App runs another App's
 *   action by its id only where listed, each list only falling. So do the
 *   lists of what stands in for intents and Window stores meanwhile: an
 *   App writing the title field's store, the Window finding an item
 *   action by what it does, and the Window's module-level stores.
 */
import { existsSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import {
  appStrings,
  desktopReads,
  imports,
  layoutMotion,
  manifestIn,
  parts,
  sources,
} from "@banda/ui/testing/architecture"
import { expect, test } from "vitest"
import { modules } from "./modules"

const app = join(import.meta.dirname, "../..")
const root = join(app, "..")

/** Each module's folder, by its id: an App's in apps/, the platform's in
 * platform/ (ADR 0062, decision 11), with its manifest. */
const folders = parts(root)

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
 * `<module>.<mark>`, from `[unstable]` in its module's manifest. */
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

/**
 * Where the page reads the desktop's bridge, `window.banda`, by file from
 * the repository's root, with how many places (`desktopReads`): this
 * page's code, `@banda/ui`'s and each module's Pane part. The Window and
 * the Tiling read it only in the Window's device part (B4b); the rest are
 * listed here until W0's device port takes them, and at last only its
 * desktop adapter, `boot/desktop.ts`, reads it (ADR 0089, decisions 2 and
 * 11). `hostOf` in `@banda/ui/desktop` is one place: the Pane parts that
 * reach their part of the bridge through it are counted there. None joins
 * the list, and a place that goes leaves it.
 */
const DEVICE = "client/web/src/window/device.ts"
const DESKTOP_READS: Record<string, number> = {
  "apps/browser/pane/src/host.ts": 1,
  "client/ui/src/desktop.ts": 1,
  "client/web/src/actions/actions.ts": 1,
  "client/web/src/bar/Update.tsx": 1,
  "client/web/src/main.tsx": 1,
  "client/web/src/menu/browse.ts": 1,
  "client/web/src/settings/Agents.tsx": 3,
  "client/web/src/settings/BrowserSites.tsx": 1,
  "client/web/src/settings/General.tsx": 1,
  "client/web/src/settings/Keys.tsx": 2,
  "client/web/src/settings/Mod.tsx": 1,
  "client/web/src/settings/ProblemsSettings.tsx": 1,
  "client/web/src/settings/ProjectsSettings.tsx": 1,
  "client/web/src/settings/SettingRow.tsx": 2,
  "client/web/src/settings/Settings.tsx": 1,
  "client/web/src/settings/ThemePicker.tsx": 1,
  "client/web/src/sharing/AskToShare.tsx": 1,
  "client/web/src/sidebar/Sidebar.tsx": 1,
  "client/web/src/sidebar/ThemeMenu.tsx": 1,
  "client/web/src/sidebar/write-setting.ts": 1,
  "platform/notifications/pane/src/desktop.ts": 1,
}

const pageCode = [
  join(app, "web/src"),
  join(app, "ui/src"),
  ...[...folders.values()]
    .map((folder) => join(folder, "pane/src"))
    .filter((folder) => existsSync(folder)),
]

const { [DEVICE]: device, ...reading } = Object.fromEntries(
  pageCode
    .flatMap((folder) => sources(folder, { tests: false }))
    .flatMap((file) => {
      const count = desktopReads(readFileSync(file, "utf8"), file)
      return count > 0 ? [[relative(root, file), count]] : []
    })
)

test("the Window and the Tiling read the desktop's bridge only in their device part", () => {
  expect(device).toBeGreaterThan(0)
  const ours = /^client\/web\/src\/(window|tiling)\//
  expect(Object.keys(reading).filter((file) => ours.test(file))).toEqual([])
})

test("the page reads the desktop's bridge no more than the list holds", () => {
  for (const [file, count] of Object.entries(reading))
    expect(count, `${file} reads window.banda`).toBeLessThanOrEqual(
      DESKTOP_READS[file] ?? 0
    )
})

test("a place that no longer reads it comes off the list", () => {
  expect(reading).toEqual(DESKTOP_READS)
})

/**
 * Only the Window writes Here (ADR 0087, decision 4): one file gives it to
 * what the Window draws, and nothing else gives one, so a widget or a part
 * reads where the Person is only from the Window's.
 */
test("only the Window gives Here to what it draws", () => {
  const giving = drawing
    .filter((file) =>
      /<HereContext\b|HereContext\.Provider/.test(readFileSync(file, "utf8"))
    )
    .map((file) => relative(root, file))
  expect(giving).toEqual(["client/web/src/window/here.tsx"])
})

/**
 * Where the Person looks for a thing is the calls part's to work out
 * (`sightOf`, ADR 0087, decision 9), and the rest of where they are Here
 * says (decision 4). Only the notifications part still asks the Window
 * (`WindowApi.sight`), as it needs the Tiles measured to tell the Person,
 * until who is told moves to the host (E9). A file that asks is listed
 * here; one that stops leaves the list, and none joins it.
 */
const ASKING_SIGHT = ["platform/notifications/pane/src/teller.ts"]

test("only the files listed ask the Window where the Person looks", () => {
  const asking = drawing
    .filter((file) => /\.sight\(/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file))
  expect(asking).toEqual(ASKING_SIGHT)
})

/**
 * One action goes to an Agent, `pane.pick` (ADR 0087, decision 7): a
 * sidebar row, a row of the counts list, a toast's button and Alt+U run
 * it. The Window answers it in one place, which alone brings a Pane to the
 * left once drawn, and only the action reaches that answer. No App is
 * given another way to go to a Pane: the Window's API has no `goTo`.
 */
test("one place answers a pick, and only the action reaches it", () => {
  const places = (pattern: RegExp) =>
    sources(join(app, "web/src"), { tests: false }).flatMap((file) =>
      (readFileSync(file, "utf8").match(pattern) ?? []).map(() =>
        relative(app, file)
      )
    )
  expect(places(/\bhow: "left"/g)).toEqual(["web/src/window/Shell.tsx"])
  // The Shell answers it as `parts` too: neither is called but by the action.
  expect(places(/\b(?:shell|parts)\.pick\(/g)).toEqual([
    "web/src/window/actions.ts",
  ])
  const api = readFileSync(join(app, "ui/src/module.ts"), "utf8").match(
    /export type WindowApi = \{\n([\s\S]*?)\n\}/
  )
  expect(api).not.toBeNull()
  expect(api![1]).toMatch(/^ {2}run\b/m)
  // Not as a field, a method or a word in its comments.
  expect(api![1]).not.toMatch(/\bgoTo\b/)
})

/**
 * What the Window and the Tiling still say of an App, once for each place
 * they do, by file (`appStrings`): a string that names an action or a kind
 * of the agents module's (`agents.…`) or a Thread's (`thread.…`), and that
 * module's settings file (`AGENTS_FILE`). Neither names an App (ADR 0087,
 * decision 1); these go with the Thread verbs (B4d), the Flow (B4e, T-b)
 * and intents (B8c). None joins the list, and one that goes leaves it. Not
 * what only tests use.
 */
const APP_STRINGS = [
  "web/src/window/Shell.tsx: AGENTS_FILE",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/actions.ts: AGENTS_FILE",
  "web/src/window/actions.ts: AGENTS_FILE",
]

const saying = ["web/src/window", "web/src/tiling"]
  .flatMap((folder) => sources(join(app, folder), { tests: false }))
  .flatMap((file) =>
    appStrings(readFileSync(file, "utf8"), file).map(
      (what) => `${relative(app, file)}: ${what}`
    )
  )

test("the Window and the Tiling name an App no more than the list holds", () => {
  expect(beyond(saying, APP_STRINGS)).toEqual([])
})

test("a string that no longer names an App leaves the list", () => {
  expect(beyond(APP_STRINGS, saying)).toEqual([])
})

/**
 * The ceiling on the Window's root component, in lines: 400 or fewer once
 * the Window holds only its areas (ADR 0087, decision 1). The file stays
 * under it, and a PR that cuts the file more than `SLACK` lines below it
 * lowers it; the room lets PRs in flight that each cut a few lines leave
 * it alone.
 */
const WINDOW_LINES = 1024
const SLACK = 20

test("the Window's root keeps under its ceiling, and the ceiling follows it down", () => {
  const text = readFileSync(join(app, "web/src/window/Shell.tsx"), "utf8")
  const lines = text.split("\n").length - 1
  expect(lines).toBeLessThanOrEqual(WINDOW_LINES)
  expect(
    WINDOW_LINES - lines,
    `Shell.tsx has ${lines} lines: lower WINDOW_LINES to it`
  ).toBeLessThanOrEqual(SLACK)
})

/**
 * The parts the Window draws on every move, which a move leaves alone (ADR
 * 0088, decision 7): each Tile and the Pane in it, each Strip, the
 * Watches, the Banda menu, the drawer and the bar's widgets, the
 * window's own and each module's, stay memoized, each by what its file
 * says. Their props stay steady too, which the motion numbers hold: the
 * Tiles React draws again for a key (motion.spec.ts). The list only
 * grows.
 */
const MEMOIZED = [
  "web/src/tiling/PaneFrame.tsx: export const PaneFrame = memo(",
  "web/src/tiling/Strip.tsx: export const Strip = memo(",
  "web/src/bar/Watches.tsx: export const Watches = memo(",
  "web/src/menu/BandaMenu.tsx: export const BandaMenu = memo(",
  "web/src/window/Drawer.tsx: export const Drawer = memo(",
  'web/src/bar/Widgets.tsx: "sidebar.counts": memo(Counts)',
  'web/src/bar/Widgets.tsx: "workspaces.aside": memo(',
  "web/src/registry.tsx: { widget: { ...widget, Widget: memo(widget.Widget) }, module }",
  "web/src/registry.tsx: { kind: { ...kind, Pane: memo(kind.Pane) }, module }",
]

test("the parts the Window draws on every move stay memoized", () => {
  const lost = MEMOIZED.filter((each) => {
    const at = each.indexOf(": ")
    const text = readFileSync(join(app, each.slice(0, at)), "utf8")
    return !text.includes(each.slice(at + 2))
  })
  expect(lost).toEqual([])
})

/** The `[unstable]` marks a module's manifest names. */
function marksOf(module: string): string[] {
  const folder = folders.get(module)
  const manifest = folder && manifestIn(folder)
  if (!manifest) return []
  const text = readFileSync(manifest, "utf8")
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

/** The window's clock (`frames.ts`): it alone asks the browser for the
 * ticks that what moves runs in. */
const CLOCK = "client/ui/src/lib/frames.ts"

/**
 * What asks the browser for an animation frame of its own instead of a
 * tick of the clock (ADR 0088, decision 3), by its file, with the places
 * it does: a step taken once, as a focus put after a frame, or a loop that
 * runs only while a hand drags. A loop that runs while nothing moves
 * keeps the clock from stopping, so none is added; a place that joins the
 * clock comes off, and the list only falls.
 */
const OWN_FRAMES: Record<string, number> = {
  "apps/agents/pane/src/thread/Find.tsx": 1,
  "apps/agents/pane/src/thread/Quote.tsx": 1,
  "apps/browser/pane/src/BrowserPane.tsx": 1,
  "apps/browser/pane/src/Lend.tsx": 1,
  "apps/files/pane/src/FilePane.tsx": 2,
  "apps/files/pane/src/TreePane.tsx": 8,
  "apps/files/pane/src/ViewParts.tsx": 1,
  "apps/files/pane/src/thumbs.ts": 1,
  "apps/files/pane/src/views/edit.tsx": 1,
  "apps/files/pane/src/views/hex.tsx": 1,
  "apps/files/pane/src/views/pdf.tsx": 1,
  "apps/git/pane/src/DiffPane.tsx": 1,
  "apps/git/pane/src/folds.ts": 1,
  // The browser's own frames, for a host that hands it no clock.
  "client/ghostty/src/t3/surface.ts": 1,
  "client/ui/src/components/code-file.tsx": 4,
  "client/ui/src/components/file-tree.tsx": 3,
  "client/ui/src/components/line-comment.tsx": 1,
  "client/web/src/sidebar/Edge.tsx": 1,
  "client/web/src/tiling/reorder.ts": 1,
  "client/web/src/tiling/useMoving.ts": 2,
  "client/web/src/titles/Title.tsx": 2,
}

const asking = Object.fromEntries(
  drawing.flatMap((file) => {
    const found = readFileSync(file, "utf8").match(
      /\brequestAnimationFrame\s*\(/g
    )
    return found ? [[relative(root, file), found.length]] : []
  })
)
const { [CLOCK]: clock, ...own } = asking

test("nothing more asks for a frame of its own than the list holds, but the clock", () => {
  expect(clock).toBe(1)
  for (const [file, count] of Object.entries(own))
    expect(count, `${file} asks for a frame itself`).toBeLessThanOrEqual(
      OWN_FRAMES[file] ?? 0
    )
})

test("a place that joins the clock comes off the list", () => {
  expect(own).toEqual(OWN_FRAMES)
})

/** What a Tile is in the page and how the Tiling configures it
 * (`@banda/ui/lib/tile`), past what a Pane reads (`tileOf`, `useTile`). */
const TILE_LIB = "client/ui/src/lib/tile.ts"

/**
 * The files that configure a Tile (ADR 0088, decision 4): the Tiling, as
 * it draws its Tiles and works out which show, and the Drawer, whose Tile
 * hides once it slid away. A Pane only reads its Tile; one that gave its
 * own a state would draw over what the Tiling worked out. A file that no
 * longer configures one leaves the list.
 */
const CONFIGURING = [
  "client/web/src/tiling/PaneFrame.tsx",
  "client/web/src/tiling/tiles.ts",
  "client/web/src/window/Drawer.tsx",
]

test("only the Tiling configures a Tile, as the list holds", () => {
  const configuring = drawing
    .filter((file) => relative(root, file) !== TILE_LIB)
    .filter((file) =>
      /\b(?:TileBox|holdTile|boxOf)\b/.test(readFileSync(file, "utf8"))
    )
    .map((file) => relative(root, file))
    .sort()
  expect(configuring).toEqual(CONFIGURING)
})

/**
 * What still sizes what a Pane draws by an observer of its own, outside
 * the resize gate (`@banda/ui/lib/tile`), by its file and how many it
 * makes: its size comes from its Tile once it reads it there, and it
 * leaves the list, which only falls. The terminal and the browser's page
 * read their Tiles' (ADR 0088, decision 5).
 */
const SIZING: Record<string, number> = {
  // T3's own, for a host that says no size: Banda's terminal hears its
  // Tile's, so it makes none.
  "client/ghostty/src/t3/lib/observeResize.ts": 1,
  // An image fitted to its stage, under the file view's bar; it reads its
  // Tile once the Person's pick says when a size settles (the client's
  // plan, P7).
  "apps/files/pane/src/views/image.tsx": 1,
}

/**
 * What else observes a size, as it should, by its file and how many it
 * makes: a part inside a Pane laid out by the Pane itself, a list it
 * windows, or the Tiling's own boxes and the pages' layer. None sizes a
 * Pane's content to its Tile. A new one is added on purpose, with what it
 * measures.
 */
const MEASURING: Record<string, number> = {
  // A Visual's frame guesses its height from its width, in a Thread.
  "apps/agents/pane/src/visual/Frame.tsx": 1,
  // The window's size, which moves every page; each slot's own comes from
  // its Tile.
  "apps/browser/pane/src/pages.ts": 1,
  // Files: the film's items drawn in view, the newest column kept in view,
  // the crumbs that fit the path bar, and a view's width for its parts.
  "apps/files/pane/src/Columns.tsx": 1,
  "apps/files/pane/src/Gallery.tsx": 1,
  "apps/files/pane/src/PathBar.tsx": 1,
  "apps/files/pane/src/views/near.ts": 1,
  // A list's own window, and a part's own width for its layout.
  "client/ui/src/components/virtual-list.tsx": 1,
  "client/ui/src/hooks/use-wider-than.ts": 1,
  // The Tiling's own boxes: the overview's room, a Strip's room, and the
  // Group plates' pieces.
  "client/web/src/tiling/Overview.tsx": 1,
  "client/web/src/tiling/Strip.tsx": 1,
  "client/web/src/tiling/usePlates.ts": 1,
}

const observing = Object.fromEntries(
  drawing.flatMap((file) => {
    const found = readFileSync(file, "utf8").match(/\bnew ResizeObserver\s*\(/g)
    return found ? [[relative(root, file), found.length]] : []
  })
)

test("a Pane's content takes its size from its Tile, through the gate's one observer", () => {
  const { [TILE_LIB]: gate, ...others } = observing
  expect(gate).toBe(1)
  expect(others).toEqual({ ...SIZING, ...MEASURING })
})

test("a Pane's props carry no state of its Tile: it reads it", () => {
  const props = readFileSync(join(app, "ui/src/pane.ts"), "utf8").match(
    /export type PaneProps<A> = \{\n([\s\S]*?)\n\}/
  )
  expect(props).not.toBeNull()
  const fields = [...props![1].matchAll(/^ {2}(\w+)\??:/gm)].map(
    (found) => found[1]
  )
  expect(fields).toContain("focused")
  expect(
    fields.filter((field) =>
      /^(?:tile|configure|state|visible|hidden|shown|moving)$/.test(field)
    )
  ).toEqual([])
})

/**
 * What draws on a terminal's canvas (ADR 0088, step P4): its renderer,
 * with the glyphs it draws itself. The renderer keeps what each row of
 * the canvas shows, and draws only the rows that differ from it, or moves
 * them as the screen scrolls: anything else drawn there would stay on
 * screen, or be moved with them, until the row changed.
 */
const TERMINAL_DRAWING = [
  "client/ghostty/src/glyphs.ts",
  "client/ghostty/src/t3/renderer.ts",
]

test("only the terminal's renderer draws on its canvas", () => {
  const terminal = join(app, "ghostty/src")
  const drawingThere = drawing
    .filter((file) => file.startsWith(terminal))
    .filter((file) =>
      /\.(?:fillText|strokeText|fillRect|strokeRect|clearRect|drawImage|putImageData)\(/.test(
        readFileSync(file, "utf8")
      )
    )
    .map((file) => relative(root, file))
    .sort()
  expect(drawingThere).toEqual(TERMINAL_DRAWING)
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

/**
 * Where the Tiling makes an ID of its own (`newId`, or the browser's
 * `randomUUID`), by file. What a change makes takes IDs derived from its
 * command's ID (ADR 0088, decision 11), so these are all there are:
 * `model.ts`'s, for what the view works out, which reach the engine only
 * in the arrangement of the very first start, sent once; `store.ts`'s, for
 * that arrangement's Group; and `useTiling.ts`'s, each change's command
 * ID. None joins the list, and the counts only fall.
 */
const MAKING_IDS: Record<string, number> = {
  "web/src/tiling/model.ts": 5,
  "web/src/tiling/store.ts": 1,
  "web/src/tiling/useTiling.ts": 1,
}

const making = Object.fromEntries(
  sources(join(app, "web/src/tiling"), { tests: false }).flatMap((file) => {
    const found = readFileSync(file, "utf8").match(/\bnewId\(|\brandomUUID\(/g)
    return found ? [[relative(app, file), found.length]] : []
  })
)

test("the Tiling makes no more IDs of its own than the list holds", () => {
  for (const [file, count] of Object.entries(making))
    expect(count, `${file} makes an ID`).toBeLessThanOrEqual(
      MAKING_IDS[file] ?? 0
    )
})

test("a place that no longer makes one comes off the list", () => {
  expect(making).toEqual(MAKING_IDS)
})

/**
 * A key's change is drawn at once, before the engine answers (ADR 0088,
 * decision 11): the Tiling's controller awaits nothing. keys.spec.ts
 * holds the rest, as no frame begins between a key and its commit.
 */
test("the Tiling's controller waits on no answer to draw a change", () => {
  const file = readFileSync(join(app, "web/src/tiling/useTiling.ts"), "utf8")
  expect(file.match(/\bawait\b/g)).toBeNull()
})

test("the copy of the arrangement's commands imports the contract alone", () => {
  const file = join(app, "web/src/tiling/arrangement.ts")
  const others = imports(readFileSync(file, "utf8")).filter(
    (name) => name !== "@banda/contract" && !name.startsWith("@banda/contract/")
  )
  expect(others).toEqual([])
})

/** Every page part's code: the Window's, `@banda/ui`'s and each module's
 * Pane part's; not what only tests use. */
const pageFiles = pageCode.flatMap((folder) =>
  sources(folder, { tests: false })
)

/** The Apps, by their ids: the modules in `apps/` (ADR 0062, decision 11),
 * not the platform's. */
const APPS = new Set(
  [...folders]
    .filter(([, folder]) => folder.startsWith(join(root, "apps")))
    .map(([id]) => id)
)

/**
 * A Thread's verbs are Threads' item actions (ADR 0087, decision 12): no
 * page code but Threads' names one by its id, as the Window did, and none
 * imports the `Listing` a module gave the Window before them. The Window
 * finds an Item's by what each does, and runs it by the id it gives.
 */
test("no page code but Threads' names a Thread's verb", () => {
  const threads = join(root, "apps/agents/pane/src")
  // What others may name of a Thread's: New Thread, an intent with B8, the
  // facts they hear, and the Slot of its details card they fill. Any other
  // `thread.…`, a template's too, is a verb.
  const others = new Set([
    "thread.new",
    "thread.started",
    "thread.rewound",
    "thread.details",
  ])
  const verb = (what: string) =>
    (what.startsWith("thread.") && !others.has(what)) ||
    /^agents\.(?:previous-title|make-project)$/.test(what)
  const listing = /[{,]\s*(?:type\s+)?Listing\s*[,}]/
  const naming = pageFiles
    .filter((file) => !file.startsWith(threads))
    .flatMap((file) => {
      const text = readFileSync(file, "utf8")
      return [
        ...appStrings(text, file).filter(verb),
        ...(listing.test(text) ? ["Listing"] : []),
      ].map((what) => `${relative(root, file)}: ${what}`)
    })
  expect(naming).toEqual([])
})

/**
 * No module global asks the focused Thread's card to show, or says which
 * cards are drawn (ADR 0087, decision 12): Threads' own action opens a
 * part of its rows, as git's Switch branch runs it, and git keeps what it
 * draws.
 */
test("@banda/ui holds no global of a Thread's details card", () => {
  const globals = /\b(?:askDetails|hearAsks|showDetails|detailsShown)\b/
  const holding = sources(join(app, "ui/src"), { tests: false })
    .filter((file) => globals.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file))
  expect(holding).toEqual([])
})

/**
 * Where the Window still asks an App's engine part by a method's name
 * (`engine.call`, `engine.command`), by file, once for each place: the
 * App's own parts ask theirs. None joins the list, and one that goes
 * leaves it.
 */
const APP_METHODS = ["web/src/settings/ProjectsSettings.tsx: agents.threads"]

test("the Window asks an App's engine part by name no more than the list holds", () => {
  const method = /\.(?:command|call)\(\s*["'`]([a-z]+)\.([\w.-]+)["'`]/g
  const asking = sources(join(app, "web/src"), { tests: false }).flatMap(
    (file) =>
      [...readFileSync(file, "utf8").matchAll(method)]
        .filter(([, of]) => APPS.has(of))
        .map(([, of, name]) => `${relative(app, file)}: ${of}.${name}`)
  )
  expect(asking).toEqual(APP_METHODS)
})

/**
 * Where an App runs another App's action by its id (`run`), by file, once
 * for each place: an intent takes its place (B8). The Window's actions and
 * the platform's are not another App's. None joins the list, and one
 * that goes leaves it.
 */
const APP_RUNS = [
  "apps/agents/pane/src/ThreadPane.tsx: terminal.run",
  "apps/agents/pane/src/thread/Thread.tsx: browser.open",
  "apps/agents/pane/src/thread/Thread.tsx: browser.open",
  "apps/files/pane/src/views/markdown.tsx: browser.open",
  "apps/git/pane/src/index.ts: agents.thread.details",
  "apps/terminal/pane/src/Servers.tsx: browser.open",
  "apps/terminal/pane/src/TerminalPane.tsx: browser.open",
]

test("an App runs another App's action by its id no more than the list holds", () => {
  const owner = new Map(
    modules.flatMap((module) =>
      [...module.actions, ...module.items].map((action) => [
        action.id,
        module.id,
      ])
    )
  )
  const running = /\brun(?:\?\.)?\(\s*["'`]([\w.-]+)["'`]/g
  const runs = [...APPS].flatMap((id) => {
    const folder = join(folders.get(id)!, "pane/src")
    if (!existsSync(folder)) return []
    return sources(folder, { tests: false }).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(running)]
        .map(([, action]) => action)
        .filter((action) => {
          const of = owner.get(action)
          return of !== undefined && of !== id && APPS.has(of)
        })
        .map((action) => `${relative(root, file)}: ${action}`)
    )
  })
  expect(runs.sort()).toEqual(APP_RUNS)
})

/**
 * Where an App writes the title field's store, a module global in
 * `@banda/ui` the Window's title and row read (#861): Threads asks for the
 * field by the Window's actions once the store is the Window's again. None
 * joins the list, and one that goes leaves it.
 */
const NAMING_STORE = ["apps/agents/pane/src/list/items.ts"]

test("an App reaches the title field's store no more than the list holds", () => {
  const reaching = pageFiles
    .filter((file) => file.startsWith(join(root, "apps")))
    .filter((file) =>
      imports(readFileSync(file, "utf8")).includes("@banda/ui/lib/naming")
    )
    .map((file) => relative(root, file))
  expect(reaching).toEqual(NAMING_STORE)
})

/**
 * Where the Window finds an item action by what it does
 * (`ItemAction.does`), by file, once for each place: a stand-in for the
 * intents of B8 (#862). None joins the list, and one that goes leaves it.
 */
const BY_DOES = [
  "web/src/menu/menu.ts: action.does",
  "web/src/sidebar/Sidebar.tsx: itemActionOf",
  "web/src/sidebar/Sidebar.tsx: itemActionOf",
  "web/src/sidebar/Snoozing.tsx: itemActionOf",
  "web/src/sidebar/Snoozing.tsx: itemActionOf",
  "web/src/sidebar/items.ts: action.does",
  "web/src/sidebar/items.ts: itemActionOf",
  "web/src/titles/Title.tsx: itemActionOf",
  "web/src/titles/Title.tsx: itemActionOf",
  "web/src/titles/Title.tsx: itemActionOf",
]

test("the Window finds an item action by what it does no more than the list holds", () => {
  const finding = /(?<!function )\bitemActionOf(?=\()|\baction\.does\b/g
  const places = sources(join(app, "web/src"), { tests: false }).flatMap(
    (file) =>
      (readFileSync(file, "utf8").match(finding) ?? []).map(
        (what) => `${relative(app, file)}: ${what}`
      )
  )
  expect(places.sort()).toEqual(BY_DOES)
})

/**
 * The Window's stores kept in a module, not one per Window (#863): what
 * an unlisted action sets and a part of the Window draws. None joins the
 * list, and one that goes leaves it.
 */
const MODULE_STORES = [
  "web/src/sidebar/MakeProject.tsx: making",
  "web/src/sidebar/Snoozing.tsx: picking",
]

test("the Window keeps no more stores in a module than the list holds", () => {
  const store = /^(?:export )?const (\w+) = new Store\b/gm
  const kept = sources(join(app, "web/src"), { tests: false }).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(store)].map(
      ([, name]) => `${relative(app, file)}: ${name}`
    )
  )
  expect(kept.sort()).toEqual(MODULE_STORES)
})
