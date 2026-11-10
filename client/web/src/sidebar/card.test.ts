import type { ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import type { Row } from "./arrange"
import { cardOf, markSaid, statusOf } from "./card"
import type { Settings } from "./settings"

const listed = (more: Partial<Listed> = {}): Listed => ({
  id: "t",
  title: "t",
  mark: "rest",
  changed: 5,
  pane: { kind: "agents.thread", args: {} },
  ...more,
})
const row = (more: Partial<Row> = {}): Row => ({
  project: { id: "p", name: "banda" } as ProjectSummary,
  listed: listed(),
  stand: "open",
  ...more,
})
const laid = (lines: number, hide: Settings["row"]["hide"] = []): Settings => ({
  ...DEFAULT_SIDEBAR,
  row: { ...DEFAULT_SIDEBAR.row, lines, hide },
})
const here = { inProject: false, elsewhere: false }

test("a layout's lines part at ~ into a left and a right", () => {
  expect(cardOf(row(), laid(3), here).lines).toEqual([
    { left: ["mark", "project"], right: ["status"] },
    { left: ["title"], right: [] },
    { left: ["note"], right: ["harness"] },
  ])
})

test("under its Project's header a card leaves the Project out; hidden, another machine's names its machine", () => {
  const [line] = cardOf(row(), laid(1), { ...here, inProject: true }).lines
  expect(line).toEqual({ left: ["mark", "title"], right: ["status"] })
  const hidden = laid(2, ["project"])
  expect(cardOf(row(), hidden, here).lines[0].left).toEqual(["mark"])
  expect(
    cardOf(row(), hidden, { ...here, elsewhere: true }).lines[0].left
  ).toEqual(["mark", "machine"])
})

test("only the Person's turn and work stand forward", () => {
  const quiet = (stand: Row["stand"]) =>
    cardOf(row({ stand }), laid(1), here).quiet
  expect([
    quiet("turn"),
    quiet("working"),
    quiet("open"),
    quiet("later"),
    quiet("archived"),
  ]).toEqual([false, false, true, true, true])
})

test("the status says the Later, the waking, or the mark", () => {
  expect(
    statusOf(
      listed({ later: { at: 0, until: 9, byAgent: true } }),
      "later",
      undefined
    )
  ).toEqual({ kind: "later", until: 9, byAgent: true })
  expect(statusOf(listed({ later: { at: 0 } }), "later", undefined)).toEqual({
    kind: "later",
    byAgent: false,
  })
  expect(statusOf(listed({ mark: "done" }), "turn", 3)).toEqual({
    kind: "woke",
    at: 3,
    word: "Done",
    tone: "added",
  })
  expect(statusOf(listed(), "turn", 3)).toEqual({
    kind: "woke",
    at: 3,
    tone: "plain",
  })
  expect(markSaid(listed({ mark: "asking" }))).toEqual({
    kind: "word",
    word: "Asks you",
    tone: "attention",
  })
  expect(markSaid(listed({ mark: "done" })).kind).toBe("word")
  expect(markSaid(listed({ mark: "running", began: 2 }))).toEqual({
    kind: "timer",
    from: 2,
  })
  expect(markSaid(listed({ mark: "running" }))).toEqual({ kind: "none" })
  expect(markSaid(listed())).toEqual({ kind: "ago", at: 5 })
})

test("the note says what calls in its colour, or what it was asked, muted", () => {
  const note = (more: Partial<Listed>) =>
    cardOf(row({ listed: listed(more) }), laid(3), here).note
  expect(note({ mark: "asking", calls: "Run it?" })).toEqual({
    text: "Run it?",
    tone: "attention",
  })
  expect(note({ mark: "failed", calls: "Out of tokens" })?.tone).toBe(
    "destructive"
  )
  expect(note({ said: "fix it" })).toEqual({ text: "fix it", tone: "muted" })
  expect(note({})).toBeUndefined()
})
