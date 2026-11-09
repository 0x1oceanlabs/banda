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
 *   does today, neither they nor the sidebar list names an App more than
 *   it does today, and the Window's root keeps under a line ceiling, 400
 *   at last. Each count only falls. The sidebar list does what the Person
 *   asks by the actions' ids: what it still takes as code is listed, no
 *   Project's or Thread's verb, and it pins no Project and writes no
 *   `agents.toml` itself.
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
 * - What calls has one order, the sidebar's (ADR 0087, decision 8): the
 *   sidebar list, the counts and Alt+U take it from one `order`, a mark's
 *   rank is read only to pick the loudest, on the lines listed, and no
 *   list sorts by it.
 * - The calls part reads no page, and of the Tiling only its model (ADR
 *   0087, decision 9).
 * - The Window and the Tiling reach the desktop only through the device's
 *   adapter, `boot/desktop.ts` (ADR 0089, decision 2): what else in the
 *   page reads the desktop's bridge is listed, and the list only falls.
 *   Only `boot/index.ts` takes the adapter in, for its callers.
 * - The client's core has no device, names no App and keeps no state of
 *   its own (ADR 0089, decisions 1 and 11): it imports only itself, the
 *   contract and, in its bindings, React; it reads no global of the
 *   device; only the Window makes the stores that keep Here and the
 *   hosts, and gives them and the machines to what it draws; and an App
 *   or a platform part takes the core only from `@banda/core/react`.
 * - The bridge's table is the desktop's (ADR 0089, decision 4): the
 *   desktop imports nothing of the page, and the page takes only the
 *   table's type, in the files listed, a list that only falls. No path
 *   the core or the bridge left stands, re-exporting it, and what the kit
 *   names of the core again until L3 is listed.
 * - Only the Window keeps Here (ADR 0087, decision 4): one place gives it
 *   to what the Window draws, and only the Window gives the `run` its parts
 *   run an action by. Where the Person looks is the calls part's to work
 *   out: only the files listed ask the Window, and the list only falls.
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
 *   action by what it does, and the stores the page keeps in a module.
 * - Apps meet in Slots (ADR 0082, decision 8; ADR 0087, decision 5): each
 *   Slot's owner reads who fills it in one place, the Window alone gives
 *   them, and a Pane's header and its tile in the Overview draw no
 *   Thread's Mark of the Tiling's own: Threads fills the Slot with it, and
 *   what the Tiling still takes of Banda's mark or reads of an Item's Mark
 *   is listed, only falling. A Pane's header gives what fills it the Pane
 *   alone; what the Apps list reaches them only from the Window's `Kept`,
 *   which only its root draws, and only the files listed read an Item by
 *   it, a list that only falls.
 * - The Person's marks are the Thread's host's (ADR 0096): only the move
 *   names the keys the window kept them under, which stay to be read for
 *   one stable release.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import {
  appStrings,
  desktopReads,
  functionProps,
  imports,
  layoutMotion,
  manifestIn,
  parts,
  propNames,
  sources,
  valuesTaken,
} from "@banda/ui/testing/architecture"
import ts from "typescript"
import { expect, test } from "vitest"
import { modules } from "./modules"
import { widgets, windowModule } from "./registry"

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
  "desktop/src/bridge.ts",
]

const reaching = ["web/src", "desktop/src", "core/src"]
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
 * a Thread's titles, the menu, the device's adapter, the keys of the
 * actions, what the window says when it broke, Project trust, the question
 * of sharing and Settings, by file: the Window may import the Tiling,
 * never the other way (ADR 0087, decision 5). None joins the list, and an
 * import that goes leaves it.
 */
const TILING_STILL: Record<string, string[]> = {
  "web/src/tiling/PaneFrame.tsx": ["../window/attach", "../titles/Title"],
  "web/src/tiling/store.ts": ["../sidebar/width"],
}

test("the Tiling imports no more of the Window than the list holds", () => {
  const outside =
    /^\.\.\/(window|bar|sidebar|titles|menu|boot|actions|safe|trust|sharing|settings)(\/|$)/
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
 * A Thread's Mark on its Pane's header and on its tile in the Overview is
 * Threads' part of the Slot `pane.header` (ADR 0062, decision 17): nothing
 * in the Tiling draws one itself.
 */
test("nothing in the Tiling draws a Thread's Mark", () => {
  const drawingMarks = sources(join(app, "web/src/tiling"))
    .filter((file) => /\bThreadMark\b/.test(readFileSync(file, "utf8")))
    .map((file) => relative(app, file))
  expect(drawingMarks).toEqual([])
})

/**
 * What the Tiling still takes of Banda's mark, by file and name: a Deck's
 * segment draws the mark of a Thread that calls (`Tabs.tsx`, #942), and a
 * Group's plate and its bar in the Group map take its Agent's state, which
 * T-a reads by the Group's owner (the map came from the Bar with B4f). None
 * joins the list, and one that goes leaves it.
 */
const TILING_BANDA_MARK = [
  "web/src/tiling/Map.tsx: GroupState",
  "web/src/tiling/Map.tsx: groupState",
  "web/src/tiling/Strip.tsx: groupState",
  "web/src/tiling/Tabs.tsx: BandaMark",
  "web/src/tiling/Tabs.tsx: MARK_WORDS",
  "web/src/tiling/plates.ts: GroupState",
  "web/src/tiling/usePlates.ts: GroupState",
]

test("the Tiling takes no more of Banda's mark than the list holds", () => {
  const taking = sources(join(app, "web/src/tiling")).flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"@banda\/ui\/components\/banda-mark"/g
      ),
    ].flatMap(([, names]) =>
      names
        .split(",")
        .map((name) => name.replace(/^\s*type\s+/, "").trim())
        .filter(Boolean)
        .map((name) => `${relative(app, file)}: ${name}`)
    )
  )
  expect(taking.sort()).toEqual(TILING_BANDA_MARK)
})

