import { expect, test } from "vitest"
import type { Listed } from "./pane"
import type { MarkDoing, MarkState } from "./lib/mark-state"
import {
  attentionOf,
  awayAtWork,
  callsOf,
  type Does,
  doesOf,
  type Held,
  heldDoing,
  headerLookOf,
  hostsAway,
  lookOf,
  mayArchive,
  nextStuck,
  sameDoes,
  type Stand,
  standOf,
} from "./status"

const pane = { kind: "agents.thread", args: {} }

const thing = (more: Partial<Listed> = {}): Listed => ({
  id: "t",
  title: "t",
  mark: "rest",
  changed: 1,
  pane,
  ...more,
})

// Every reader takes where a Thread stands from here: the list, the bar's
// Mark and counts, Alt+U and the dots (ADR 0098, decision 26).
test.each<[string, Partial<Listed>, Stand]>([
  ["asks", { mark: "asking" }, "turn"],
  ["failed", { mark: "failed" }, "turn"],
  ["done, unseen", { mark: "done" }, "turn"],
  ["woke by its time", { later: { at: 0, until: 10 } }, "turn"],
  ["woke, seen", { later: { at: 0, until: 10, wokeSeen: true } }, "open"],
  ["woken by hand", { later: { at: 0, woke: { at: 5, by: "woken" } } }, "open"],
  [
    "asks, put off by its Person",
    { mark: "asking", later: { at: 0, until: 1e3 } },
    "later",
  ],
  [
    "asks, woke by its time",
    { mark: "asking", later: { at: 0, until: 10 } },
    "turn",
  ],
  ["sleeps Someday", { later: { at: 0, someday: true } }, "later"],
  [
    "slept Someday till a question",
    {
      mark: "asking",
      later: { at: 0, someday: true, woke: { at: 5, by: "question" } },
    },
    "turn",
  ],
  ["rests", {}, "open"],
  ["works", { mark: "working" }, "working"],
  ["asleep, failed", { mark: "failed", later: { at: 0, until: 1e3 } }, "later"],
  [
    "asleep until done, at work",
    { mark: "working", later: { at: 0 } },
    "later",
  ],
  ["archived", { archived: true }, "archived"],
  ["archived with a Done unseen", { mark: "done", archived: true }, "archived"],
])("a Thread that %s stands in %s", (_, more, stand) => {
  expect(standOf(thing(more), 100)).toBe(stand)
})

// One look for every reader (ADR 0099, decisions 1 and 12): where it
// stands, its mark, and whether it woke from Later, and how.
test.each<[string, Partial<Listed>, MarkState]>([
  ["asks", { mark: "asking" }, "asking"],
  ["failed", { mark: "failed" }, "failed"],
  ["is done, unseen", { mark: "done" }, "done"],
  ["is open, seen", {}, "idle"],
  ["works", { mark: "working" }, "working"],
  ["is put off", { mark: "done", later: { at: 0, until: 1e3 } }, "later"],
  ["is put off until done", { mark: "working", later: { at: 0 } }, "later"],
  ["is archived", { archived: true }, "later"],
  ["woke by its time", { later: { at: 0, until: 10 } }, "woke"],
  [
    "asked, and woke by its time",
    { mark: "asking", later: { at: 0, until: 10 } },
    "woke",
  ],
  [
    "woke by its time, as the host says",
    { mark: "failed", later: { at: 0, woke: { at: 10, by: "time" } } },
    "woke",
  ],
  [
    "was woken early by a question",
    { mark: "asking", later: { at: 0, woke: { at: 10, by: "question" } } },
    "asking",
  ],
  [
    "was put off until done and is done",
    { mark: "done", later: { at: 0, woke: { at: 10, by: "done" } } },
    "done",
  ],
  [
    "was put off until done and stopped",
    { later: { at: 0, woke: { at: 10, by: "done" } } },
    "woke",
  ],
  ["woke, seen", { later: { at: 0, until: 10, wokeSeen: true } }, "idle"],
  [
    "was woken by hand",
    { later: { at: 0, woke: { at: 5, by: "woken" } } },
    "idle",
  ],
])("a Thread that %s looks %s", (_, more, look) => {
  expect(lookOf(thing(more), 100).look).toBe(look)
})

