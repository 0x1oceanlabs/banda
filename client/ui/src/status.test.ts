import { expect, test } from "vitest"
import type { Listed } from "./pane"
import type { MarkState } from "./lib/mark-state"
import {
  attentionOf,
  callsOf,
  headerLookOf,
  lookOf,
  mayArchive,
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
  ["runs", { mark: "running" }, "working"],
  ["thinks", { mark: "thinking" }, "working"],
  ["asleep, failed", { mark: "failed", later: { at: 0, until: 1e3 } }, "later"],
  [
    "asleep until done, at work",
    { mark: "running", later: { at: 0 } },
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
  ["runs", { mark: "running" }, "running"],
  ["thinks", { mark: "thinking" }, "thinking"],
  ["is put off", { mark: "done", later: { at: 0, until: 1e3 } }, "later"],
  ["is put off until done", { mark: "running", later: { at: 0 } }, "later"],
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
  expect(lookOf(thing(more), 100)).toEqual({ look })
})

test("a Pane's header takes the look, and one open and seen rests there", () => {
  expect(headerLookOf(thing(), 100)).toBe("rest")
  expect(headerLookOf(thing({ mark: "done" }), 100)).toBe("done")
  expect(headerLookOf(thing({ later: { at: 0, until: 10 } }), 100)).toBe("woke")
  expect(
    headerLookOf(thing({ mark: "done", later: { at: 0, until: 1e3 } }), 100)
  ).toBe("later")
})

test("work going on, or a question, cannot be archived", () => {
  expect(mayArchive(thing({ mark: "running" }))).toBe(false)
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
      thing({ id: "c", mark: "running" }),
    ],
  }
  expect(attentionOf(lists, 100)).toEqual({ mark: "running", waiting: 0 })
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
      one("t1", "running"),
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