/**
 * What the Tiling still reads of an Item's Mark or what it calls, by file,
 * once for each place: a Group's plate and its bar in the Group map take
 * its Agent's colour, which T-a reads by the Group's owner instead; and a
 * Project's workspace number has a dot while one of its Threads calls
 * (`useCalling`), as it had on the Bar before the numbers became the
 * Tiling's widget. A Pane's header and its tile in the Overview read none:
 * what an App shows there is its part of the Slot. None joins the list,
 * and one that goes leaves it.
 */
const TILING_MARKS = [
  "web/src/tiling/Map.tsx: mark",
  "web/src/tiling/Strip.tsx: mark",
  "web/src/tiling/widgets.tsx: useCalling",
]

test("the Tiling reads an Item's Mark no more than the list holds", () => {
  const reading = sources(join(app, "web/src/tiling"), {
    tests: false,
  }).flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /\.(mark|calls)\b(?!\s*\()|\b(useCalling)\(/g
      ),
    ].map(([, what, hook]) => `${relative(app, file)}: ${what ?? hook}`)
  )
  expect(reading).toEqual(TILING_MARKS)
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
 * page's code, the core's, `@banda/ui`'s and each module's Pane part. The
 * Window and the Tiling read it only through the device's desktop
 * adapter, `boot/desktop.ts` (B4b, W0a1); the rest are listed here until
 * the device port takes them, and at last only the adapter reads it (ADR
 * 0089, decisions 2 and 11). `hostOf` in `@banda/ui/desktop` is one
 * place: the Pane parts that reach their part of the bridge through it
 * are counted there. None joins the list, and a place that goes leaves
 * it.
 */
const DEVICE = "client/web/src/boot/desktop.ts"
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
  join(app, "core/src"),
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
  const ours = /^client\/web\/src\/(window|tiling|boot)\//
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
 * What the Window draws runs an action by its id with the Window's own
 * `run` (`useRun`, ADR 0087, decision 11): only the Window gives it, as it
 * gives Here, so a part that runs one acts with the Window's Here as it
 * runs and borrows no other part's hook. A popped-out Pane's window may
 * give its own: it is the Window's too.
 */
test("only the Window gives run to what it draws", () => {
  const giving = drawing
    .filter((file) =>
      /<RunContext\b|RunContext\.Provider/.test(readFileSync(file, "utf8"))
    )
    .map((file) => relative(root, file))
  expect(giving).toContain("client/web/src/window/here.tsx")
  expect(
    giving.filter((file) => !file.startsWith("client/web/src/window/"))
  ).toEqual([])
})

/**
 * What the sidebar list's components take as code, not data, by file and
 * component (`functionProps`, ADR 0087, B4e): each `.tsx` under
 * `sidebar/` is read, its counts on the Bar's too (B4f), which go to a
 * Thread as a row does, and a file whose components take no code is left
 * out. The rest it does by the actions' ids, as their keys would
 * (`useRun`): opening a Pane, a New Thread, the menu, the settings and a
 * Project's verbs. What stays is the Window's area (`onDismiss`, and the
 * sidebar's width and hiding by its `Edge`), which Pane has the focus
 * (`isCurrent`, #827), the list's own folding and filter, a Project's menu
 * around its row (`withMenu`), the trust card the Sidebar anchors by a row
 * (ADR 0083, decision 5), until trust is an action too (#947), and what is
 * picked in the snooze's picker, which the picker runs as its App's action
 * by its id. Each list only falls, and no prop, whatever its type
 * (`propNames`), is a Project's or a Thread's verb.
 */
const SIDEBAR_CODE: Record<string, Record<string, string[]>> = {
  "web/src/sidebar/Edge.tsx": {
    Edge: ["onWidth", "onHide", "onHiding"],
  },
  "web/src/sidebar/Sidebar.tsx": {
    Sidebar: ["onDismiss", "isCurrent"],
    SectionView: ["isCurrent", "onToggle", "onMore", "withMenu"],
    ProjectsList: ["onPick", "withMenu"],
    ProjectMenu: ["onTrust", "onStopTrusting"],
    TrustItem: ["onTrust", "onStopTrusting"],
    HostPart: ["onFold"],
  },
  "web/src/sidebar/Snoozing.tsx": {
    Picking: ["onPick"],
  },
}

/** The verbs the sidebar list ran by props until B4e, and a Thread's. */
const VERBS =
  /^on(?:Open|NewThread|NoProject|AddProject|Pin|Locate|ProjectSettings|Menu|Settings|Keys|Start|Snooze|Wake|Archive|Rename)$/

test("the sidebar list takes no more code than the list holds, and no Project's or Thread's verb", () => {
  const files = sources(join(app, "web/src/sidebar"), { tests: false })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => [relative(app, file), readFileSync(file, "utf8")] as const)
  expect(files.map(([file]) => file)).toContain("web/src/sidebar/Row.tsx")
  // A component that takes no code is left out, and so is a file of none.
  const taken = Object.fromEntries(
    files.flatMap(([file, source]) => {
      const some = Object.entries(functionProps(source, file)).filter(
        ([, names]) => names.length > 0
      )
      return some.length > 0 ? [[file, Object.fromEntries(some)]] : []
    })
  )
  const verbs = files.flatMap(([file, source]) =>
    Object.entries(propNames(source, file)).flatMap(([component, names]) =>
      names
        .filter((name) => VERBS.test(name))
        .map((name) => `${file}: ${component} ${name}`)
    )
  )
  expect(verbs).toEqual([])
  expect(taken).toEqual(SIDEBAR_CODE)
})

