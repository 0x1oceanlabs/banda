import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/lib/mark-state"
import { HOUR, MINUTE } from "@banda/ui/lib/words"
import type { Listed, Lists } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { expect, test } from "vitest"
import { rowsOf } from "./rows"
import {
  ARCHIVE_SHOWN,
  type Block,
  type Inbox,
  inboxOf,
  type InboxView,
  SHELF,
} from "./inbox"

const project = (
  id: string,
  name: string,
  scratch = false
): ProjectSummary => ({
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
})
const banda = project("p1", "banda")
const work = project("p2", "Work")
const loose = project("p3", "Scratch", true)
// Another machine's Project, of the same name as this one's.
const onMac = project("p9", "banda")

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const NOW = new Date(2026, 10, 10, 15, 0).getTime()
const ago = (ms: number) => NOW - ms
/** `days` after today, at `hour:minute`, by the local clock. */
const on = (days: number, hour: number, minute = 0) =>
  new Date(2026, 10, 10 + days, hour, minute).getTime()

const listed = (
  id: string,
  mark: MarkState,
  changed: number,
  more: Partial<Listed> = {}
): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

/** One Thread in every place, on two machines, as their Apps list them. */
const LISTS: Lists = {
  p1: [
    listed("asks", "asking", ago(14 * MINUTE)),
    listed("done", "done", ago(40 * MINUTE)),
    // Its time came 10 minutes ago, long after it last changed.
    listed("woke", "rest", ago(5 * HOUR), {
      later: { at: ago(5 * HOUR), until: ago(10 * MINUTE) },
    }),
    listed("seen", "rest", ago(2 * HOUR)),
    listed("build", "running", ago(MINUTE), { began: ago(30 * MINUTE) }),
    listed("nap", "rest", ago(HOUR), {
      later: { at: ago(HOUR), until: on(0, 18, 30) },
    }),
    listed("dream", "rest", ago(3 * HOUR), {
      later: { at: ago(3 * HOUR), someday: true },
    }),
    listed("old", "rest", on(-2, 9), { archived: true }),
  ],
  p2: [
    listed("invoices", "failed", ago(4 * MINUTE)),
    listed("font", "rest", ago(20 * MINUTE)),
    listed("tests", "running", ago(MINUTE), { began: ago(5 * MINUTE) }),
    listed("trip", "rest", ago(2 * HOUR), {
      later: { at: ago(2 * HOUR), until: on(1, 9) },
    }),
    // Put off until its turn ends, while it still works.
    listed("report", "running", ago(MINUTE), {
      began: ago(HOUR),
      later: { at: ago(HOUR) },
    }),
    listed("letter", "rest", ago(HOUR), {
      later: { at: ago(HOUR), until: on(3, 9) },
    }),
    listed("today", "rest", ago(HOUR), { archived: true }),
  ],
  p3: [listed("jot", "done", ago(HOUR))],
  p9: [
    listed("ship", "asking", ago(30 * MINUTE)),
    listed("lint", "running", ago(MINUTE), { began: ago(HOUR) }),
  ],
}

/** The rows as the sidebar takes them: each where `status.ts` says it
 * stands, this machine's, then the Mac's. */
const rowsIn = (lists: Lists) => [
  ...rowsOf(lists, [banda, work, loose], NOW),
  ...rowsOf(lists, [onMac], NOW, "mac"),
]
const ROWS = rowsIn(LISTS)

/** The blocks, a line each, as a Person would read them. */
const shape = ({ blocks }: Pick<Inbox, "blocks">) => blocks.map(line)
function line(block: Block): string {
  switch (block.kind) {
    case "head":
      return `# ${block.label}${block.count === undefined ? "" : ` · ${block.count}`}`
    case "group":
      return `[${block.key}] ${block.waiting} wait, ${block.working} work${block.folded ? ", folded" : ""}`
    case "divider":
      return "---"
    case "rows":
      return `${block.stand}: ${block.rows.map(({ row }) => row.listed.id).join(" ")}`
    case "more":
      return `+ ${block.count} ${block.of}`
    case "zero": {
      const next = block.next === undefined ? "" : `, next ${block.next}`
      const someday =
        block.someday === undefined ? "" : `, ${block.someday} someday`
      return `zero: ${block.working} at work${next}${someday}`
    }
    case "empty":
      return `empty: ${block.tab}`
  }
}