const MIN = 60_000

// ADR 0099, decision 2: a working Mark shows what its Agent does, as the
// engine says it, the first that holds of a limit, silence and compacting.
test.each<[string, Partial<Listed>, MarkDoing]>([
  ["has said nothing yet", {}, "other"],
  ["reads", { doing: { what: "read", since: 0 } }, "read"],
  ["edits", { doing: { what: "edit", since: 0 } }, "edit"],
  ["deletes, as an edit", { doing: { what: "delete", since: 0 } }, "edit"],
  ["moves, as an edit", { doing: { what: "move", since: 0 } }, "edit"],
  ["searches", { doing: { what: "search", since: 0 } }, "search"],
  ["runs a command", { doing: { what: "execute", since: 0 } }, "execute"],
  ["thinks", { doing: { what: "think", since: 0 } }, "think"],
  ["fetches", { doing: { what: "fetch", since: 0 } }, "fetch"],
  ["replies", { doing: { what: "reply", since: 0 } }, "reply"],
  [
    "does what has no look of its own",
    { doing: { what: "other", since: 0 } },
    "other",
  ],
  [
    "compacts its context",
    { compacting: true, doing: { what: "read", since: 0 } },
    "compacting",
  ],
  [
    "said something under 3 minutes ago",
    { stepped: 1, doing: { what: "execute", since: 0 } },
    "execute",
  ],
  [
    "said nothing for 3 minutes",
    { stepped: 0, compacting: true, doing: { what: "execute", since: 0 } },
    "stuck",
  ],
  [
    "waits on its usage limit",
    { limitUntil: 9 * MIN, stepped: 0, doing: { what: "read", since: 0 } },
    "limit",
  ],
])("a working Thread that %s shows %s", (_, more, doing) => {
  expect(lookOf(thing({ mark: "working", ...more }), 3 * MIN)).toEqual({
    look: "working",
    doing,
  })
})

test("only a Mark at work shows a doing", () => {
  const reads = { doing: { what: "read", since: 0 } } as const
  expect(lookOf(thing({ mark: "done", ...reads }), 100)).toEqual({
    look: "done",
  })
  // Put off until done, it sleeps.
  expect(
    lookOf(thing({ mark: "working", later: { at: 0 }, ...reads }), 100)
  ).toEqual({ look: "later" })
})

test("the list's clock wakes once, as the first silent Thread at work gets stuck", () => {
  const lists = {
    s: [
      thing({ id: "a", mark: "working", stepped: 5 * MIN }),
      thing({ id: "b", mark: "working", stepped: 2 * MIN }),
      thing({ id: "c", mark: "working" }),
      thing({ id: "d", mark: "done", stepped: 0 }),
    ],
    t: [thing({ id: "e", mark: "working", stepped: 0 })],
  }
  // `e` is stuck already; `b` is next.
  expect(nextStuck(lists, 4 * MIN)).toBe(5 * MIN)
  expect(nextStuck(lists, 5 * MIN)).toBe(8 * MIN)
  expect(nextStuck(lists, 8 * MIN)).toBeUndefined()
})

// A doing holds at least 1.5 s; one replaced sooner is never shown.
test("a doing holds 1.5 s, and one replaced within it is skipped", () => {
  let held: Held | undefined
  const at = (next: MarkDoing | undefined, now: number) =>
    (held = heldDoing(held, next, now)).doing
  // The first shows at once.
  expect(at("read", 0)).toBe("read")
  // A change after 0.3 s waits.
  expect(at("execute", 300)).toBe("read")
  expect(at("execute", 1499)).toBe("read")
  expect(at("execute", 1500)).toBe("execute")
  // Edit, replaced by fetch before execute's 1.5 s are up, never shows.
  expect(at("edit", 2000)).toBe("execute")
  expect(at("fetch", 2500)).toBe("execute")
  expect(at("fetch", 3000)).toBe("fetch")
  expect(held).toEqual({ doing: "fetch", since: 3000 })
  // The same doing again changes nothing.
  expect(heldDoing(held, "fetch", 9000)).toBe(held)
})