/**
 * A Project's pin is the Window's `projects.pin`, and the Flow the Person
 * picks is `flow.pick`, beside `flow.solo` (ADR 0087, B4e): the sidebar
 * list pins no Project itself, by `updateProject` or by the engine's
 * `projects.update`, and writes no `agents.toml`.
 */
test("the sidebar list pins no Project and writes no agents.toml", () => {
  const writing =
    /\bupdateProject\b|\bprojects\.update\b|(?:writeSetting|settings\.set)\(\s*(?:AGENTS_FILE|["'`]agents\.toml)/
  const files = sources(join(app, "web/src/sidebar"), { tests: false })
  expect(files).toContain(join(app, "web/src/sidebar/Sidebar.tsx"))
  expect(
    files
      .filter((file) => writing.test(readFileSync(file, "utf8")))
      .map((file) => relative(app, file))
  ).toEqual([])
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
  // The core too, where the hosts store places a pick on its host.
  const places = (pattern: RegExp) =>
    ["web/src", "core/src"]
      .flatMap((folder) => sources(join(app, folder), { tests: false }))
      .flatMap((file) =>
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
 * What the Window, the Tiling and the sidebar list still say of an App,
 * once for each place they do, by file (`appStrings`): a string that names
 * an action or a kind of the agents module's (`agents.…`) or a Thread's
 * (`thread.…`), and that module's settings file (`AGENTS_FILE`). None of
 * them names an App (ADR 0087, decision 1); these go with the Flow (T-b)
 * and intents (B8c), and the sidebar's New Thread with them, as the key
 * starts one. None joins the list, and one that goes leaves it. Not what
 * only tests use.
 */
const APP_STRINGS = [
  "web/src/sidebar/FlowMenu.tsx: AGENTS_FILE",
  "web/src/sidebar/open.ts: thread.new",
  "web/src/window/Shell.tsx: AGENTS_FILE",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/Shell.tsx: thread.new",
  "web/src/window/actions.ts: AGENTS_FILE",
  "web/src/window/actions.ts: AGENTS_FILE",
]

const saying = [
  "web/src/window",
  "web/src/tiling",
  "web/src/sidebar",
  "web/src/boot",
]
  .flatMap((folder) => sources(join(app, folder), { tests: false }))
  .flatMap((file) =>
    appStrings(readFileSync(file, "utf8"), file).map(
      (what) => `${relative(app, file)}: ${what}`
    )
  )

test("the Window, the Tiling and the sidebar list name an App no more than the list holds", () => {
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
const WINDOW_LINES = 967
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
 * grows, but where a part comes to be memoized by a line already on it:
 * the window's own widgets, the counts and the Tiling's, stand in the
 * registry's, as the modules' do (ADR 0087, B4f).
 */
const MEMOIZED = [
  "web/src/tiling/PaneFrame.tsx: export const PaneFrame = memo(",
  "web/src/tiling/Strip.tsx: export const Strip = memo(",
  "web/src/bar/Watches.tsx: export const Watches = memo(",
  "web/src/menu/BandaMenu.tsx: export const BandaMenu = memo(",
  "web/src/window/Drawer.tsx: export const Drawer = memo(",
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
  // The window's own widgets the registry memoizes as a module's, by its
  // line above.
  for (const id of ["sidebar.counts", "workspaces.list", "workspaces.aside"])
    expect(widgets.get(id)?.module, id).toBe(windowModule)
})

/**
 * The Tiling's widgets read what the Window hands them of it, around its
 * Bar (`TilingBar`): only the Window gives it, as it gives Here.
 */
test("only the Window hands the Tiling's widgets what they read of it", () => {
  const giving = sources(join(app, "web/src"), { tests: false })
    .filter((file) => /<TilingBar\b/.test(readFileSync(file, "utf8")))
    .map((file) => relative(app, file))
  expect(giving).toEqual(["web/src/window/Shell.tsx"])
})

/**
 * Every widget on the Bar is given the same, the window's own as a
 * module's (ADR 0087, B4f): the engine and the Projects. Where the Person
 * is it reads from Here, and it acts by an action's id (`useRun`), so no
 * widget is handed the Window's run or its state as props, and none takes
 * a type of props of the window's own beside them.
 */
test("every widget on the Bar is given the engine and the Projects, and no more", () => {
  const props = readFileSync(join(app, "ui/src/module.ts"), "utf8").match(
    /export type WidgetProps = \{\n([\s\S]*?)\n\}/
  )
  expect(props).not.toBeNull()
  const fields = [...props![1].matchAll(/^ {2}(\w+)\??:/gm)].map(
    (found) => found[1]
  )
  expect(fields).toEqual(["engine", "projects"])
  const naming = pageCode
    .flatMap((folder) => sources(folder, { tests: false }))
    .filter((file) => /\bOwnProps\b/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file))
  expect(naming).toEqual([])
})

/**
 * The widgets that stay in a narrow Bar (`compact`, ADR 0087, decision
 * 11): the counts, the switcher while the Sidebar is hidden, the
 * workspaces and the pill that brings them back, which no action reaches.
 * Nothing reads the mark until the phone's form (W4); a widget joins the
 * list as it gets a compact form.
 */
test("compact marks the counts, the workspaces and the set-aside pill", () => {
  const compact = [...widgets.values()]
    .filter(({ widget }) => widget.compact)
    .map(({ widget }) => widget.id)
  expect(compact.sort()).toEqual([
    "sidebar.counts",
    "workspaces.aside",
    "workspaces.list",
  ])
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
  ...["web/src", "core/src", "ui/src", "ghostty/src"].map((folder) =>
    join(app, folder)
  ),
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
 * What calls has one order, the Person's arrangement of the sidebar (ADR
 * 0087, decision 8; the plan's §6.3): the sidebar list, the bar's counts
 * list and Alt+U each take it from `order`, and only `order` works the
 * arrangement out. Each places another machine's Threads alike (ADR 0079,
 * decision 4; #999): a file that takes `order` takes the other machines
 * from `useElsewhere` too, and Alt+U takes them on the key, through
 * `useOrderNow`. The counts and Alt+U sort what they show by its keys in
 * `byOrder`: the sidebar list's file, the counts', Alt+U's, and a file
 * that reads a place in it, as Alt+U's start does, sort nothing by
 * themselves. What a file takes is read in each form of import and
 * re-export (`valuesTaken`), and neither `arrange`'s module nor `order`'s
 * is taken whole, so none takes `arrange` by another name.
 */
test("the sidebar list, the counts and Alt+U go by one order", () => {
  const sidebar = join(app, "web/src/sidebar")
  const arranging = join(sidebar, "arrange")
  const ordering = join(sidebar, "order")
  const taken = new Map(
    sources(join(app, "web/src"), { tests: false }).map((file) => [
      relative(app, file),
      valuesTaken(readFileSync(file, "utf8"), file),
    ])
  )
  const taking = (module: string, name: string) =>
    [...taken]
      .filter(([, of]) => of[module]?.includes(name))
      .map(([file]) => file)
  expect([...taking(arranging, "*"), ...taking(ordering, "*")]).toEqual([])
  expect([
    ...taking(arranging, "arrange"),
    ...taking(ordering, "arrange"),
  ]).toEqual(["web/src/sidebar/order.ts"])
  const list = "web/src/sidebar/Sidebar.tsx"
  const altU = "web/src/window/Shell.tsx"
  const going = [...taken]
    .map(([file, of]) => ({ file, taken: of[ordering] ?? [] }))
    .filter(
      ({ taken: names }) =>
        names.includes("order") || names.includes("useOrderNow")
    )
  expect(going).toEqual([
    {
      file: "web/src/sidebar/Counts.tsx",
      taken: expect.arrayContaining(["order", "useElsewhere"]),
    },
    { file: list, taken: expect.arrayContaining(["order", "useElsewhere"]) },
    { file: altU, taken: expect.arrayContaining(["useOrderNow"]) },
  ])
  for (const { file, taken: names } of going)
    if (names.includes("order")) expect(names, file).toContain("useElsewhere")
  for (const file of ["web/src/sidebar/tally.ts", "web/src/calls/sight.ts"])
    expect(readFileSync(join(app, file), "utf8"), file).toMatch(/\bbyOrder\(/)
  const placing = taking(ordering, "placeIn")
  expect(placing).toEqual(["web/src/calls/sight.ts"])
  const counting = ["web/src/sidebar/tally.ts", "web/src/sidebar/Counts.tsx"]
  for (const file of [...counting, ...placing, list, altU])
    expect(readFileSync(join(app, file), "utf8"), file).not.toMatch(
      /\.(?:sort|toSorted)\(/
    )
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
    /^agents\.(?:previous-title|make-project|archive-thread)$/.test(what)
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
 * The page's stores kept in a module, not one per Window (#863), by file,
 * over all the page's code: the Window's, the core's, `@banda/ui`'s and
 * each module's Pane part. Most hold what an unlisted action sets for a
 * part to draw: the snooze's picker, the new Project's field and the
 * limits' look a refused write answers (#1020); Threads' holds the
 * Person's marks on their way to a host (ADR 0096). The core keeps none
 * (ADR 0089). None joins the list, and one that goes leaves it.
 */
const MODULE_STORES = [
  "apps/agents/pane/src/list/sent.ts: sent",
  "client/web/src/sidebar/Snoozing.tsx: picking",
  "client/web/src/titles/MakeProject.tsx: making",
  "platform/harnesses/pane/src/look.ts: picked",
]

test("the page keeps no more stores in a module than the list holds", () => {
  const store = /^(?:export )?const (\w+) = new Store\b/gm
  const kept = pageCode
    .flatMap((folder) => sources(folder, { tests: false }))
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(store)].map(
        ([, name]) => `${relative(root, file)}: ${name}`
      )
    )
  expect(kept.sort()).toEqual(MODULE_STORES)
})

/**
 * Each Slot is read in one place, by its owner (ADR 0082, decision 8):
 * Threads draws its details card, and the Tiling a Pane's header and its
 * tile's label in the Overview, through one part. Only the Window gives
 * what fills them, as it gives the previewers; no module gives a Slot's
 * fillers a field of its own, as `threadDetails` was.
 */
const SLOT_READERS = {
  "pane.header": "client/web/src/tiling/PaneSlot.tsx",
  "thread.details": "apps/agents/pane/src/thread/Details.tsx",
}

test("each Slot is read in one place, and only the Window gives what fills them", () => {
  // By its name as it is written: a Slot read by a name worked out is
  // not one place.
  const read = pageFiles.flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(/\buseSlot\(\s*([^)]*?)\s*\)/g),
    ].map(([, slot]) => [
      slot.replace(/^"([\w.]+)"$/, "$1"),
      relative(root, file),
    ])
  )
  expect(Object.fromEntries(read)).toEqual(SLOT_READERS)
  expect(read).toHaveLength(Object.keys(SLOT_READERS).length)
  // Nor by `useSlot` under another name; and what fills them all is
  // built only where the Window gives it.
  const naming = (word: RegExp) =>
    pageFiles
      .filter((file) => word.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .sort()
  expect(naming(/\buseSlot\b/)).toEqual(
    [...Object.values(SLOT_READERS), "client/ui/src/slots.ts"].sort()
  )
  expect(naming(/\bslotsOf\b/)).toEqual([
    "client/web/src/App.tsx",
    "client/web/src/registry.tsx",
    "client/web/src/window/Popped.tsx",
  ])
  const giving = pageFiles
    .filter((file) => /<Slots\s+value=/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file))
    .sort()
  expect(giving).toEqual([
    "client/web/src/App.tsx",
    "client/web/src/window/Popped.tsx",
  ])
  const around = pageFiles
    .filter((file) => file !== join(app, "ui/src/slots.ts"))
    .filter((file) =>
      /\buseContext\(\s*Slots\b|\bthreadDetails\b/.test(
        readFileSync(file, "utf8")
      )
    )
    .map((file) => relative(root, file))
  expect(around).toEqual([])
})

/**
 * A Pane's header gives what fills it the Pane alone (#943): its Project,
 * its args and where it is drawn, never an Item, so no App is handed
 * another's. By what `HeaderProps` declares, in each of its forms.
 */
test("a Pane's header gives what fills it the Pane alone", () => {
  const file = join(app, "ui/src/slots.ts")
  const { statements } = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
  const header = statements
    .filter(ts.isTypeAliasDeclaration)
    .find(({ name }) => name.text === "HeaderProps")
  expect(header).toBeDefined()
  // Its keys, through each form it joins; a type named among them, not
  // as a key's, would hide what it gives.
  const keysOf = (node: ts.TypeNode): string[] =>
    ts.isTypeLiteralNode(node)
      ? node.members.map((member) =>
          member.name && ts.isIdentifier(member.name)
            ? member.name.text
            : member.getText()
        )
      : ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)
        ? node.types.flatMap(keysOf)
        : ts.isParenthesizedTypeNode(node)
          ? keysOf(node.type)
          : [`type ${node.getText()}`]
  const keys = new Set(keysOf(header!.type))
  expect([...keys].sort()).toEqual(["at", "calling", "pane", "project"])
  // And the Slot gives `HeaderProps` itself: nothing joined to it there.
  const slots = statements
    .filter(ts.isTypeAliasDeclaration)
    .find(({ name }) => name.text === "SlotProps")?.type
  const given =
    slots && ts.isTypeLiteralNode(slots)
      ? slots.members.find(
          (member) => member.name?.getText() === '"pane.header"'
        )
      : undefined
  expect(
    given && ts.isPropertySignature(given) ? given.type?.getText() : given
  ).toBe("HeaderProps")
})

/**
 * What the Apps list reaches them from the Window alone, through the kit
 * (`hooks/use-item.ts`), until B7a gives the Item a store of its own: only
 * the Window's `Kept` gives it, and only the Window's root draws a `Kept`,
 * by any name, so a popped-out Pane's window, which is given no Items,
 * never draws a Mark by its kind's icon. The files that read an Item by
 * it are listed: it lets any App read every Item, so only what fills a
 * Pane's header with its own does, and the list only falls.
 */
const ITEM_READERS = ["apps/agents/pane/src/list/header.tsx"]

/** What `file` takes, by name, or `*` for all of it, of each module
 * whose path, as `file` writes it, `from` matches: by an import, or an
 * export from it. */
function takenOf(
  file: string,
  from: (path: string, file: string) => boolean
): string[] {
  const { statements } = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest
  )
  return statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    )
      return []
    const path = statement.moduleSpecifier
    if (!path || !ts.isStringLiteral(path) || !from(path.text, file)) return []
    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause
    return named && (ts.isNamedImports(named) || ts.isNamedExports(named))
      ? named.elements.map(
          ({ name, propertyName }) => (propertyName ?? name).text
        )
      : ["*"]
  })
}

/** The functions of `file` that draw an element `tag`, or `tag.Provider`,
 * by name: one for each it draws, `?` for one with no name of its own. */
function drawingIn(file: string, tag: string): string[] {
  const drawing: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      [tag, `${tag}.Provider`].includes(node.tagName.getText())
    ) {
      let around = node.parent
      while (!ts.isFunctionLike(around) && !ts.isSourceFile(around))
        around = around.parent
      drawing.push(
        ts.isFunctionDeclaration(around) && around.name ? around.name.text : "?"
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(
    ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
  )
  return drawing
}

/** The files of `files` that draw an element `tag`, or `tag.Provider`. */
function drawingTag(files: readonly string[], tag: string): string[] {
  return files
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => drawingIn(file, tag).length > 0)
    .map((file) => relative(root, file))
    .sort()
}

test("only the Window gives the Apps what they list, and only what fills a Pane's header reads it", () => {
  const kit = join(app, "ui/src/hooks/use-item.ts")
  const here = join(app, "web/src/window/here")
  // Who takes `name` of a module `from` matches, under any name of
  // their own.
  const taking = (name: string, from: Parameters<typeof takenOf>[1]) =>
    pageFiles
      .filter((file) =>
        takenOf(file, from).some((one) => one === name || one === "*")
      )
      .map((file) => relative(root, file))
      .sort()
  const fromKit = (path: string, file: string) =>
    file !== kit && /(^|\/)use-item$/.test(path)
  expect(taking("useItem", fromKit)).toEqual(ITEM_READERS)
  expect(taking("ItemsContext", fromKit)).toEqual([
    "client/web/src/window/here.tsx",
  ])
  // Only `Kept` gives it, and only the root takes `Kept`: no wrapper of
  // another name gives a window the items.
  expect(drawingTag(pageFiles, "ItemsContext")).toEqual([
    "client/web/src/window/here.tsx",
  ])
  expect(drawingIn(`${here}.tsx`, "ItemsContext")).toEqual(["Kept"])
  expect(
    taking("Kept", (path, file) => join(dirname(file), path) === here)
  ).toEqual(["client/web/src/window/Shell.tsx"])
  expect(drawingTag(pageFiles, "Kept")).toEqual([
    "client/web/src/window/Shell.tsx",
  ])
})

/**
 * The window's old marks (ADR 0096, decision 9): their keys stay, read
 * only, for one stable release, for the move to read. Only the move, and
 * the renaming that brings older names to them first, name them: no page
 * code keeps a mark there again. One that no longer names them leaves the
 * list.
 */
const OLD_MARKS = [
  "apps/agents/pane/src/list/marks-moved.ts",
  "client/web/src/renamed.ts",
]

test("only the move names the window's old marks' keys", () => {
  const old = /["'`]banda\.(?:agents\.seen|sidebar\.archived(?:-before)?)["'`]/
  const naming = pageFiles
    .filter((file) => old.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file))
  expect(naming.sort()).toEqual(OLD_MARKS)
})

/** The client's core (ADR 0089, decision 1), its code and its tests. */
const core = join(app, "core/src")
const coreFiles = sources(core)
const coreCode = sources(core, { tests: false })
const isTest = (file: string) => /\.test\.tsx?$/.test(file)
/** Whether `file` is in `folder`, at any depth. */
const inside = (folder: string, file: string) => file.startsWith(folder + sep)

/**
 * The core imports itself, the contract and, in its bindings, React,
 * nothing more (ADR 0089, decision 11), as the lint holds it too: no kit,
 * no page, no desktop, no App, no Node. Its main files never import its
 * bindings, and its bindings import its main files, not their barrel. A
 * test may use its runner, and one of the bindings may draw to text.
 */
test("the core imports only itself, the contract, and React in its bindings", () => {
  const bindings = join(core, "react")
  expect(coreFiles).toContain(join(core, "index.ts"))
  const outside = coreFiles.flatMap((file) => {
    const binding = inside(bindings, file)
    const allowed = (name: string) => {
      if (/^\.\.?\//.test(name)) {
        const to = join(dirname(file), name)
        return (
          inside(core, to) &&
          (binding || !(to === bindings || inside(bindings, to))) &&
          !(binding && to === join(core, "index"))
        )
      }
      return (
        /^@banda\/contract(\/[\w-]+)?$/.test(name) ||
        (binding && name === "react") ||
        (isTest(file) && name === "vitest") ||
        (isTest(file) && binding && name === "react-dom/server")
      )
    }
    return imports(readFileSync(file, "utf8"))
      .filter((name) => !allowed(name))
      .map((name) => `${relative(app, file)}: ${name}`)
  })
  // The bindings' barrel re-exports the core whole: its one way to it.
  expect(outside).toEqual(["core/src/react/index.ts: ../index"])
})

/** Where `source`, the code of `file`, reads a global only a device has,
 * by its name, once for each place: `window.…`, `document.…`,
 * `localStorage.…` and the like, as TypeScript reads it, so a comment
 * that names one is not a place. */
function deviceGlobals(source: string, file: string): string[] {
  const device = new Set([
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "navigator",
    "location",
  ])
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      device.has(node.expression.text)
    )
      found.push(node.expression.text)
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest))
  return found
}