/** Each card's Thread and the moment its time counts from, top down: of
 * the place `stand`, or of every place. */
const times = ({ blocks }: Pick<Inbox, "blocks">, stand?: Stand) =>
  blocks.flatMap((block) =>
    block.kind === "rows" && (stand === undefined || block.stand === stand)
      ? block.rows.map(({ row, at }): [string, number] => [row.listed.id, at])
      : []
  )

const INBOX = [
  "# Your turn · 6",
  "turn: jot done ship asks woke invoices",
  "---",
  "open: font seen",
  "# Working · 3",
  "working: lint build tests",
]
const BY_PROJECT = [
  "[project:p1] 3 wait, 1 work",
  "turn: done asks woke",
  "---",
  "open: seen",
  "working: build",
  "[project:mac/p9] 1 wait, 1 work",
  "turn: ship",
  "working: lint",
  "[project:p2] 1 wait, 1 work",
  "turn: invoices",
  "---",
  "open: font",
  "working: tests",
  "[project:none] 1 wait, 0 work",
  "turn: jot",
]
const LATER = [
  "# Today",
  "later: nap",
  "# Tomorrow",
  "later: trip",
  "# Later",
  "later: letter",
  "# Someday",
  "later: dream",
  "# When done",
  "later: report",
]
const ARCHIVE = ["# Today", "archived: today", "# Earlier", "archived: old"]

test.each<[string, InboxView, string[]]>([
  [
    "the Inbox: Your turn oldest first, Open newest under a divider, then the shelf",
    { tab: "inbox" },
    INBOX,
  ],
  [
    "the Inbox, newest first",
    { tab: "inbox", order: "newest" },
    [
      "# Your turn · 6",
      "turn: invoices woke asks ship done jot",
      ...INBOX.slice(2),
    ],
  ],
  [
    "the Inbox by Project: by name, no Project's last, each with its places",
    { tab: "inbox", group: "project" },
    BY_PROJECT,
  ],
  [
    "the Inbox by Project, newest first",
    { tab: "inbox", group: "project", order: "newest" },
    BY_PROJECT.map((at) =>
      at === "turn: done asks woke" ? "turn: woke asks done" : at
    ),
  ],
  [
    "the Inbox by machine: this one's first",
    { tab: "inbox", group: "machine" },
    [
      "[machine:] 5 wait, 2 work",
      "turn: jot done asks woke invoices",
      "---",
      "open: font seen",
      "working: build tests",
      "[machine:mac] 1 wait, 1 work",
      "turn: ship",
      "working: lint",
    ],
  ],
  [
    "the Inbox without Open and the shelf",
    { tab: "inbox", open: false, working: false },
    ["# Your turn · 6", "turn: jot done ship asks woke invoices"],
  ],
  [
    "Working: every Thread at work, by when it began",
    { tab: "working", order: "newest" },
    ["working: lint build tests"],
  ],
  [
    "Working by Project",
    { tab: "working", group: "project" },
    [
      "[project:p1] 0 wait, 1 work",
      "working: build",
      "[project:mac/p9] 0 wait, 1 work",
      "working: lint",
      "[project:p2] 0 wait, 1 work",
      "working: tests",
    ],
  ],
  [
    "Working by machine",
    { tab: "working", group: "machine" },
    [
      "[machine:] 0 wait, 2 work",
      "working: build tests",
      "[machine:mac] 0 wait, 1 work",
      "working: lint",
    ],
  ],
  [
    "Later by the local day, Someday and When done last",
    { tab: "later" },
    LATER,
  ],
  ["Later is not grouped", { tab: "later", group: "project" }, LATER],
  [
    "Archive: the last archived first, under Today and Earlier",
    { tab: "archive" },
    ARCHIVE,
  ],
  ["Archive is not grouped", { tab: "archive", group: "machine" }, ARCHIVE],
])("%s", (_, view, blocks) => {
  expect(shape(inboxOf(ROWS, view, NOW))).toEqual(blocks)
})

