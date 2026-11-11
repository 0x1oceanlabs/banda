import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/lib/mark-state"
import { HOUR, MINUTE } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { type Row, rowsOf } from "./rows"
import { type Block, inboxOf, type Tab } from "./inbox"
import {
  completed,
  finds,
  isOf,
  type Names,
  queryOf,
  typing,
  valuesOf,
} from "./search"

const project = (id: string, name: string, scratch = false) =>
  ({
    id,
    name,
    folder: `/${id}`,
    pinned: false,
    archived: false,
    sees_others: false,
    sign: { kind: "letters", text: name[0], picked: false },
    trusted: true,
    scratch,
    missing: false,
  }) as ProjectSummary
const banda = project("p1", "banda")
const work = project("p2", "Work")
const loose = project("p3", "Scratch", true)
const onArc = project("p9", "dots")

const NOW = new Date(2026, 10, 11, 15, 0).getTime()
const ago = (ms: number) => NOW - ms

const listed = (
  id: string,
  title: string,
  mark: MarkState,
  more: Partial<Listed> = {}
): Listed => ({
  id,
  title,
  mark,
  changed: ago(10 * MINUTE),
  pane: { kind: "agents.thread", args: { thread: id } },
  harness: "claude",
  by: "Claude Code",
  ...more,
})

/** A Thread in each place, on this machine, "mac", and on arc. */
const LISTS: Lists = {
  p1: [
    listed("asks", "Move sidebar settings", "asking"),
    listed("fails", "Fix the failing build", "failed"),
    listed("done", "Café menu copy", "done", { seen: false }),
    listed("woke", "Résumé the sidebar audit", "rest", {
      later: { at: ago(5 * HOUR), until: ago(10 * MINUTE) },
    }),
    listed("seen", "Sidebar notes", "rest"),
  ],
  p2: [
    listed("build", "Bench the window tests", "working", {
      began: ago(MINUTE),
      harness: "codex",
      by: "Codex",
    }),
    listed("nap", "Invoices for March", "rest", {
      later: { at: ago(HOUR), until: NOW + 3 * HOUR },
    }),
    listed("old", "Old sidebar sketch", "rest", { archived: true }),
  ],
  p3: [listed("jot", "Jot a thought", "done", { seen: false })],
  p9: [listed("arc", "Fix the dots theme", "failed")],
}

const ROWS: Row[] = [
  ...rowsOf(LISTS, [banda, work, loose], NOW),
  ...rowsOf(LISTS, [onArc], NOW, "arc"),
]

/** This machine says it is "mac"; arc says it is "Arc Server". */
const names: Names = (host) =>
  host === undefined ? ["mac"] : host === "arc" ? ["arc", "Arc Server"] : []

/** The Threads `text` finds, by their ids, in the rows' order. */
const found = (text: string) =>
  ROWS.filter((row) => finds(queryOf(text), row, NOW, names)).map(
    (row) => row.listed.id
  )

test("a search reads its words and its filters; any other word with a colon is a word, and a filter with no value yet takes all", () => {
  expect(queryOf("  Fix  is:Failed on:arc  ")).toEqual({
    text: "Fix  is:Failed on:arc",
    words: ["fix"],
    filters: { is: ["failed"], on: ["arc"] },
  })
  expect(queryOf("is:asking is:failed")).toMatchObject({
    filters: { is: ["asking", "failed"] },
  })
  expect(queryOf("todo:later is:")).toEqual({
    text: "todo:later is:",
    words: ["todo:later"],
    filters: {},
  })
})

test("titles: every word, in any case and with or without accents", () => {
  expect(found("sidebar")).toEqual(["asks", "woke", "seen", "old"])
  expect(found("SIDEBAR notes")).toEqual(["seen"])
  expect(found("resume")).toEqual(["woke"])
  expect(found("cafe")).toEqual(["done"])
  expect(found("café")).toEqual(["done"])
  expect(found("zed")).toEqual([])
  // A filter typed with no value yet takes every Thread.
  expect(found("is:")).toHaveLength(ROWS.length)
})

test("is: takes where a Thread stands, or what its card calls, by the start of the word", () => {
  const is = (row: Row) => isOf(row, NOW)
  expect(
    Object.fromEntries(ROWS.map((row) => [row.listed.id, is(row)]))
  ).toEqual({
    asks: "asking",
    fails: "failed",
    done: "done",
    woke: "woke",
    seen: undefined,
    build: "working",
    nap: "later",
    old: "archived",
    jot: "done",
    arc: "failed",
  })
  expect(found("is:failed")).toEqual(["fails", "arc"])
  expect(found("is:fa")).toEqual(["fails", "arc"])
  expect(found("is:asking is:woke")).toEqual(["asks", "woke"])
  expect(found("is:nothing")).toEqual([])
})

