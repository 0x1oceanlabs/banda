import type { Finding } from "@banda/ui/module"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { HERE, type Plan } from "./search"
import { askAll, SETTLE } from "./useSearch"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const PLAN: Plan = {
  key: "quokka",
  words: "quokka",
  asks: new Map([
    [HERE, ["p1", "p2"]],
    ["arc", ["p9"]],
  ]),
  away: [],
}

const finding = (id: string): Finding => ({
  id,
  snippet: `${id} quokka`,
  hits: [],
  at: 0,
})

/** An answer the test lets go when it says. */
function later<T>() {
  let settle!: { resolve: (value: T) => void; reject: (error: Error) => void }
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })
  return { promise, ...settle }
}

test("the machines are asked once the keys settle, each machine's answer whole, once all its Projects answered (S12c)", async () => {
  const asked: string[] = []
  const answers = new Map(
    ["p1", "p2", "p9"].map((project) => [project, later<Finding[]>()])
  )
  const taken: [string, string[] | undefined][] = []
  askAll(
    PLAN,
    (project, words) => {
      asked.push(`${project}/${words}`)
      return answers.get(project)!.promise
    },
    (machine, found) => taken.push([machine, found?.map((one) => one.id)])
  )
  await vi.advanceTimersByTimeAsync(SETTLE - 1)
  expect(asked).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(asked).toEqual(["p1/quokka", "p2/quokka", "p9/quokka"])
  answers.get("p9")!.resolve([finding("t9")])
  answers.get("p1")!.resolve([finding("t1")])
  await vi.advanceTimersByTimeAsync(0)
  expect(taken).toEqual([["arc", ["t9"]]])
  // One Project that failed leaves out only its own.
  answers.get("p2")!.reject(new Error("refused"))
  await vi.advanceTimersByTimeAsync(0)
  expect(taken).toEqual([
    ["arc", ["t9"]],
    [HERE, ["t1"]],
  ])
})

test("a machine whose every Project failed, or that throws at once, as one out of reach, is told as failed (S12c)", async () => {
  const taken: [string, Finding[] | undefined][] = []
  askAll(
    PLAN,
    (project) => {
      if (project === "p9") throw new Error("arc is away")
      return Promise.reject(new Error("refused"))
    },
    (machine, found) => taken.push([machine, found])
  )
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(new Map(taken)).toEqual(
    new Map([
      [HERE, undefined],
      ["arc", undefined],
    ])
  )
})

test("stopped, as the words change, nothing is asked before the keys settle, and an answer that comes after is dropped (S12c)", async () => {
  const asked: string[] = []
  const taken: string[] = []
  const answer = later<Finding[]>()
  const ask = (project: string) => {
    asked.push(project)
    return answer.promise
  }
  // Stopped before the keys settle: nothing asked.
  askAll(PLAN, ask, (machine) => taken.push(machine))()
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(asked).toEqual([])
  // Stopped once asked: the late answer is dropped.
  const stop = askAll(PLAN, ask, (machine) => taken.push(machine))
  await vi.advanceTimersByTimeAsync(SETTLE)
  expect(asked).toHaveLength(3)
  stop()
  answer.resolve([finding("late")])
  await vi.advanceTimersByTimeAsync(0)
  expect(taken).toEqual([])
})