test("each tab counts its own: the Inbox Your turn and Open, and calls while Your turn has cards", () => {
  const { tabs } = inboxOf(ROWS, { tab: "later" }, NOW)
  expect(tabs).toEqual({
    inbox: { count: 8, calls: true },
    working: { count: 3, calls: false },
    later: { count: 5, calls: false },
    archive: { count: 2, calls: false },
  })
  // Open left out of the Inbox is not counted there.
  expect(inboxOf(ROWS, { tab: "inbox", open: false }, NOW).tabs.inbox).toEqual({
    count: 6,
    calls: true,
  })
  const settled = rowsIn({ p1: [listed("seen", "rest", ago(HOUR))] })
  expect(inboxOf(settled, { tab: "inbox" }, NOW).tabs.inbox).toEqual({
    count: 1,
    calls: false,
  })
})

test("Alt+U and the counts walk Your turn oldest first, whatever the order, the groups or the folds", () => {
  const view: InboxView = {
    tab: "inbox",
    order: "newest",
    group: "project",
    folded: new Set(["project:p1"]),
  }
  expect(inboxOf(ROWS, view, NOW).keys).toEqual([
    "p3:jot",
    "p1:done",
    "p9:ship",
    "p1:asks",
    "p1:woke",
    "p2:invoices",
    "p2:font",
    "p1:seen",
    "p9:lint",
    "p1:build",
    "p2:tests",
  ])
})

test("a folded group keeps its rollup and hides its rows", () => {
  const view: InboxView = {
    tab: "inbox",
    group: "project",
    folded: new Set(["project:p1"]),
  }
  const blocks = inboxOf(ROWS, view, NOW).blocks
  expect(shape({ blocks }).slice(0, 2)).toEqual([
    "[project:p1] 3 wait, 1 work, folded",
    "[project:mac/p9] 1 wait, 1 work",
  ])
  expect(blocks[0]).toMatchObject({ project: banda, mark: "asking" })
  // Another machine's group names it; no Project's names no Project.
  expect(blocks.find((block) => block.key === "project:mac/p9")).toMatchObject({
    project: onMac,
    host: "mac",
  })
  const none = blocks.find((block) => block.key === "project:none")
  expect(none).not.toHaveProperty("project")
})

test("grouped by machine, each machine is a header, this one's naming none, another's its name, and none names a Project", () => {
  const blocks = inboxOf(ROWS, { tab: "inbox", group: "machine" }, NOW).blocks
  const groups = blocks.filter((block) => block.kind === "group")
  expect(groups.map((group) => [group.key, group.host])).toEqual([
    ["machine:", undefined],
    ["machine:mac", "mac"],
  ])
  for (const group of groups) expect(group).not.toHaveProperty("project")
})

