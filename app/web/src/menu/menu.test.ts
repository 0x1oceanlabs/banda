import { describe, expect, test } from "vitest"
import type { SpaceId, SpaceSummary } from "@banda/contract"
import type { BrowserArgs } from "@banda/browser-pane"
import type { Listed, PaneState } from "@banda/ui/pane"
import type { Action } from "../actions/actions"
import type { Shell } from "../shell/actions"
import {
  actsOf,
  type Branch,
  type Choice,
  menuOf,
  openingOf,
  ranked,
  type Sources,
} from "./menu"

const thread = (id: string, title: string, more: Partial<Listed> = {}) =>
  ({
    id,
    title,
    mark: "idle",
    changed: 0,
    pane: { kind: "agents.thread", args: { thread: id } },
    ...more,
  }) as Listed

const lists = {
  s1: [
    thread("t1", "Fix the login form", { changed: 1, said: "the button" }),
    thread("t2", "hello from claude", { changed: 3 }),
    thread("t3", "slow hello", { changed: 2, mark: "done" }),
  ],
}
const spaces = [
  { id: "s1", name: "banda", folder: "/home/r/banda" },
] as unknown as SpaceSummary[]
const action = (id: string, title: string): Action<Shell> => ({
  id,
  title,
  run: () => {},
})
const actions = [
  action("thread.new", "New Thread"),
  action("browser.new", "New browser"),
  action("sidebar.toggle", "Show or hide the sidebar"),
]

const sources: Sources = {
  lists,
  spaces,
  actions,
  presets: { names: ["inbox", "spaces", "places"], current: "inbox" },
  harnesses: [
    { id: "claude", name: "Claude Code" },
    { id: "codex", name: "Codex" },
  ],
  settled: (listed) => listed.id === "t3",
  files: { space: "s1" as SpaceId, paths: [] },
  addressOf: (typed) =>
    typed.includes(".") ? `https://${typed}` : `search:${typed}`,
  weight: () => 0,
}

function nameOf(row: Choice): string {
  switch (row.kind) {
    case "thread":
      return row.listed.title
    case "space":
      return row.space.name
    case "views":
      return "Sidebar view"
    case "action":
      return row.action.title
    case "ask":
      return ["ask:", row.words, row.space && `in ${row.space}`]
        .filter(Boolean)
        .join(" ")
    case "preset":
      return row.current ? `${row.name} ✓` : row.name
    case "settle":
      return `settle ${row.listed.id}`
    case "file":
      return `file ${row.path}`
    case "web":
      return row.address ? `open ${urlOf(row.pane)}` : `search: ${row.words}`
    case "copy":
      return `copy ${row.text}`
  }
}

/** The page a browser Pane opens at. */
const urlOf = (pane: PaneState) => (pane.args as BrowserArgs).tabs[0].url

const labels = (
  words: string,
  at: "root" | "actions" = "root",
  inside?: Branch,
  more: Partial<Sources> = {}
) =>
  menuOf({ words, at, inside, sources: { ...sources, ...more } }).map(
    (group) => [group.label, group.rows.map(nameOf)]
  )

describe("the Banda menu", () => {
  test("empty, it shows the Recent Threads, what waits first, and Actions", () => {
    expect(labels("")).toEqual([
      [
        "Recent Threads",
        ["slow hello", "hello from claude", "Fix the login form"],
      ],
      ["Actions", ["New Thread", "New browser"]],
    ])
  })

  test("typed into, it finds Threads, Spaces and Actions, then New Thread and the web with the words", () => {
    expect(labels("hello")).toEqual([
      ["Threads", ["hello from claude", "slow hello"]],
      ["", ["ask: hello", "search: hello"]],
    ])
    expect(labels("ban")).toEqual([
      ["Spaces", ["banda"]],
      ["", ["ask: ban", "search: ban"]],
    ])
    expect(labels("new")).toEqual([
      ["Actions", ["New Thread", "New browser"]],
      ["", ["ask: new", "search: new"]],
    ])
  })

  test("an address typed opens; words search the web where the browser says", () => {
    expect(labels("banda.so").at(-1)).toEqual([
      "",
      ["ask: banda.so", "open https://banda.so"],
    ])
    const web = menuOf({ words: "two words", at: "root", sources })
      .at(-1)!
      .rows.at(-1)
    expect(web).toMatchObject({ kind: "web", address: false })
    expect(web?.kind === "web" && urlOf(web.pane)).toBe("search:two words")
  })

  test("the focused Space's files come between its Spaces and the Actions", () => {
    const files = { space: "s1" as SpaceId, paths: ["src/new.ts", "a b#.md"] }
    expect(labels("new", "root", undefined, { files })).toEqual([
      ["Files", ["file src/new.ts", "file a b#.md"]],
      ["Actions", ["New Thread", "New browser"]],
      ["", ["ask: new", "search: new"]],
    ])
    const [, odd] = menuOf({
      words: "new",
      at: "root",
      sources: { ...sources, files },
    })[0].rows
    expect(odd).toMatchObject({ full: "/home/r/banda/a b#.md" })
    expect(odd.kind === "file" && urlOf(odd.pane)).toBe(
      "file:///home/r/banda/a%20b%23.md"
    )
    expect(actsOf(odd, sources).map((act) => nameOf(act.row))).toEqual([
      "file a b#.md",
      "copy /home/r/banda/a b#.md",
    ])
  })

  test("what is chosen often and lately ranks first among equals, and leads the empty Actions", () => {
    const weight = (id: string) =>
      ({ "action:browser.new": 4, "action:sidebar.toggle": 1 })[id] ?? 0
    expect(labels("new", "root", undefined, { weight })[0]).toEqual([
      "Actions",
      ["New browser", "New Thread"],
    ])
    expect(labels("", "root", undefined, { weight }).at(-1)).toEqual([
      "Actions",
      ["New browser", "Show or hide the sidebar", "New Thread"],
    ])
  })

  test("a Thread is found by what it was asked too", () => {
    expect(labels("button")[0]).toEqual(["Threads", ["Fix the login form"]])
  })

  test("opened at its Actions, it is the key sheet: every action, and no more", () => {
    expect(labels("", "actions")).toEqual([
      [
        "Actions",
        [
          "New Thread",
          "New browser",
          "Show or hide the sidebar",
          "Sidebar view",
        ],
      ],
    ])
    expect(labels("side", "actions")).toEqual([
      ["Actions", ["Sidebar view", "Show or hide the sidebar"]],
    ])
  })

  test("its rows run in the order the list shows", () => {
    const groups = menuOf({ words: "hello", at: "root", sources })
    expect(groups.flatMap((g) => g.rows).map((row) => row.id)).toEqual([
      "thread:s1:t2",
      "thread:s1:t3",
      "ask",
      "web",
    ])
  })
})

