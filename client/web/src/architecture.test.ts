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
 * - What the Window draws on every move it makes is drawn again only as
 *   its own props change (ADR 0088, decision 7): the parts listed stay
 *   memoized, and the list only grows.
 * - What a change makes takes IDs derived from its command's ID (ADR
 *   0088, decision 11): the places in the Tiling that make an ID of their
 *   own are counted, and the counts only fall.
 * - The client's copy of the arrangement's commands is a leaf, as the
 *   crate compiled to WebAssembly that takes its place will be (ADR 0088,
 *   decision 11): it imports the contract alone.
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
 * What the Window and the Tiling still say of an App, once for each place
 * they do, by file (`appStrings`): a string that names an action or a kind
 * of the agents module's (`agents.…`) or a Thread's (`thread.…`), and that
 * module's settings file (`AGENTS_FILE`). Neither names an App (ADR 0087,
 * decision 1); these go with the Thread verbs (B4d), the Flow (B4e, T-b)
 * and intents (B8c). None joins the list, and one that goes leaves it. Not
 * what only tests use.
 */
const APP_STRINGS = [
  "web/src/tiling/PaneMenu.tsx: thread.…",
  "web/src/tiling/PaneMenu.tsx: thread.…",
  "web/src/window/Shell.tsx: AGENTS_FILE",
  "web/src/window/Shell.tsx: agents.snooze",
  "web/src/window/Shell.tsx: agents.wake",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/actions.ts: AGENTS_FILE",
  "web/src/window/actions.ts: AGENTS_FILE",
  "web/src/window/actions.ts: thread.rename",
  "web/src/window/actions.ts: thread.snooze",
  "web/src/window/actions.ts: thread.suggest-title",
  "web/src/window/actions.ts: thread.unread",
  "web/src/window/actions.ts: thread.wake",
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
const WINDOW_LINES = 1198
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

test("the copy of the arrangement's commands imports the contract alone", () => {
  const file = join(app, "web/src/tiling/arrangement.ts")
  const others = imports(readFileSync(file, "utf8")).filter(
    (name) => name !== "@banda/contract" && !name.startsWith("@banda/contract/")
  )
  expect(others).toEqual([])
})
