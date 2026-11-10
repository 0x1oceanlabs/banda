import { expect, test } from "vitest"
import type { ListedLater } from "../pane"
import { sleeps, wokeOf } from "./later"

test("a Thread woke by itself when its time came or a call woke it", () => {
  expect(wokeOf({ until: 100 }, 50), "asleep").toBeUndefined()
  expect(wokeOf({ until: 100 }, 150)).toBe(100)
  expect(wokeOf({ woke: { at: 70, by: "question" } }, 80)).toBe(70)
  expect(wokeOf({ woke: { at: 120, by: "time" } }, 130)).toBe(120)
  expect(
    wokeOf({ woke: { at: 70, by: "woken" } }, 80),
    "by hand"
  ).toBeUndefined()
  expect(
    wokeOf({ woke: { at: 70, by: "message" } }, 80),
    "it was written to"
  ).toBeUndefined()
})

test("until done and Someday keep no time: they sleep on till something wakes them (ADR 0098, decision 12)", () => {
  const someday: ListedLater = { at: 0, someday: true }
  expect(sleeps({}, 1e12), "until done").toBe(true)
  expect(sleeps(someday, 1e12), "Someday").toBe(true)
  expect(wokeOf(someday, 1e12), "no time comes for Someday").toBeUndefined()
  const asked: ListedLater = { ...someday, woke: { at: 70, by: "question" } }
  expect(sleeps(asked, 80), "a question woke it").toBe(false)
})
