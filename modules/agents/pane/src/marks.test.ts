import type { ListedThread, TurnView } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { attentionOf, markOf, settledTurn } from "./marks"
import { NOTHING } from "./thread"

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
  thread({ latest: { turn: "u1", state, began: 1 } })

test("a Thread asks, works, fails, finishes or rests", () => {
  expect(markOf(thread(), {})).toBe("rest")
  expect(markOf(ended("running"), {})).toBe("running")
  expect(markOf(ended("done"), {})).toBe("done")
  expect(markOf(ended("failed"), {})).toBe("failed")
  expect(markOf(ended("interrupted"), {})).toBe("failed")
  expect(markOf(ended("stopped"), {})).toBe("rest")
  const asking = thread({
    latest: { turn: "u1", state: "running", began: 1 },
    asking: [{ item: "q1", title: "Which?" }],
  })
  expect(markOf(asking, {})).toBe("asking")
})

test("a turn the Person saw end settles; a Question still asks", () => {
  const seen = { t1: "u1" }
  expect(markOf(ended("done"), seen)).toBe("rest")
  expect(markOf(ended("failed"), seen)).toBe("rest")
  expect(markOf(ended("done"), { t1: "u0" })).toBe("done")
  expect(
    markOf(
      thread({ ...ended("done"), asking: [{ item: "q1", title: "Which?" }] }),
      seen
    )
  ).toBe("asking")
})

test("a Space calls with its loudest Thread, and counts who waits", () => {
  const threads = [
    ended("running"),
    { ...ended("failed"), id: "t2" },
    { ...ended("done"), id: "t3" },
    { ...thread({ asking: [{ item: "q", title: "Which?" }] }), id: "t4" },
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
    can: NOTHING,
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
