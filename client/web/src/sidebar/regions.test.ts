import type { ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import type { Row } from "./rows"
import { inboxOf, type InboxView } from "./inbox"
import { type Region, regionsOf } from "./regions"

const project = (id: string, name: string, scratch = false) =>
  ({ id, name, folder: `/${id}`, scratch }) as ProjectSummary
const banda = project("p1", "banda")
const loose = project("p2", "Scratch", true)

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()

const row = (
  id: string,
  stand: Stand,
  more: {
    project?: ProjectSummary
    host?: string
    listed?: Partial<Listed>
  } = {}
): Row => ({
  project: more.project ?? banda,
  listed: {
    id,
    title: id,
    mark:
      stand === "turn" ? "asking" : stand === "working" ? "running" : "rest",
    changed: NOW - 60_000,
    pane: { kind: "agents.thread", args: { thread: id } },
    ...more.listed,
  } as Listed,
  stand,
  ...(more.host === undefined ? {} : { host: more.host }),
})

const rows = [
  row("ask", "turn"),
  row("read", "open"),
  ...Array.from({ length: 8 }, (_, i) => row(`run${i}`, "working")),
]

/** Each region's label, and its blocks' kinds and keys. */
const shape = (regions: Region[]) =>
  regions.map((region) => [
    region.label,
    region.host,
    region.blocks.map((block) => `${block.kind} ${block.key}`),
  ])
const of = (all: Row[], view: InboxView) =>
  regionsOf(inboxOf(all, view, NOW).blocks)

test("the Inbox: Your turn and Open as the Person's Threads, the divider between, then the Working shelf with what it leaves out", () => {
  expect(shape(of(rows, { tab: "inbox" }))).toEqual([
    [
      "Threads",
      undefined,
      ["head turn:head", "rows turn", "divider divider", "rows open"],
    ],
    [
      "Working",
      undefined,
      ["head working:head", "rows working", "more working:more"],
    ],
  ])
})

test("a place's region keeps its key as the blocks in it come and go: the Person's Threads as Your turn empties, Later as its first day does", () => {
  const keys = (all: Row[], view: InboxView) =>
    of(all, view).map((region) => region.key)
  const read = row("read", "open")
  expect(keys([row("ask", "turn"), read], { tab: "inbox" })).toEqual(
    keys([read], { tab: "inbox" })
  )
  const soon = row("soon", "later", {
    listed: { later: { at: 0, until: NOW + 60_000 } },
  })
  const someday = row("one day", "later", {
    listed: { later: { at: 0, someday: true } },
  })
  expect(keys([soon, someday], { tab: "later" })).toEqual(
    keys([someday], { tab: "later" })
  )
})

test("inbox zero and an empty tab stand alone, with no label, as their words name them", () => {
  const zero = of([row("run", "working")], { tab: "inbox" })
  expect(shape(zero)).toEqual([
    [undefined, undefined, ["zero zero"]],
    ["Working", undefined, ["head working:head", "rows working"]],
  ])
  expect(shape(of([], { tab: "later" }))).toEqual([
    [undefined, undefined, ["empty later:empty"]],
  ])
})

test("Later and the Archive: each day's head over its cards, in one region", () => {
  const later = [
    row("soon", "later", { listed: { later: { at: 0, until: NOW + 60_000 } } }),
    row("one day", "later", { listed: { later: { at: 0, someday: true } } }),
  ]
  expect(shape(of(later, { tab: "later" }))).toEqual([
    [
      "Later",
      undefined,
      [
        "head later:today:head",
        "rows later:today",
        "head later:someday:head",
        "rows later:someday",
      ],
    ],
  ])
  const archived = [row("old", "archived"), row("older", "archived")]
  expect(shape(of(archived, { tab: "archive" }))).toEqual([
    ["Archive", undefined, ["head archive:today:head", "rows archive:today"]],
  ])
})

test("grouped by Project, each group is a region under its header, named by its Project, on its machine; No Project's last", () => {
  const all = [
    row("ask", "turn"),
    row("loose", "open", { project: loose }),
    row("far", "turn", { project: banda, host: "arc" }),
    row("read", "open"),
  ]
  const regions = of(all, { tab: "inbox", group: "project" })
  expect(shape(regions)).toEqual([
    [
      "banda",
      undefined,
      [
        "rows project:p1:turn",
        "divider project:p1:divider",
        "rows project:p1:open",
      ],
    ],
    ["banda", "arc", ["rows project:arc/p1:turn"]],
    ["No Project", undefined, ["rows project:none:open"]],
  ])
  expect(regions.map((region) => region.group?.key)).toEqual([
    "project:p1",
    "project:arc/p1",
    "project:none",
  ])
  // A folded group keeps its header and draws none of its cards.
  const folded = of(all, {
    tab: "inbox",
    group: "project",
    folded: new Set(["project:p1"]),
  })
  expect(folded[0]?.group?.folded).toBe(true)
  expect(folded[0]?.blocks).toEqual([])
})