/**
 * The core reads no device (ADR 0089, decision 1): no `window.banda`, and
 * no global only a browser or the desktop has. What it needs of the device
 * comes through the Window's port.
 */
test("the core reads no device", () => {
  const reading = coreFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8")
    return [
      ...(desktopReads(source, file) > 0 ? ["window.banda"] : []),
      ...deviceGlobals(source, file),
    ].map((what) => `${relative(app, file)}: ${what}`)
  })
  expect(reading).toEqual([])
})

/** The core names no App (ADR 0089, decision 11): no App's string, and no
 * module's package. */
test("the core names no App", () => {
  const naming = coreCode.flatMap((file) => {
    const source = readFileSync(file, "utf8")
    return [
      ...appStrings(source, file),
      ...imports(source).filter(reachesModule),
    ].map((what) => `${relative(app, file)}: ${what}`)
  })
  expect(naming).toEqual([])
})

/**
 * What the core may keep at a module's top level as an instance, an array
 * or an object, by file and name: constants nothing changes, and a
 * context's default made there, which outside a Window holds nothing to
 * change.
 */
const CORE_CONSTANTS = [
  "core/src/hosts.ts: ITEMS_ELSEWHERE",
  "core/src/hosts.ts: NONE",
  "core/src/hosts.ts: RUNS_ELSEWHERE",
  "core/src/react/here.ts: HereContext",
  "core/src/react/here.ts: NOWHERE",
  "core/src/react/hosts.ts: FORGETTING",
  "core/src/react/hosts.ts: HostsContext",
  "core/src/react/hosts.ts: NOWHERE",
]

