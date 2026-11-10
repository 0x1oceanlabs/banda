import type { Listed, Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { nextWake } from "./later"

const thread = (id: string, later?: Listed["later"]): Listed => ({
  id,
  title: id,
  mark: "rest",
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...(later ? { later } : {}),
})

test("the Later clock waits for the first time to come, and never for Someday or until done (ADR 0098, decision 12)", () => {
  const lists: Lists = {
    p: [
      thread("someday", { at: 0, someday: true }),
      thread("done", { at: 0 }),
      thread("later", { at: 0, until: 900 }),
      thread("sooner", { at: 0, until: 300 }),
      thread("awake"),
    ],
  }
  expect(nextWake(lists, 100)).toBe(300)
  expect(nextWake(lists, 500), "the sooner one woke").toBe(900)
  expect(nextWake(lists, 1_000), "only those with no time sleep").toBe(
    undefined
  )
  expect(
    nextWake({ p: [thread("someday", { at: 0, someday: true })] }, 100)
  ).toBe(undefined)
})

test("one a call woke early waits for no clock", () => {
  const woke = thread("woke", {
    at: 0,
    until: 900,
    woke: { at: 50, by: "question" },
  })
  expect(nextWake({ p: [woke] }, 100)).toBe(undefined)
})
