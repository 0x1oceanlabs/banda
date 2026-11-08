import type { ProjectId } from "@banda/contract"
import type { Listed, Lists } from "@banda/ui/pane"
import { afterEach, expect, test, vi } from "vitest"
import {
  callingIn,
  followCalls,
  keptLists,
  listedIn,
  newStores,
  takeAttention,
  takeLists,
  watchLists,
  workingIn,
} from "./stores"

afterEach(() => {
  vi.useRealTimers()
})

const thread = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: id,
  mark: "idle",
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

const p = "p" as ProjectId
const q = "q" as ProjectId

test("lists said again keep each Listed, and each list, that did not change", () => {
  const was: Lists = { [p]: [thread("a"), thread("b")], [q]: [thread("c")] }
  // A Watch says its whole list again, each thing a new object.
  const again: Lists = {
    [p]: [thread("a"), thread("b")],
    [q]: [thread("c")],
  }
  expect(keptLists(was, again)).toBe(was)

  const changed = keptLists(was, {
    [p]: [thread("a"), thread("b", { mark: "running" })],
    [q]: [thread("c")],
  })
  expect(changed).not.toBe(was)
  expect(changed[p][0]).toBe(was[p][0])
  expect(changed[p][1]).not.toBe(was[p][1])
  expect(changed[p][1].mark).toBe("running")
  expect(changed[q]).toBe(was[q])

  // In a new order, each keeps its object, and the list is new.
  const turned = keptLists(was, { [p]: [thread("b"), thread("a")], [q]: [] })
  expect(turned[p]).toEqual([was[p][1], was[p][0]])
  expect(turned[p][0]).toBe(was[p][1])
  expect(turned[q]).toEqual([])

  // A Project that leaves, and one that comes.
  expect(keptLists(was, { [p]: [thread("a"), thread("b")] })).toEqual({
    [p]: was[p],
  })
  expect(keptLists({}, was)).toEqual(was)
})

test("a nested change, as an answer or a snooze, is a change", () => {
  const was: Lists = { [p]: [thread("a", { snooze: { at: 1, until: 5 } })] }
  const now = keptLists(was, {
    [p]: [thread("a", { snooze: { at: 1, until: 9 } })],
  })
  expect(now[p][0]).not.toBe(was[p][0])
  expect(keptLists(was, { [p]: [thread("a")] })[p][0].snooze).toBeUndefined()
})

test("the items tell their readers only when what is listed changed", () => {
  const stores = newStores(0)
  const heard = vi.fn()
  stores.items.subscribe(heard)
  takeLists(stores, { [p]: [thread("a")] })
  takeLists(stores, { [p]: [thread("a")] })
  expect(heard).toHaveBeenCalledTimes(1)
  takeLists(stores, { [p]: [thread("a", { title: "A" })] })
  expect(heard).toHaveBeenCalledTimes(2)
})

test("the calls take what the Watches say calls only when it is new", () => {
  const stores = newStores(0)
  const heard = vi.fn()
  stores.calls.subscribe(heard)
  takeAttention(stores, { mark: "rest", waiting: 0 })
  expect(heard).not.toHaveBeenCalled()
  takeAttention(stores, { mark: "asking", waiting: 1 })
  takeAttention(stores, { mark: "asking", waiting: 1 })
  expect(heard).toHaveBeenCalledTimes(1)
  expect(stores.calls.get().attention).toEqual({ mark: "asking", waiting: 1 })
})

test("the calls follow the lists, and a snooze that wakes by its time", () => {
  vi.useFakeTimers({ now: 1_000 })
  const stores = newStores(1_000)
  const stop = followCalls(stores)
  expect(stores.calls.get().list).toEqual([])

  takeLists(stores, {
    [p]: [
      thread("a", { mark: "asking" }),
      thread("b", { mark: "done", snooze: { at: 0, until: 2_000 } }),
    ],
  })
  expect(stores.calls.get().list.map((call) => call.about)).toEqual(["a"])
  const before = stores.calls.get()

  // The clock moves only as the snooze wakes.
  vi.advanceTimersByTime(500)
  expect(stores.calls.get()).toBe(before)
  vi.advanceTimersByTime(600)
  expect(stores.calls.get().now).toBeGreaterThanOrEqual(2_000)
  expect(stores.calls.get().list.map((call) => call.about)).toEqual(["a", "b"])

  stop()
  takeLists(stores, { [p]: [] })
  expect(stores.calls.get().list).toHaveLength(2)
})

test("the calls are told of after each change of the items, one that calls none too", () => {
  // The Tiling listens to the calls alone (`Shows`), for both.
  const stores = newStores(0)
  const stop = followCalls(stores)
  const heard = vi.fn()
  stores.calls.subscribe(heard)
  takeLists(stores, { [p]: [thread("a")] })
  takeLists(stores, { [p]: [thread("a", { title: "A" })] })
  expect(stores.calls.get().list).toEqual([])
  expect(heard).toHaveBeenCalledTimes(2)
  stop()
})

test("what watches the lists hears them change, and a snooze wake, not a mark", () => {
  vi.useFakeTimers({ now: 1_000 })
  const stores = newStores(1_000)
  const stop = followCalls(stores)
  const heard = vi.fn()
  const unwatch = watchLists(stores, heard)

  takeLists(stores, {
    [p]: [thread("a", { mark: "done", snooze: { at: 0, until: 1_500 } })],
  })
  expect(heard).toHaveBeenCalledTimes(1)
  takeAttention(stores, { mark: "asking", waiting: 1 })
  expect(heard).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(600)
  expect(heard).toHaveBeenCalledTimes(2)

  unwatch()
  stop()
  takeLists(stores, { [p]: [] })
  expect(heard).toHaveBeenCalledTimes(2)
})

test("what the bar reads of the lists: who works, which Projects call, and a Pane's own", () => {
  const lists: Lists = {
    [p]: [thread("a", { mark: "running" }), thread("b", { mark: "asking" })],
    [q]: [thread("c", { mark: "thinking" }), thread("d", { mark: "done" })],
  }
  expect(workingIn(lists)).toBe(2)
  expect(callingIn(lists, () => false)).toEqual([p, q])
  expect(callingIn(lists, (listed) => listed.id === "d")).toEqual([p])

  const shows = (pane: { args?: unknown }) =>
    (pane.args as { thread?: string } | undefined)?.thread ?? null
  const pane = { kind: "agents.thread", args: { thread: "c" } }
  expect(listedIn(lists, { project: q, pane }, shows)).toBe(lists[q][0])
  expect(listedIn(lists, { project: p, pane }, shows)).toBeUndefined()
  expect(
    listedIn(lists, { project: q, pane: { kind: "terminal", args: {} } }, shows)
  ).toBeUndefined()
})