/** What `value` makes, past a cast: `new Map() as Kept` makes a Map. */
function made(value: ts.Expression): ts.Expression {
  return ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isParenthesizedExpression(value) ||
    ts.isNonNullExpression(value)
    ? made(value.expression)
    : value
}

/** Whether `value` makes an instance, an array or an object: itself, or
 * what a call it is takes, as `createContext(new Store(…))` does. */
function makes(value: ts.Expression): boolean {
  const what = made(value)
  return (
    ts.isNewExpression(what) ||
    ts.isArrayLiteralExpression(what) ||
    ts.isObjectLiteralExpression(what) ||
    (ts.isCallExpression(what) && what.arguments.some(makes))
  )
}

/**
 * The core keeps no state of its own at a module's top level (ADR 0089,
 * decisions 1 and 5): each store is made by its owner, one per Window,
 * keyed by host as it grows. No `let` or `var` there, and no instance,
 * array or object made there, by itself or as what a call takes, but the
 * constants listed.
 */
test("the core keeps no state of its own at a module's top level", () => {
  const top = coreCode.flatMap((file) =>
    ts
      .createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest
      )
      .statements.filter(ts.isVariableStatement)
      .flatMap(({ declarationList }) =>
        declarationList.declarations.flatMap((held) => {
          const name = ts.isIdentifier(held.name) ? held.name.text : "{…}"
          const what = `${relative(app, file)}: ${name}`
          if (!(declarationList.flags & ts.NodeFlags.Const))
            return [{ what, kept: true }]
          return held.initializer && makes(held.initializer)
            ? [{ what, kept: !CORE_CONSTANTS.includes(what) }]
            : []
        })
      )
  )
  expect(top.filter(({ kept }) => kept).map(({ what }) => what)).toEqual([])
  // One that goes leaves the list.
  expect(top.map(({ what }) => what).sort()).toEqual(CORE_CONSTANTS)
})

