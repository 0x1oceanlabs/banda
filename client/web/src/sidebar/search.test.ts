import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/lib/mark-state"
import { HOUR, MINUTE } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { type Row, rowsOf } from "./rows"
import type { Finding } from "@banda/ui/module"
import { itemKey } from "./hold"
import { type Block, inboxOf, type Tab } from "./inbox"
import { order } from "./order"
import {
  answered,
  completed,
  finds,
  HERE,
  isOf,
  marked,
  type Names,
  narrows,
  NO_ANSWERS,
  planOf,
  queryOf,
  type Searchable,
  searchedOf,
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
      return `${block.stand}: ${block.rows.map(({ row, found }) => `${row.listed.id}${found ? ` “${found.snippet}”` : ""}`).join(" ")}`
    case "empty":
      return `empty: ${block.tab}${block.words ? ` “${block.words}”` : ""}`
    case "titles-only":
      return `titles only on ${block.machines.join(", ")}`
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

/** What a module's search found of Thread `id`: `snippet`, `word`
 * marked in it. */
const finding = (id: string, snippet: string, word: string): Finding => {
  const from = snippet.indexOf(word)
  return { id, snippet, hits: [{ from, to: from + word.length }], at: NOW }
}

/** This machine, with a Project that lists nothing, and arc. */
const MACHINES: Searchable[] = [
  {
    key: HERE,
    projects: [banda, work, loose, project("p4", "Empty")],
    reached: true,
  },
  { key: "arc", projects: [onArc], reached: true },
]
const ARC_AWAY: Searchable[] = [
  MACHINES[0]!,
  { ...MACHINES[1]!, reached: false },
]
const listedIn = (id: string) => (LISTS[id]?.length ?? 0) > 0
const plan = (text: string, machines = MACHINES, only?: string) =>
  planOf(queryOf(text), machines, listedIn, names, only)

test("the messages: each machine the window reaches is asked for its Projects that list something, as in:, on: and the one Project shown narrow them; one away is read by its titles alone; filters alone ask nothing (S12c)", () => {
  expect(plan("is:failed on:arc")).toBeUndefined()
  const all = plan("Quokka is:failed")!
  expect(all.words).toBe("quokka")
  expect([...all.asks]).toEqual([
    [HERE, ["p1", "p2", "p3"]],
    ["arc", ["p9"]],
  ])
  expect(all.away).toEqual([])
  expect([...plan("quokka in:work")!.asks]).toEqual([[HERE, ["p2"]]])
  expect([...plan("quokka in:no")!.asks]).toEqual([[HERE, ["p3"]]])
  expect([...plan("quokka on:server")!.asks]).toEqual([["arc", ["p9"]]])
  expect([...plan("quokka", MACHINES, "p1")!.asks]).toEqual([[HERE, ["p1"]]])
  // arc away: its titles alone, and another plan.
  const away = plan("quokka", ARC_AWAY)!
  expect([...away.asks.keys()]).toEqual([HERE])
  expect(away.away).toEqual(["arc"])
  expect(away.key).not.toBe(all.key)
  // Narrowed past arc, it has nothing to say of it.
  expect(plan("quokka in:work", ARC_AWAY)!.away).toEqual([])
})

test("the answers: a machine's replaces what it found before; an answer for words no longer typed shows nothing; one that failed is read by its titles alone; until every machine answered, it waits (S12c)", () => {
  const quokka = plan("quokka")!
  let answers = NO_ANSWERS
  expect(searchedOf(answers, undefined)).toBeUndefined()
  expect(searchedOf(answers, quokka)).toEqual({
    found: new Map(),
    on: [HERE, "arc"],
    away: [],
    failed: [],
    pending: true,
  })
  answers = answered(answers, quokka, HERE, [
    finding("seen", "…the quokka sleeps…", "quokka"),
  ])
  expect([...searchedOf(answers, quokka)!.found.keys()]).toEqual([":seen"])
  expect(searchedOf(answers, quokka)!.pending).toBe(true)
  answers = answered(answers, quokka, "arc", [
    finding("arc", "a quokka on arc", "quokka"),
  ])
  expect([...searchedOf(answers, quokka)!.found.keys()]).toEqual([
    ":seen",
    "arc:arc",
  ])
  expect(searchedOf(answers, quokka)!.pending).toBe(false)
  // Asked again, this machine's answer replaces its own.
  answers = answered(answers, quokka, HERE, [])
  expect([...searchedOf(answers, quokka)!.found.keys()]).toEqual(["arc:arc"])

  // Other words: what the old ones found shows nothing, and it waits.
  const more = plan("quokkas")!
  expect(searchedOf(answers, more)).toMatchObject({
    found: new Map(),
    pending: true,
  })
  // The same words, narrowed: what was found stays while it waits.
  const onArc = plan("quokka on:arc")!
  expect(searchedOf(answers, onArc)).toMatchObject({
    on: ["arc"],
    pending: true,
  })
  expect([...searchedOf(answers, onArc)!.found.keys()]).toEqual(["arc:arc"])
  // arc gone away: what it found goes, and its titles alone are read.
  expect(searchedOf(answers, plan("quokka", ARC_AWAY))).toMatchObject({
    found: new Map(),
    on: [HERE],
    away: ["arc"],
  })

  // A machine that failed: its titles alone, what it found before gone.
  answers = answered(answers, quokka, "arc", undefined)
  expect(searchedOf(answers, quokka)).toEqual({
    found: new Map(),
    on: [HERE],
    away: [],
    failed: ["arc"],
    pending: false,
  })
})

test("a Thread a message found, not its title, shows under In messages in All with that message's line, after the titles; the filters narrow it; each tab counts it, and its card has the line there too; the machines read by their titles alone are said under it all (S12c)", () => {
  const query = queryOf("sidebar")
  const messages = new Map(
    [
      finding("fails", "…the sidebar build broke…", "sidebar"),
      finding("nap", "…March's sidebar invoices…", "sidebar"),
      // Found by its title too: one card, by its title.
      finding("seen", "…sidebar notes…", "sidebar"),
    ].map((one) => [`:${one.id}`, one])
  )
  const searched = (text: string, tab: Tab, titlesOnly: string[] = []) => {
    const asked = queryOf(text)
    return order(LISTS, [banda, work, loose], NOW, {
      elsewhere: [{ name: "arc", projects: [onArc] }],
      tab,
      search: {
        words: asked.text,
        found: (row) => finds(asked, row, NOW, names),
        message: (row) => {
          const one = messages.get(itemKey(row))
          return one && narrows(asked, row, NOW, names) ? one : undefined
        },
        titlesOnly,
      },
    })
  }
  const all = searched(query.text, "all", ["arc"])
  expect(all.blocks.map(line)).toEqual([
    "# Titles",
    "turn: asks woke",
    "open: seen",
    "archived: old",
    "# In messages",
    "turn: fails “…the sidebar build broke…”",
    "later: nap “…March's sidebar invoices…”",
    "titles only on arc",
  ])
  expect(all.tabs).toEqual({
    all: { count: 6, calls: false },
    inbox: { count: 4, calls: true },
    working: { count: 0, calls: false },
    later: { count: 1, calls: false },
    archive: { count: 1, calls: false },
  })
  // In its own tab, the card has its line too.
  expect(searched(query.text, "later").blocks.map(line)).toEqual([
    "# Today",
    "later: nap “…March's sidebar invoices…”",
  ])
  // The filters narrow what the messages found.
  expect(searched("sidebar is:later", "all").blocks.map(line)).toEqual([
    "# In messages",
    "later: nap “…March's sidebar invoices…”",
  ])
  // Nothing found: no word of the machines under it; the empty place says
  // where it looked.
  expect(
    searched("sidebar is:working", "all", ["arc"]).blocks.map(line)
  ).toEqual(["empty: search “sidebar is:working”"])
})

test("a snippet in pieces, its words marked where the hits say, in UTF-16 units; a hit out of bounds marks nothing", () => {
  expect(
    marked({
      snippet: "…ёлка и ёлка…",
      hits: [
        { from: 1, to: 5 },
        { from: 8, to: 12 },
      ],
    })
  ).toEqual([
    { text: "…", hit: false },
    { text: "ёлка", hit: true },
    { text: " и ", hit: false },
    { text: "ёлка", hit: true },
    { text: "…", hit: false },
  ])
  expect(
    marked({
      snippet: "abc",
      hits: [
        { from: 2, to: 9 },
        { from: 1, to: 1 },
      ],
    })
  ).toEqual([{ text: "abc", hit: false }])
})