describe("its branches and acts", () => {
  const space: Branch = { kind: "space", id: "space:s1", space: spaces[0] }
  test("a Space holds a new Thread there, then its Threads", () => {
    expect(labels("", "root", space)).toEqual([
      ["", ["ask: in s1"]],
      ["Threads", ["slow hello", "hello from claude", "Fix the login form"]],
    ])
    expect(labels("form", "root", space)).toEqual([
      ["", ["ask: form in s1"]],
      ["Threads", ["Fix the login form"]],
    ])
  })

  test("the sidebar's view holds its presets, the one in force ticked", () => {
    expect(labels("view")[0]).toEqual(["Actions", ["Sidebar view"]])
    const views: Branch = { kind: "views", id: "views" }
    expect(labels("", "root", views)).toEqual([
      ["", ["inbox ✓", "spaces", "places"]],
    ])
  })

  test("Tab on a Thread opens it, beside, or settles it", () => {
    const [t3, t2] = menuOf({ words: "", at: "root", sources })[0].rows
    expect(actsOf(t2, sources).map((act) => act.title)).toEqual([
      "Open",
      "Open beside",
      "Settle thread",
    ])
    expect(actsOf(t3, sources).at(-1)?.title).toBe("Un-settle thread")
  })

  test("Tab on New Thread starts it on any Harness", () => {
    const ask = menuOf({ words: "x", at: "root", sources }).at(-1)!.rows[0]
    expect(
      actsOf(ask, sources).map((act) => [act.title, nameOf(act.row)])
    ).toEqual([
      ["Start on Claude Code", "ask: x"],
      ["Start on Codex", "ask: x"],
    ])
  })
})

describe("ranking", () => {
  const titles = ["a slow hello", "hello world", "hello", "say hellos", "help"]
  test("the text itself, then its start, then a word's start, then every word in it", () => {
    expect(ranked(titles, "hello", (t) => [t])).toEqual([
      "hello",
      "hello world",
      "a slow hello",
      "say hellos",
    ])
    expect(ranked(titles, "slow hel", (t) => [t])).toEqual(["a slow hello"])
  })
  test("among equal matches the one that weighs more comes first", () => {
    expect(
      ranked(
        ["hello a", "hello b"],
        "hello",
        (t) => [t],
        (t) => (t === "hello b" ? 1 : 0)
      )
    ).toEqual(["hello b", "hello a"])
  })
  test("a match in the first text beats one in the second", () => {
    const things = [
      ["other", "login"],
      ["login", ""],
    ]
    expect(ranked(things, "login", (t) => t)).toEqual([
      ["login", ""],
      ["other", "login"],
    ])
  })
})

describe("banda menu ROUTE", () => {
  const where = (route: string) => {
    const { at, path, words } = openingOf(route, spaces)
    return [at, path.map((branch) => branch.id), words]
  }
  test("opens at the root, the Actions, the sidebar's view or a Space", () => {
    expect(where("")).toEqual(["root", [], ""])
    expect(where("actions")).toEqual(["actions", [], ""])
    expect(where("views")).toEqual(["root", ["views"], ""])
    expect(where("space.Banda")).toEqual(["root", ["space:s1"], ""])
    expect(where("space.s1")).toEqual(["root", ["space:s1"], ""])
  })
  test("other words, and a Space there is not, are typed in", () => {
    expect(where(" fix the login ")).toEqual(["root", [], "fix the login"])
    expect(where("space.nope")).toEqual(["root", [], "space.nope"])
  })
})
