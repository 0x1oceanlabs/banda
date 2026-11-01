import { describe, expect, test } from "vitest"
import type { SpaceSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Action } from "../actions/actions"
import type { Shell } from "../shell/actions"
import { menuOf, ranked } from "./menu"

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

const labels = (words: string, at: "root" | "actions" = "root") =>
  menuOf({ words, at, lists, spaces, actions }).map((group) => [
    group.label,
    group.rows.map((row) =>
      row.kind === "thread"
        ? row.listed.title
        : row.kind === "space"
          ? row.space.name
          : row.kind === "action"
            ? row.action.title
            : `ask: ${row.words}`
    ),
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
      ["Actions", ["New Thread", "New browser", "Show or hide the sidebar"]],
    ])
    expect(labels("side", "actions")).toEqual([
      ["Actions", ["Show or hide the sidebar"]],
    ])
  })

  test("its rows run in the order the list shows", () => {
    const groups = menuOf({
      words: "hello",
      at: "root",
      lists,
      spaces,
      actions,
    })
    expect(groups.flatMap((g) => g.rows).map((row) => row.id)).toEqual([
      "thread:s1:t2",
      "thread:s1:t3",
      "ask",
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