test("in:, on: and by: take a part of the name, any of their values, and every filter holds at once", () => {
  expect(found("in:work")).toEqual(["build", "nap", "old"])
  expect(found("in:no")).toEqual(["jot"])
  // This machine by the name it says; arc by its name in hosts.toml or
  // its own.
  expect(found("on:mac")).toHaveLength(ROWS.length - 1)
  expect(found("on:arc")).toEqual(["arc"])
  expect(found("on:server")).toEqual(["arc"])
  expect(found("by:codex")).toEqual(["build"])
  expect(found("by:claude in:work")).toEqual(["nap", "old"])
  expect(found("is:failed on:arc")).toEqual(["arc"])
  expect(found("fix is:failed on:mac")).toEqual(["fails"])
  expect(found("in:banda in:work is:working")).toEqual(["build"])
})

test("the hint narrows to the filter typed last, and a value picked completes it", () => {
  expect(typing("")).toBeUndefined()
  expect(typing("fix")).toBeUndefined()
  expect(typing("fix is:")).toBe("is")
  expect(typing("fix is:fa")).toBe("is")
  expect(typing("is:failed ")).toBeUndefined()
  expect(completed("fix is:fa", "is", "failed")).toBe("fix is:failed ")
  expect(completed("", "on", "arc")).toBe("on:arc ")
  expect(completed("fix ", "in", "No Project")).toBe("fix in:No ")
  // A filter alone, for its value to be typed; a word typed stays.
  expect(completed("fix", "by")).toBe("fix by:")
  expect(completed("fix is:", "on")).toBe("fix on:")
})

test("the hint offers where a Thread stands, then the Projects, the machines and the Harnesses listed, each once", () => {
  expect(valuesOf(ROWS, "mac")).toEqual({
    is: ["asking", "failed", "done", "woke", "working", "later", "archived"],
    in: ["banda", "dots", "No Project", "Work"],
    on: ["mac", "arc"],
    by: ["claude", "codex"],
  })
  expect(valuesOf([], undefined).on).toEqual([])
})

/** The blocks of `tab` for what `text` finds, a line each. */
function shape(text: string, tab: Tab) {
  const query = queryOf(text)
  const rows = ROWS.filter((row) => finds(query, row, NOW, names))
  const inbox = inboxOf(rows, { tab, search: query.text }, NOW)
  return { tabs: inbox.tabs, blocks: inbox.blocks.map(line) }
}
function line(block: Block): string {
  switch (block.kind) {
    case "head":
      return `# ${block.label}`
    case "rows":
      return `${block.stand}: ${block.rows.map(({ row }) => row.listed.id).join(" ")}`
    case "empty":
      return `empty: ${block.tab}${block.words ? ` “${block.words}”` : ""}`
    default:
      return block.kind
  }
}

test("while a search runs, All shows what it found in every place under one head, each tab counts its own, and no inbox zero (ADR 0098, decision 17)", () => {
  const { tabs, blocks } = shape("sidebar", "all")
  expect(blocks).toEqual([
    "# Titles",
    "turn: asks woke",
    "open: seen",
    "archived: old",
  ])
  expect(tabs).toEqual({
    all: { count: 4, calls: false },
    inbox: { count: 3, calls: true },
    working: { count: 0, calls: false },
    later: { count: 0, calls: false },
    archive: { count: 1, calls: false },
  })
  // The Inbox finds what it holds, and no inbox zero where it holds none.
  expect(shape("sidebar", "inbox").blocks).toEqual([
    "# Your turn",
    "turn: asks woke",
    "divider",
    "open: seen",
  ])
  expect(shape("invoices", "inbox").blocks).toEqual([
    "empty: search “invoices”",
  ])
  expect(shape("invoices", "later").blocks).toEqual(["# Today", "later: nap"])
  // No match anywhere says the words, in every tab.
  expect(shape("zed", "all").blocks).toEqual(["empty: search “zed”"])
  expect(shape("zed", "working").blocks).toEqual(["empty: search “zed”"])
  expect(shape("zed", "all").tabs.all).toEqual({ count: 0, calls: false })
  // With no search, no All, and an empty tab says what goes there.
  const plain = inboxOf(ROWS, { tab: "inbox" }, NOW)
  expect(plain.tabs.all).toBeUndefined()
})