test("a group's rollup says how many wait and how many work, and the loudest of what calls, folded or not: never a Thread at work's", () => {
  const rollup = (lists: Lists, folded: boolean) => {
    const rows = rowsIn(lists)
    const view: InboxView = {
      tab: "inbox",
      group: "project",
      folded: new Set(folded ? ["project:p1"] : []),
    }
    const [group] = inboxOf(rows, view, NOW).blocks
    return group?.kind === "group"
      ? [group.mark, group.waiting, group.working, group.folded]
      : undefined
  }
  // Failed is louder than a question, and both than Done.
  const calls = {
    p1: [
      listed("asks", "asking", ago(14 * MINUTE)),
      listed("done", "done", ago(40 * MINUTE)),
      listed("broke", "failed", ago(MINUTE)),
      listed("build", "running", ago(MINUTE), { began: ago(30 * MINUTE) }),
    ],
  }
  expect(rollup(calls, true)).toEqual(["failed", 3, 1, true])
  expect(rollup(calls, false)).toEqual(["failed", 3, 1, false])
  // One that woke rings as its card does.
  const woke = {
    p1: [
      listed("done", "done", ago(40 * MINUTE)),
      listed("woke", "rest", ago(5 * HOUR), {
        later: { at: ago(5 * HOUR), until: ago(10 * MINUTE) },
      }),
    ],
  }
  expect(rollup(woke, true)).toEqual(["woke", 2, 0, true])
  // What only works and is open calls no one: its mark rests.
  const quiet = {
    p1: [
      listed("seen", "rest", ago(2 * HOUR)),
      listed("build", "running", ago(MINUTE), { began: ago(30 * MINUTE) }),
    ],
  }
  expect(rollup(quiet, true)).toEqual(["rest", 0, 1, true])
})

test("the shelf shows its first six, then how many more; asked, all of them", () => {
  const busy = rowsIn({
    p1: Array.from({ length: SHELF + 2 }, (_, i) =>
      listed(`w${i}`, "running", ago(MINUTE), { began: ago((10 - i) * MINUTE) })
    ),
  })
  expect(shape(inboxOf(busy, { tab: "inbox" }, NOW))).toEqual([
    "zero: 8 at work",
    "# Working · 8",
    "working: w0 w1 w2 w3 w4 w5",
    "+ 2 working",
  ])
  expect(shape(inboxOf(busy, { tab: "inbox", more: true }, NOW))).toEqual([
    "zero: 8 at work",
    "# Working · 8",
    "working: w0 w1 w2 w3 w4 w5 w6 w7",
  ])
  // The Working tab shows every one.
  expect(shape(inboxOf(busy, { tab: "working" }, NOW))).toEqual([
    "working: w0 w1 w2 w3 w4 w5 w6 w7",
  ])
})

test("the Archive draws the last 200, then Show older; asked, all of them", () => {
  const many = rowsIn({
    p1: Array.from({ length: ARCHIVE_SHOWN + 1 }, (_, i) =>
      listed(`a${i}`, "rest", on(-1, 12) - i * MINUTE, { archived: true })
    ),
  })
  const cut = inboxOf(many, { tab: "archive" }, NOW).blocks
  expect(cut.at(-1)).toEqual({
    kind: "more",
    key: "archived:more",
    of: "archived",
    count: 1,
  })
  expect(cut.flatMap((b) => (b.kind === "rows" ? b.rows : []))).toHaveLength(
    ARCHIVE_SHOWN
  )
  const all = inboxOf(many, { tab: "archive", more: true }, NOW).blocks
  expect(all.map((block) => block.kind)).toEqual(["head", "rows"])
})

test("a tab with nothing says so; the Inbox with nothing is inbox zero", () => {
  const blocks = (tab: InboxView["tab"]) => shape(inboxOf([], { tab }, NOW))
  expect(blocks("inbox")).toEqual(["zero: 0 at work"])
  expect(blocks("working")).toEqual(["empty: working"])
  expect(blocks("later")).toEqual(["empty: later"])
  expect(blocks("archive")).toEqual(["empty: archive"])
})