/**
 * Only the Window makes the store that keeps its Here (ADR 0087, decision
 * 4): what the Window draws reads it, and nothing else writes one.
 */
test("only the Window makes a KeptHere", () => {
  const making = pageCode
    .flatMap((folder) => sources(folder, { tests: false }))
    .filter((file) => /\bnew KeptHere\b/.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file))
  expect(making).toEqual(["client/web/src/window/here.tsx"])
})

/**
 * Only the Window makes the store that keeps the hosts it shows (ADR
 * 0081, decision 4), handing it this device's memory of their names, and
 * gives it to what it draws, as it gives Here: its root, and a popped-out
 * Pane's window. The machines a new Thread starts on, which that store
 * tells, both give through one wrapper, `window/machines.tsx` (#1010).
 * The core's own store is the default where no Window gives one, with no
 * host and no memory.
 */
test("only the Window makes and gives the hosts, and gives the machines", () => {
  const naming = (word: RegExp) =>
    pageCode
      .flatMap((folder) => sources(folder, { tests: false }))
      .filter((file) => word.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .sort()
  expect(naming(/\bnew KeptHosts\b/)).toEqual([
    "client/core/src/react/hosts.ts",
    "client/web/src/App.tsx",
    "client/web/src/main.tsx",
  ])
  expect(naming(/<HostsContext\b|HostsContext\.Provider/)).toEqual([
    "client/web/src/App.tsx",
    "client/web/src/main.tsx",
  ])
  expect(naming(/<MachinesContext\b|MachinesContext\.Provider/)).toEqual([
    "client/web/src/window/machines.tsx",
  ])
  expect(naming(/<Machines\b/)).toEqual([
    "client/web/src/App.tsx",
    "client/web/src/window/Popped.tsx",
  ])
})

/**
 * A popped-out Pane's window is a chunk of the page's build of its own,
 * which `main.tsx` imports apart from `App.tsx` (ADR 0025, decision 9):
 * what it takes in, file by file, reaches neither `App.tsx` nor the
 * Window's root, `Shell.tsx`. The machines it gives come from the wrapper
 * the root's window gives them by too (#1010).
 */
test("a popped-out Pane's window takes in neither App.tsx nor the Shell", () => {
  const taken = new Set<string>()
  const take = (file: string) => {
    if (taken.has(file)) return
    taken.add(file)
    for (const name of imports(readFileSync(file, "utf8"))) {
      if (!/^\.\.?\//.test(name)) continue
      const base = join(dirname(file), name)
      const found = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
        .map((end) => base + end)
        .find((path) => /\.tsx?$/.test(path) && existsSync(path))
      if (found) take(found)
    }
  }
  take(join(app, "web/src/window/Popped.tsx"))
  const files = [...taken].map((file) => relative(app, file))
  expect(files).toContain("web/src/window/machines.tsx")
  expect(
    files.filter((file) =>
      ["web/src/App.tsx", "web/src/window/Shell.tsx"].includes(file)
    )
  ).toEqual([])
})

/**
 * An App's view, and a platform part's, takes the core only from
 * `@banda/core/react` (ADR 0089, decision 11), its tests too: the one
 * door it reaches what the Window gives by.
 */
test("an App or a platform part takes the core only from @banda/core/react", () => {
  const taking = [...folders.values()]
    .map((folder) => join(folder, "pane/src"))
    .filter((folder) => existsSync(folder))
    .flatMap((folder) => sources(folder))
    .flatMap((file) =>
      imports(readFileSync(file, "utf8"))
        .filter((name) => /^@banda\/core(\/|$)/.test(name))
        .filter((name) => name !== "@banda/core/react")
        .map((name) => `${relative(root, file)}: ${name}`)
    )
  expect(taking).toEqual([])
})

/**
 * The device's desktop adapter is taken in by one file, `boot/index.ts`,
 * the one import of its callers, which W1 makes pick a browser's adapter
 * where the desktop is not (ADR 0089, decision 4). Its tests read it as
 * it is.
 */
test("only boot/index.ts takes in the device's desktop adapter", () => {
  const adapter = join(app, "web/src/boot/desktop")
  const taking = sources(join(app, "web/src"), { tests: false })
    .filter((file) =>
      imports(readFileSync(file, "utf8")).some(
        (name) =>
          /^\.\.?\//.test(name) &&
          join(dirname(file), name).replace(/\.tsx?$/, "") === adapter
      )
    )
    .map((file) => relative(app, file))
  expect(taking).toEqual(["web/src/boot/index.ts"])
})

/**
 * Electron main, the preload and the desktop's tests import nothing of the
 * page (ADR 0089, decisions 4 and 11), by its package or by a path into
 * it: the bridge's table is the desktop's, and the page takes its type
 * from there.
 */
test("the desktop imports nothing of the page", () => {
  const desktop = join(app, "desktop")
  const page = join(app, "web")
  const files = ["src", "e2e", "trials"].flatMap((folder) =>
    sources(join(desktop, folder))
  )
  expect(files).toContain(join(desktop, "src/bridge.ts"))
  const naming = files.flatMap((file) =>
    imports(readFileSync(file, "utf8"))
      .filter(
        (name) =>
          /^@banda\/web(\/|$)/.test(name) ||
          (/^\.\.?\//.test(name) && inside(page, join(dirname(file), name)))
      )
      .map((name) => `${relative(app, file)}: ${name}`)
  )
  expect(naming).toEqual([])
  const manifest = JSON.parse(
    readFileSync(join(desktop, "package.json"), "utf8")
  ) as Record<string, Record<string, string> | undefined>
  const depending = ["dependencies", "devDependencies", "peerDependencies"]
    .flatMap((field) => Object.keys(manifest[field] ?? {}))
    .filter((name) => name === "@banda/web")
  expect(depending).toEqual([])
})

/**
 * The page takes the bridge's table only as a type, `Host` (ADR 0089,
 * decision 4), so none of main's code nor the modules' parts of the table
 * come into its build: `import type` or `export type`, never an import
 * that stays, as `import { type Host }` does. The files that take it are
 * listed, and the list only falls: at last only the device's adapter.
 */
const BRIDGE_TYPES = [
  "web/src/accent.ts",
  "web/src/boot/desktop.ts",
  "web/src/enter-key.ts",
  "web/src/frame.ts",
  "web/src/look.ts",
]

test("the page takes the bridge's table only as a type, in the files listed", () => {
  const fromDesktop = (node: ts.Expression | undefined) =>
    !!node &&
    ts.isStringLiteral(node) &&
    /^@banda\/desktop(\/|$)/.test(node.text)
  const taking = new Set<string>()
  const values: string[] = []
  for (const file of sources(join(app, "web/src"))) {
    const at = relative(app, file)
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        fromDesktop(node.moduleSpecifier)
      ) {
        taking.add(at)
        const typeOnly = ts.isImportDeclaration(node)
          ? !!node.importClause?.isTypeOnly
          : node.isTypeOnly
        if (!typeOnly) values.push(at)
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        fromDesktop(node.arguments[0])
      )
        values.push(at)
      ts.forEachChild(node, visit)
    }
    visit(
      ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest
      )
    )
  }
  expect(values).toEqual([])
  expect([...taking].sort()).toEqual(BRIDGE_TYPES)
})

