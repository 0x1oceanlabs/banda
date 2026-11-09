import type { ProjectId } from "@banda/contract"
import type { Listed, Lists } from "@banda/ui/pane"
import { afterEach, expect, test, vi } from "vitest"
import { wokeTold } from "./woke"
import {
  callingIn,
  dropHost,
  followCalls,
  itemsOf,
  keptLists,
  listedIn,
  newStores,
  takeLists,
  workingHere,
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

test("a nested change, as an answer or a Later, is a change", () => {
  const was: Lists = { [p]: [thread("a", { later: { at: 1, until: 5 } })] }
  const now = keptLists(was, {
    [p]: [thread("a", { later: { at: 1, until: 9 } })],
  })
  expect(now[p][0]).not.toBe(was[p][0])
  expect(keptLists(was, { [p]: [thread("a")] })[p][0].later).toBeUndefined()
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

test("the calls follow the lists, and a Later that wakes by its time", () => {
  vi.useFakeTimers({ now: 1_000 })
  const stores = newStores(1_000)
  const stop = followCalls(stores)
  expect(stores.calls.get().list).toEqual([])

  takeLists(stores, {
    [p]: [
      thread("a", { mark: "asking" }),
      thread("b", { mark: "done", later: { at: 0, until: 2_000 } }),
    ],
  })
  expect(stores.calls.get().list.map((call) => call.about)).toEqual(["a"])
  const before = stores.calls.get()

  // The clock moves only as the Later wakes.
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

test("what watches the lists hears them change, and a Later wake, not a mark", () => {
  vi.useFakeTimers({ now: 1_000 })
  const stores = newStores(1_000)
  const stop = followCalls(stores)
  const heard = vi.fn()
  const unwatch = itemsOf(stores).subscribe(heard)

  takeLists(stores, {
    [p]: [thread("a", { mark: "done", later: { at: 0, until: 1_500 } })],
  })
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
  expect(callingIn(lists, 0)).toEqual([p, q])
  const away: Lists = {
    ...lists,
    [q]: [lists[q][0], { ...lists[q][1], archived: true }],
  }
  expect(callingIn(away, 0)).toEqual([p])

  const shows = (pane: { args?: unknown }) =>
    (pane.args as { thread?: string } | undefined)?.thread ?? null
  const pane = { kind: "agents.thread", args: { thread: "c" } }
  expect(listedIn(lists, { project: q, pane }, shows)).toBe(lists[q][0])
  expect(listedIn(lists, { project: p, pane }, shows)).toBeUndefined()
  expect(
    listedIn(lists, { project: q, pane: { kind: "terminal", args: {} } }, shows)
  ).toBeUndefined()
})

const r = "r" as ProjectId

test("each host's lists are kept apart, and the items hold them all, this machine's first", () => {
  const stores = newStores(0)
  const heard = vi.fn()
  stores.items.subscribe(heard)
  takeLists(stores, { [p]: [thread("a", { mark: "running" })] })
  takeLists(stores, { [r]: [thread("b", { mark: "running" })] }, "arc")
  expect(heard).toHaveBeenCalledTimes(2)
  expect(Object.keys(stores.items.get())).toEqual([p, r])

  // A host's new list leaves the other's as it was, each Listed kept.
  const before = stores.items.get()[p]
  takeLists(stores, { [r]: [thread("b", { mark: "done" })] }, "arc")
  expect(heard).toHaveBeenCalledTimes(3)
  expect(stores.items.get()[p]).toBe(before)
  takeLists(stores, { [p]: [thread("a", { mark: "running" })] })
  expect(heard).toHaveBeenCalledTimes(3)

  // Only this machine's Agents are what Quit and a restart stop.
  expect(workingIn(stores.items.get())).toBe(1)
  takeLists(stores, { [r]: [thread("b", { mark: "running" })] }, "arc")
  expect(workingIn(stores.items.get())).toBe(2)
  expect(workingHere(stores)).toBe(1)

  // A Project two hosts list is this machine's.
  takeLists(stores, { [p]: [thread("c")], [r]: [thread("b")] }, "devbox")
  expect(stores.items.get()[p]?.map((one) => one.id)).toEqual(["a"])

  // A host let go of leaves the rest, and tells once.
  dropHost(stores, "devbox")
  heard.mockClear()
  dropHost(stores, "arc")
  expect(heard).toHaveBeenCalledTimes(1)
  expect(Object.keys(stores.items.get())).toEqual([p])
  dropHost(stores, "arc")
  expect(heard).toHaveBeenCalledTimes(1)
})

test("the bar's Mark is every host's lists' loudest, and their turns in all, put away left out", () => {
  const stores = newStores(0)
  const stop = followCalls(stores)
  takeLists(stores, { [p]: [thread("a", { mark: "done" })] })
  takeLists(
    stores,
    {
      [q]: [
        thread("b", { mark: "asking" }),
        thread("c", { mark: "failed", archived: true }),
      ],
    },
    "arc"
  )
  expect(stores.calls.get().attention).toEqual({ mark: "asking", waiting: 2 })
  // This machine's quiet leaves the host's call.
  takeLists(stores, { [p]: [thread("a")] })
  expect(stores.calls.get().attention).toEqual({ mark: "asking", waiting: 1 })
  dropHost(stores, "arc")
  expect(stores.calls.get().attention).toEqual({ mark: "rest", waiting: 0 })
  stop()
})

test("a host's Listed opens its Pane on that host, with no answer for this machine's engine", () => {
  const stores = newStores(0)
  const answers = [{ label: "Allow", action: "agents.answer", args: {} }]
  takeLists(stores, { [p]: [thread("a", { answers })] })
  takeLists(stores, { [r]: [thread("b", { answers })] }, "arc")
  const [here] = stores.items.get()[p]!
  const [there] = stores.items.get()[r]!
  expect(here!.pane.args).toEqual({ thread: "a" })
  expect(here!.answers).toEqual(answers)
  expect(there!.pane.args).toEqual({ thread: "b", host: "arc" })
  expect(there!.answers).toBeUndefined()
})

test("what a host lists and calls for, as Alt+U, a toast, the woke notice and the counts pick it, opens on that host", () => {
  const stores = newStores(0)
  const stop = followCalls(stores)
  takeLists(stores, { [p]: [thread("a", { mark: "done" })] })
  takeLists(stores, { [r]: [thread("b", { mark: "asking" })] }, "arc")
  const picked = Object.fromEntries(
    stores.calls.get().list.map((call) => [call.about, call.pane.args])
  )
  expect(picked).toEqual({
    a: { thread: "a" },
    b: { thread: "b", host: "arc" },
  })
  const [there] = stores.items.get()[r]!
  expect(wokeTold(r, there!)).toMatchObject({
    buttons: [{ args: { project: r, pane: { args: { host: "arc" } } } }],
  })
  stop()
})
