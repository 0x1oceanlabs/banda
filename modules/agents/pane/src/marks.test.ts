import type { ListedThread, TurnView } from "@bandaso/contract/agents"
import { expect, test } from "vitest"
import { attentionOf, callsOf, markOf, settledTurn } from "./marks"

function thread(more: Partial<ListedThread> = {}): ListedThread {
  return {
    id: "t1",
    harness: "fake",
    title: "One",
    updated_at: 1,
    asking: [],
    ...more,
  }
}

const ended = (state: TurnView["state"]) =>
  thread({ latest: { turn: "u1", state } })

test("a Thread asks, works, fails, finishes or rests", () => {
  expect(markOf(thread(), {})).toBe("rest")
  expect(markOf(ended("running"), {})).toBe("running")
  expect(markOf(ended("done"), {})).toBe("done")
  expect(markOf(ended("failed"), {})).toBe("failed")
  expect(markOf(ended("interrupted"), {})).toBe("failed")
  expect(markOf(ended("stopped"), {})).toBe("rest")
  const asking = thread({
    latest: { turn: "u1", state: "running" },
    asking: ["q1"],
  })
  expect(markOf(asking, {})).toBe("asking")
})

test("a turn the Person saw end settles; a Question still asks", () => {
  const seen = { t1: "u1" }
  expect(markOf(ended("done"), seen)).toBe("rest")
  expect(markOf(ended("failed"), seen)).toBe("rest")
  expect(markOf(ended("done"), { t1: "u0" })).toBe("done")
  expect(markOf(thread({ ...ended("done"), asking: ["q1"] }), seen)).toBe(
    "asking"
  )
})

test("a Space calls with its loudest Thread, and counts who waits", () => {
  const threads = [
    ended("running"),
    { ...ended("failed"), id: "t2" },
    { ...ended("done"), id: "t3" },
    { ...thread({ asking: ["q"] }), id: "t4" },
  ]
  expect(attentionOf(threads, {})).toEqual({ mark: "failed", waiting: 2 })
  expect(attentionOf(threads, { t2: "u1" })).toEqual({
    mark: "asking",
    waiting: 1,
  })
  expect(attentionOf([], {})).toEqual({ mark: "rest", waiting: 0 })
})

test("the turn a Person sees settled is the latest that began and ended", () => {
  const turn = (id: string, state: TurnView["state"]): TurnView => ({
    id,
    message: "m",
    state,
  })
  expect(settledTurn([])).toBeUndefined()
  expect(settledTurn([turn("u1", "done"), turn("u2", "running")])).toBe(
    undefined
  )
  expect(
    settledTurn([
      turn("u1", "failed"),
      turn("u2", "withdrawn"),
      turn("u3", "queued"),
    ])
  ).toBe("u1")
})

test("a Thread calls once, when it comes to a mark that calls now", () => {
  const first = callsOf(undefined, [ended("running")], {})
  expect(first.calls).toEqual([])

  const finished = callsOf(first.marks, [ended("done")], {})
  expect(finished.calls.map((c) => c.chime)).toEqual(["done"])
  expect(callsOf(finished.marks, [ended("done")], {}).calls).toEqual([])

  const seen = callsOf(finished.marks, [ended("done")], { t1: "u1" })
  expect(seen.calls).toEqual([])
})

test("what already was when a Watch began does not call", () => {
  const threads = [ended("failed"), { ...thread({ asking: ["q"] }), id: "t2" }]
  expect(callsOf(undefined, threads, {}).calls).toEqual([])
})

test("a new Thread calls from rest; a stopped one never does", () => {
  const before = callsOf(undefined, [], {}).marks
  const asking = { ...thread({ asking: ["q"] }), id: "t2" }
  const now = callsOf(before, [ended("stopped"), asking], {})
  expect(now.calls).toEqual([{ thread: asking, chime: "asking" }])
})