/**
 * The paths the core, the bridge's table and the device's adapter left
 * (W0a1, W0a2). W0a1 kept the first five, only re-exporting from the new
 * place, so the open PRs of the time kept building; W0a2 pointed every
 * importer to the new path and took them away. None stands again, and no
 * file of the kit or the page only re-exports what moved.
 */
const LEFT = [
  "client/ui/src/here.ts",
  "client/ui/src/hooks/use-run.ts",
  "client/ui/src/lib/store.ts",
  "client/web/src/host.ts",
  "client/web/src/window/device.ts",
  "client/ui/src/hooks/use-machines.ts",
  "client/web/src/calls/hosts.ts",
]

test("no path the core or the bridge left stands, nor a file that only re-exports what moved", () => {
  expect(LEFT.filter((path) => existsSync(join(root, path)))).toEqual([])
  const boot = join(app, "web/src/boot")
  const moved = (file: string, name: string) =>
    /^@banda\/(core|core\/react|desktop\/bridge)$/.test(name) ||
    (/^\.\.?\//.test(name) && join(dirname(file), name) === boot)
  const standing = [join(app, "ui/src"), join(app, "web/src")]
    .flatMap((folder) => sources(folder, { tests: false }))
    .filter((file) => {
      const { statements } = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest
      )
      return (
        statements.length > 0 &&
        statements.every(
          (statement) =>
            ts.isExportDeclaration(statement) &&
            !!statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            moved(file, statement.moduleSpecifier.text)
        )
      )
    })
    .map((file) => relative(root, file))
    .sort()
  expect(standing).toEqual([])
})

