import type { ListedThread, TurnView } from "@banda/contract/agents"
import { expect, test } from "vitest"
import { markOf, settledTurn } from "./marks"
import { NOTHING } from "../thread/state"

function thread(more: Partial<ListedThread> = {}): ListedThread {
  return {
    id: "t1",
    agent: "a1",
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
  expect(markOf(thread())).toBe("rest")
  expect(markOf(ended("running"))).toBe("working")
  expect(markOf(ended("done"))).toBe("done")
  expect(markOf(ended("failed"))).toBe("failed")
  expect(markOf(ended("interrupted"))).toBe("failed")
  expect(markOf(ended("stopped"))).toBe("rest")
  const asking = thread({
    latest: { turn: "u1", state: "running", began: 1 },
    asking: [{ item: "q1", title: "Which?" }],
  })
  expect(markOf(asking)).toBe("asking")
})

test("a turn its host keeps seen settles; a Question still asks", () => {
  const seen = (state: TurnView["state"], turn = "u1") => ({
    ...ended(state),
    seen: turn,
  })
  expect(markOf(seen("done"))).toBe("rest")
  expect(markOf(seen("failed"))).toBe("rest")
  expect(markOf(seen("done", "u0"))).toBe("done")
  expect(
    markOf({ ...seen("done"), asking: [{ item: "q1", title: "Which?" }] })
  ).toBe("asking")
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
