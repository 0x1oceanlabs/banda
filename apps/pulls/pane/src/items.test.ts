import { expect, test } from "vitest"
import type { Pull } from "@banda/contract/pulls"
import type { Listed } from "@banda/ui/pane"
import { itemsOf, threadsIn } from "./items"

const pane = { kind: "agents.thread", args: {} }

/** A pull request of `o/r`, linked to `threads`, read with its checks
 * running. */
function pull(number: number, threads: string[], updated = 1): Pull {
  return {
    host: "github.com",
    repo: "o/r",
    number,
    url: `https://github.com/o/r/pull/${number}`,
    threads,
    owner: threads[0]!,
    by: "agent",
    auto_fix: true,
    snapshot: {
      state: "open",
      draft: false,
      title: `feat: ${number}`,
      head: `feat/${number}`,
      base: "main",
      checks: "running",
      counted: { passed: 1, failed: 0, running: 2, total: 3 },
      asked_of_you: false,
      conflicts: false,
      auto_merge: false,
      additions: 3,
      deletions: 1,
      updated_at: updated,
      synced_at: updated,
    },
    need: "running",
    turn: "waiting",
  }
}

const thread = (id: string, agent: string): Listed => ({
  id,
  title: id,
  mark: "done",
  changed: 1,
  agent,
  pane: { ...pane, args: { thread: id } },
})

test("each Thread's pull requests are one item on its Agent, in the engine's order, with no mark that calls", () => {
  const first = pull(1061, ["t1"], 5)
  const shared = pull(1062, ["t1", "t2"], 9)
  const threads = threadsIn([thread("t1", "a1"), thread("t2", "a2")])
  expect(itemsOf({ pulls: [shared, first] }, threads)).toEqual([
    {
      id: "pulls:t1",
      title: "#1062, #1061",
      mark: "rest",
      changed: 9,
      on: "a1",
      pane: { ...pane, args: { thread: "t1" } },
      pulls: [shared, first],
    },
    {
      id: "pulls:t2",
      title: "#1062",
      mark: "rest",
      changed: 9,
      on: "a2",
      pane: { ...pane, args: { thread: "t2" } },
      pulls: [shared],
    },
  ])
})

test("a Thread that links none, or that the window does not list, has no item", () => {
  const threads = threadsIn([thread("t1", "a1")])
  expect(itemsOf({ pulls: [] }, threads)).toEqual([])
  expect(itemsOf({ pulls: [pull(7, ["gone"])] }, threads)).toEqual([])
  // One not read yet changed at no time the engine knows.
  const unread = { ...pull(8, ["t1"]), snapshot: undefined }
  expect(itemsOf({ pulls: [unread] }, threads)[0]?.changed).toBe(0)
})

test("the Threads are the items an Agent works in", () => {
  const plain: Listed = { id: "x", title: "x", mark: "rest", changed: 1, pane }
  expect(threadsIn([thread("t1", "a1"), plain])).toEqual([
    { id: "t1", agent: "a1", pane: { ...pane, args: { thread: "t1" } } },
  ])
})
