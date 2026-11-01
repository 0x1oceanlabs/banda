import { describe, expect, test } from "vitest"
import type { SpaceSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Action } from "../actions/actions"
import type { Shell } from "../shell/actions"
import {
  actsOf,
  type Branch,
  type Choice,
  menuOf,
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
const spaces = [{ id: "s1", name: "banda" }] as unknown as SpaceSummary[]
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
  }
}

const labels = (
  words: string,
  at: "root" | "actions" = "root",
  inside?: Branch
) =>
  menuOf({ words, at, inside, sources }).map((group) => [
    group.label,
    group.rows.map(nameOf),
  ])

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

  test("typed into, it finds Threads, Spaces and Actions, then New Thread with the words", () => {
    expect(labels("hello")).toEqual([
      ["Threads", ["hello from claude", "slow hello"]],
      ["", ["ask: hello"]],
    ])
    expect(labels("ban")).toEqual([
      ["Spaces", ["banda"]],
      ["", ["ask: ban"]],
    ])
    expect(labels("new")).toEqual([
      ["Actions", ["New Thread", "New browser"]],
      ["", ["ask: new"]],
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
