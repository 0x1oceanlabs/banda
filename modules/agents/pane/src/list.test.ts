import type { ThreadList } from "@bandaso/contract/agents"
import { expect, test } from "vitest"
import { applyThreads } from "./list"
import { event, person } from "./testing"

const empty: ThreadList = { at: 0, threads: [] }

test("a new Thread joins the list once, with its Harness", () => {
  const started = event(
    "thread.started",
    { thread: "t1", title: "Hello", harness: "claude" },
    { subject: "t1" }
  )
  const state = [started, started].reduce(applyThreads, empty)
  expect(state.threads).toEqual([
    { id: "t1", harness: "claude", title: "Hello", updated_at: started.at },
  ])
})

test("a Thread from an older log names no Harness", () => {
  const started = event(
    "thread.started",
    { thread: "t1", agent: "a1", title: "Hello" },
    { subject: "t1" }
  )
  expect(applyThreads(empty, started).threads[0].harness).toBe("")
})

test("a Thread that hears a message moves to the top", () => {
  const state: ThreadList = {
    at: 2,
    threads: [
      { id: "t2", harness: "fake", title: "Two", updated_at: 2 },
      { id: "t1", harness: "fake", title: "One", updated_at: 1 },
    ],
  }
  const posted = event(
    "message.posted",
    { item: "m", turn: "u", text: "again" },
    { author: person, subject: "t1" }
  )
  const moved = applyThreads(state, posted)
  expect(moved.threads.map((t) => t.id)).toEqual(["t1", "t2"])
  const growing = event(
    "reply.grew",
    { item: "r", turn: "u", text: "…" },
    { subject: "t1" }
  )
  expect(applyThreads(moved, growing)).toBe(moved)
})