// What a card says of it: the kind of what its turn does and what on, or
// when its limit lets it go on and since when it said nothing.
test("what a working Thread does, as its card says it", () => {
  const does = (more: Partial<Listed>) =>
    doesOf(thing({ mark: "working", ...more }), 3 * MIN)
  expect(does({})).toEqual({ doing: "other" })
  expect(
    does({ doing: { what: "delete", title: "x.ts", since: 0 }, stepped: MIN })
  ).toEqual({ doing: "edit", kind: "delete", on: "x.ts" })
  expect(does({ doing: { what: "think", since: 0 } })).toEqual({
    doing: "think",
    kind: "think",
  })
  expect(does({ compacting: true })).toEqual({ doing: "compacting" })
  expect(does({ stepped: 0 })).toEqual({ doing: "stuck", at: 0 })
  expect(does({ limitUntil: 9 * MIN, stepped: 0 })).toEqual({
    doing: "limit",
    at: 9 * MIN,
  })
})

// A card's words hold as its Mark does, and change as what it works on
// does too: another command is held as another kind would be.
test("a card's doing holds 1.5 s by its kind and what it works on", () => {
  const runs = (on: string): Does => ({ doing: "execute", kind: "execute", on })
  let held: Held<Does> | undefined
  const at = (next: Does, now: number) =>
    (held = heldDoing(held, next, now, sameDoes)).doing.on
  expect(at(runs("pnpm test"), 0)).toBe("pnpm test")
  expect(at(runs("cargo build"), 300)).toBe("pnpm test")
  expect(at(runs("cargo build"), 1500)).toBe("cargo build")
  // The same, made anew, changes nothing.
  const same = held
  expect(heldDoing(same, runs("cargo build"), 9000, sameDoes)).toBe(same)
  expect(sameDoes({ doing: "stuck", at: 0 }, { doing: "stuck", at: MIN })).toBe(
    false
  )
})

test("a Pane's header takes the look, and one open and seen rests there", () => {
  expect(headerLookOf(thing(), 100)).toEqual({ look: "rest" })
  expect(headerLookOf(thing({ mark: "done" }), 100)).toEqual({ look: "done" })
  expect(headerLookOf(thing({ later: { at: 0, until: 10 } }), 100)).toEqual({
    look: "woke",
  })
  expect(
    headerLookOf(thing({ mark: "done", later: { at: 0, until: 1e3 } }), 100)
  ).toEqual({ look: "later" })
  expect(
    headerLookOf(
      thing({ mark: "working", doing: { what: "edit", since: 0 } }),
      100
    )
  ).toEqual({ look: "working", doing: "edit" })
})

test("work going on, or a question, cannot be archived", () => {
  expect(mayArchive(thing({ mark: "working" }))).toBe(false)
  expect(mayArchive(thing({ mark: "asking" }))).toBe(false)
  expect(mayArchive(thing({ mark: "done" }))).toBe(true)
  expect(mayArchive(thing())).toBe(true)
})

test("an archived Thread with a Done unseen is no Call: Alt+U skips it", () => {
  expect(callsOf({ s: [thing({ mark: "done", archived: true })] }, 0)).toEqual(
    []
  )
})

test("the bar's Mark leaves out what is Later or archived", () => {
  const lists = {
    s: [
      thing({ id: "a", mark: "failed", later: { at: 0, until: 1e3 } }),
      thing({ id: "b", mark: "done", archived: true }),
      thing({ id: "c", mark: "working" }),
    ],
  }
  expect(attentionOf(lists, 100)).toEqual({ mark: "working", waiting: 0 })
  // Back by its time, it shows that it woke, louder than work.
  expect(attentionOf(lists, 2e3), "the Later woke").toEqual({
    mark: "woke",
    waiting: 1,
  })
})

test("the bar's Mark shows the loudest look: a failure over a Thread that woke", () => {
  const lists = {
    s: [
      thing({ id: "a", later: { at: 0, until: 10 } }),
      thing({ id: "b", mark: "done" }),
    ],
  }
  expect(attentionOf(lists, 100)).toEqual({ mark: "woke", waiting: 2 })
  const failing = { s: [...lists.s, thing({ id: "c", mark: "failed" })] }
  expect(attentionOf(failing, 100)).toEqual({ mark: "failed", waiting: 3 })
})

