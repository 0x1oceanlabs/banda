import { expect, test } from "vitest"
import { callsOf, type Listed, sleeps, wokeOf } from "./pane"

const pane = { kind: "agents.thread", args: {} }

test("what asks, failed or finished unseen calls, with what it said", () => {
  const thing = (id: string, mark: Listed["mark"], more = {}): Listed => ({
    id,
    title: id,
    mark,
    changed: 1,
    pane,
    ...more,
  })
  const calls = callsOf({
    s: [
      thing("t1", "running"),
      thing("t2", "asking", { calls: "Run it?", said: "fix it" }),
      thing("t3", "done", { said: "fix the tests" }),
      thing("t4", "rest"),
      thing("t5", "failed"),
    ],
  })
  expect(calls.map((c) => [c.about, c.chime, c.detail])).toEqual([
    ["t2", "asking", "Run it?"],
    ["t3", "done", "fix the tests"],
    ["t5", "failed", undefined],
  ])
  expect(calls[0]).toMatchObject({ key: "s:t2", project: "s", since: 1 })
})

test("a snoozed Thread calls no one while it sleeps, and calls as it wakes", () => {
  const done = (snooze: Listed["snooze"]): Listed => ({
    id: "t",
    title: "t",
    mark: "done",
    changed: 1,
    pane,
    snooze,
  })
  const at = (snooze: Listed["snooze"], now: number) =>
    callsOf({ s: [done(snooze)] }, now).length
  expect(at({ at: 0, until: 100 }, 50), "asleep").toBe(0)
  expect(at({ at: 0, until: 100 }, 100), "its time came").toBe(1)
  expect(at({ at: 0 }, 1e12), "until done, it sleeps on").toBe(0)
  expect(at({ at: 0, woke: { at: 10, by: "done" } }, 50), "woke early").toBe(1)
})

test("a Thread woke by itself when its time came or a call woke it", () => {
  expect(wokeOf({ until: 100 }, 50), "asleep").toBeUndefined()
  expect(wokeOf({ until: 100 }, 150)).toBe(100)
  expect(wokeOf({ woke: { at: 70, by: "question" } }, 80)).toBe(70)
  expect(
    wokeOf({ woke: { at: 70, by: "woken" } }, 80),
    "by hand"
  ).toBeUndefined()
  expect(
    wokeOf({ woke: { at: 70, by: "message" } }, 80),
    "it was written to"
  ).toBeUndefined()
  expect(sleeps({}, 1e12), "until done").toBe(true)
})
