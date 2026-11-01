import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { isSettled, settles } from "./settled"

const NOW = 1_000_000_000_000
const DAY = 24 * 60 * 60 * 1000

const listed = (mark: MarkState, changed: number): Listed => ({
  id: "t",
  title: "t",
  mark,
  changed,
  pane: { kind: "agents.thread", args: { thread: "t" } },
})

test("three quiet days settle a Thread by itself, unless it asks", () => {
  expect(isSettled(listed("rest", NOW - 2 * DAY), undefined, NOW)).toBe(false)
  expect(isSettled(listed("rest", NOW - 4 * DAY), undefined, NOW)).toBe(true)
  expect(isSettled(listed("done", NOW - 4 * DAY), undefined, NOW)).toBe(true)
  expect(isSettled(listed("asking", NOW - 4 * DAY), undefined, NOW)).toBe(false)
})

test("what the Person said holds until something new happens", () => {
  const put = { settled: true, at: NOW - DAY }
  expect(isSettled(listed("rest", NOW - 2 * DAY), put, NOW)).toBe(true)
  // A new message, a turn that ended: it is back.
  expect(isSettled(listed("done", NOW - 1), put, NOW)).toBe(false)

  const kept = { settled: false, at: NOW - DAY }
  expect(isSettled(listed("rest", NOW - 5 * DAY), kept, NOW)).toBe(false)
})

test("work going on is never settled, nor can be", () => {
  const put = { settled: true, at: NOW }
  expect(isSettled(listed("running", NOW - 5 * DAY), put, NOW)).toBe(false)
  expect(settles(listed("running", NOW))).toBe(false)
  expect(settles(listed("asking", NOW))).toBe(false)
  expect(settles(listed("done", NOW))).toBe(true)
})