test("at work on a machine out of reach, a Thread sleeps where it stands, and the bar's Mark with it; what asks there is still the Person's turn (ADR 0098, decision 18)", () => {
  const working = thing({ id: "a", mark: "working", host: "arc", away: true })
  const asks = thing({ id: "b", mark: "asking", host: "arc", away: true })
  const later = thing({
    id: "c",
    mark: "working",
    host: "arc",
    away: true,
    later: { at: 0, until: 1e3 },
  })
  const there = thing({ id: "d", mark: "working", host: "mac" })
  expect(standOf(working, 0)).toBe("working")
  expect(lookOf(working, 0)).toEqual({ look: "offline" })
  expect(standOf(asks, 0)).toBe("turn")
  expect(lookOf(asks, 0)).toEqual({ look: "asking" })
  expect(lookOf(later, 0)).toEqual({ look: "later" })
  expect(lookOf(there, 0).look).toBe("working")
  // The logo sleeps only for a machine away with Agents at work.
  expect(attentionOf({ s: [working, asks, there] }, 0)).toEqual({
    mark: "offline",
    waiting: 1,
  })
  expect(attentionOf({ s: [asks, later, there] }, 0)).toEqual({
    mark: "asking",
    waiting: 1,
  })
  const lists = { s: [working, asks, later, there] }
  expect(awayAtWork(lists, 0)).toEqual(new Map([["arc", 1]]))
  expect(hostsAway(lists)).toEqual(new Set(["arc"]))
  expect(hostsAway({ s: [there] }).size).toBe(0)
})

test("waiting is the Person's turn: what asks, failed, is done, or woke", () => {
  const lists = {
    s: [
      thing({ id: "a", mark: "asking" }),
      thing({ id: "b", mark: "done" }),
      thing({ id: "c", later: { at: 0, until: 10 } }),
      thing({ id: "d" }),
    ],
  }
  expect(attentionOf(lists, 100)).toEqual({ mark: "asking", waiting: 3 })
})

test("what asks, failed or finished unseen calls, with what it said", () => {
  const one = (id: string, mark: Listed["mark"], more = {}): Listed =>
    thing({ id, title: id, mark, ...more })
  const calls = callsOf({
    s: [
      one("t1", "working"),
      one("t2", "asking", { calls: "Run it?", said: "fix it" }),
      one("t3", "done", { said: "fix the tests" }),
      one("t4", "rest"),
      one("t5", "failed"),
    ],
  })
  expect(calls.map((c) => [c.about, c.chime, c.detail])).toEqual([
    ["t2", "asking", "Run it?"],
    ["t3", "done", "fix the tests"],
    ["t5", "failed", undefined],
  ])
  expect(calls[0]).toMatchObject({ key: "s:t2", project: "s", since: 1 })
})

test("a call carries its asker, and no call without one has the field", () => {
  const asking = (id: string, asker?: string): Listed =>
    thing({ id, mark: "asking", ...(asker ? { asker } : {}) })
  const [theirs, own] = callsOf({ s: [asking("t1", "Reviewer"), asking("t2")] })
  expect(theirs).toMatchObject({ about: "t1", asker: "Reviewer" })
  expect(own).not.toHaveProperty("asker")
})

test("a put-off Thread calls no one while it sleeps, and calls as it wakes", () => {
  const done = (later: Listed["later"]): Listed =>
    thing({ mark: "done", later })
  const at = (later: Listed["later"], now: number) =>
    callsOf({ s: [done(later)] }, now).length
  expect(at({ at: 0, until: 100 }, 50), "asleep").toBe(0)
  expect(at({ at: 0, until: 100 }, 100), "its time came").toBe(1)
  expect(at({ at: 0 }, 1e12), "until done, it sleeps on").toBe(0)
  expect(at({ at: 0, woke: { at: 10, by: "done" } }, 50), "woke early").toBe(1)
})