test("inbox zero says how many work and when the next wakes by its time", () => {
  const calm = rowsIn({
    p1: [
      listed("build", "running", ago(MINUTE), { began: ago(HOUR) }),
      listed("old", "rest", ago(HOUR), { archived: true }),
      // Put off until done: it wakes by no time.
      listed("report", "running", ago(MINUTE), { later: { at: ago(HOUR) } }),
      listed("trip", "rest", ago(HOUR), {
        later: { at: ago(HOUR), until: on(1, 9) },
      }),
      listed("nap", "rest", ago(HOUR), {
        later: { at: ago(HOUR), until: on(0, 18, 30) },
      }),
    ],
  })
  const inbox = inboxOf(calm, { tab: "inbox" }, NOW)
  expect(inbox.zero).toEqual({ working: 1, next: on(0, 18, 30) })
  expect(shape(inbox)).toEqual([
    `zero: 1 at work, next ${on(0, 18, 30)}`,
    "# Working · 1",
    "working: build",
  ])
  // Inbox zero is told on every tab, for what reads it there.
  expect(inboxOf(calm, { tab: "later" }, NOW).zero).toEqual(inbox.zero)
  // Something that is the Person's is no zero.
  expect(inboxOf(ROWS, { tab: "inbox" }, NOW).zero).toBeUndefined()
  // Open left out of the Inbox leaves it at zero.
  const open = rowsIn({ p1: [listed("seen", "rest", ago(HOUR))] })
  expect(inboxOf(open, { tab: "inbox", open: false }, NOW).zero).toEqual({
    working: 0,
  })
})

test("inbox zero says how many sleep until Someday once a week, from Monday", () => {
  const dreaming = rowsIn({
    p1: ["a", "b"].map((id) =>
      listed(id, "rest", ago(HOUR), {
        later: { at: ago(9 * 24 * HOUR), someday: true },
      })
    ),
  })
  const zero = (someday?: number) =>
    inboxOf(dreaming, { tab: "inbox", someday }, NOW).zero
  expect(zero()).toEqual({ working: 0, someday: 2 })
  // Told on Sunday night, last week: this week has not been told.
  expect(zero(on(-2, 23))).toEqual({ working: 0, someday: 2 })
  // Told this Monday morning: not again this week.
  expect(zero(on(-1, 9))).toEqual({ working: 0 })
})

test("Woke counts from when it woke, and a Thread woken by hand goes to the top of Open", () => {
  const rows = rowsIn({
    p1: [
      // Its time came while it slept since five hours ago.
      listed("woke", "rest", ago(5 * HOUR), {
        later: { at: ago(5 * HOUR), until: ago(10 * MINUTE) },
      }),
      // A question woke it early.
      listed("asked", "asking", ago(3 * MINUTE), {
        later: {
          at: ago(HOUR),
          until: on(1, 9),
          woke: { at: ago(3 * MINUTE), by: "question" },
        },
      }),
      listed("call", "done", ago(20 * MINUTE)),
      listed("seen", "rest", ago(30 * MINUTE)),
      // Its Person woke it a minute ago: no call, so Open.
      listed("woken", "rest", ago(2 * HOUR), {
        later: {
          at: ago(2 * HOUR),
          until: on(1, 9),
          woke: { at: ago(MINUTE), by: "woken" },
        },
      }),
    ],
  })
  const inbox = inboxOf(rows, { tab: "inbox" }, NOW)
  expect(times(inbox, "turn")).toEqual([
    ["call", ago(20 * MINUTE)],
    ["woke", ago(10 * MINUTE)],
    ["asked", ago(3 * MINUTE)],
  ])
  expect(times(inbox, "open")).toEqual([
    ["woken", ago(MINUTE)],
    ["seen", ago(30 * MINUTE)],
  ])
})

test("a call after it woke counts from the call, not the wake", () => {
  const rows = rowsIn({
    p1: [
      listed("call", "asking", ago(10 * MINUTE)),
      // Put off while at work, its time came half an hour ago; it
      // finished five minutes ago, and its Person has not looked since.
      listed("finished", "done", ago(5 * MINUTE), {
        later: {
          at: ago(HOUR),
          until: ago(30 * MINUTE),
          woke: { at: ago(30 * MINUTE), by: "time" },
        },
      }),
    ],
  })
  const inbox = inboxOf(rows, { tab: "inbox" }, NOW)
  expect(times(inbox, "turn")).toEqual([
    ["call", ago(10 * MINUTE)],
    ["finished", ago(5 * MINUTE)],
  ])
  expect(inbox.keys).toEqual(["p1:call", "p1:finished"])
})