/**
 * What `@banda/ui` names of the core again, by file and name, for the
 * modules that take it from the kit until L3 splits it (ADR 0089,
 * decision 1). The list only falls.
 */
const UI_FROM_CORE = [
  "client/ui/src/lib/projects.ts: openProjects",
  "client/ui/src/lib/projects.ts: shownProjects",
  "client/ui/src/module.ts: Args",
  "client/ui/src/pane.ts: PaneState",
  "client/ui/src/pane.ts: Place",
  "client/ui/src/pane.ts: paneHost",
  "client/ui/src/pane.ts: withHost",
]

test("the kit names the core again only as listed", () => {
  const core = /^@banda\/core(\/react)?$/
  const naming = sources(join(app, "ui/src"), { tests: false })
    .flatMap((file) => {
      const { statements } = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest
      )
      const fromCore = (node: ts.Expression | undefined) =>
        !!node && ts.isStringLiteral(node) && core.test(node.text)
      const taken = new Set(
        statements
          .filter(ts.isImportDeclaration)
          .filter(({ moduleSpecifier }) => fromCore(moduleSpecifier))
          .flatMap(({ importClause }) => {
            const named = importClause?.namedBindings
            return named && ts.isNamedImports(named)
              ? named.elements.map(({ name }) => name.text)
              : []
          })
      )
      return statements
        .filter(ts.isExportDeclaration)
        .flatMap(({ exportClause, moduleSpecifier }) =>
          exportClause && ts.isNamedExports(exportClause)
            ? exportClause.elements
                .filter(({ name, propertyName }) =>
                  moduleSpecifier
                    ? fromCore(moduleSpecifier)
                    : taken.has((propertyName ?? name).text)
                )
                .map(({ name }) => `${relative(root, file)}: ${name.text}`)
            : fromCore(moduleSpecifier)
              ? [`${relative(root, file)}: *`]
              : []
        )
    })
    .sort()
  expect(naming).toEqual(UI_FROM_CORE)
})