test("each place's time counts from its own moment", () => {
  const at = (view: InboxView) =>
    Object.fromEntries(times(inboxOf(ROWS, view, NOW)))
  expect(at({ tab: "inbox" })).toMatchObject({
    // A call, from the call; Woke, from when it woke.
    asks: ago(14 * MINUTE),
    woke: ago(10 * MINUTE),
    // Open, from its last change.
    seen: ago(2 * HOUR),
    // At work, from when its turn began, not its last change.
    build: ago(30 * MINUTE),
  })
  expect(at({ tab: "later" })).toMatchObject({
    // Later, from its wake time, or when it was put off with none.
    nap: on(0, 18, 30),
    dream: ago(3 * HOUR),
    report: ago(HOUR),
  })
})

test("the Archive counts from when each was archived, not its last change", () => {
  const rows = rowsIn({
    p1: [
      listed("yesterday", "rest", on(-1, 9), {
        archived: true,
        archivedAt: on(-1, 10),
      }),
      listed("lunch", "done", ago(3 * HOUR), {
        archived: true,
        archivedAt: ago(2 * HOUR),
      }),
      // Last changed three days ago, archived a minute ago.
      listed("stale", "rest", on(-3, 9), {
        archived: true,
        archivedAt: ago(MINUTE),
      }),
    ],
  })
  const inbox = inboxOf(rows, { tab: "archive" }, NOW)
  expect(shape(inbox)).toEqual([
    "# Today",
    "archived: stale lunch",
    "# Earlier",
    "archived: yesterday",
  ])
  expect(times(inbox)).toEqual([
    ["stale", ago(MINUTE)],
    ["lunch", ago(2 * HOUR)],
    ["yesterday", on(-1, 10)],
  ])
})

// What the prototype's own rules did, read from what the Apps list.
test("the one the Person saw becomes Open, at the top", () => {
  const before = rowsIn({
    p1: [
      listed("done", "done", ago(10 * MINUTE)),
      listed("older", "rest", ago(HOUR)),
    ],
  })
  expect(shape(inboxOf(before, { tab: "inbox" }, NOW))).toEqual([
    "# Your turn · 1",
    "turn: done",
    "---",
    "open: older",
  ])
  // Seen, its App lists it at rest: it calls no more.
  const after = rowsIn({
    p1: [
      listed("done", "rest", ago(10 * MINUTE)),
      listed("older", "rest", ago(HOUR)),
    ],
  })
  expect(shape(inboxOf(after, { tab: "inbox" }, NOW))).toEqual([
    "open: done older",
  ])
})

test("unread puts it back in Your turn at its call's own time", () => {
  const calls = [
    listed("first", "failed", ago(30 * MINUTE)),
    listed("last", "asking", ago(10 * MINUTE)),
  ]
  const seen = rowsIn({
    p1: [...calls, listed("read", "rest", ago(20 * MINUTE))],
  })
  expect(shape(inboxOf(seen, { tab: "inbox" }, NOW)).slice(0, 2)).toEqual([
    "# Your turn · 2",
    "turn: first last",
  ])
  const unread = rowsIn({
    p1: [...calls, listed("read", "done", ago(20 * MINUTE))],
  })
  expect(shape(inboxOf(unread, { tab: "inbox" }, NOW))).toEqual([
    "# Your turn · 3",
    "turn: first read last",
  ])
})

test("an answer sends it to Working, last, by when its turn began", () => {
  const asking = listed("asks", "asking", ago(10 * MINUTE))
  const busy = listed("busy", "running", ago(MINUTE), { began: ago(HOUR) })
  expect(
    shape(inboxOf(rowsIn({ p1: [asking, busy] }), { tab: "inbox" }, NOW))
  ).toEqual(["# Your turn · 1", "turn: asks", "# Working · 1", "working: busy"])
  const answered = { ...asking, mark: "running" as const, began: NOW }
  expect(
    shape(inboxOf(rowsIn({ p1: [answered, busy] }), { tab: "inbox" }, NOW))
  ).toEqual(["zero: 2 at work", "# Working · 2", "working: busy asks"])
})
