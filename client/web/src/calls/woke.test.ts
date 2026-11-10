import type { ProjectId } from "@banda/contract"
import { MINUTE } from "@banda/ui/lib/words"
import type { Args } from "@banda/ui/module"
import type { Listed, ListedLater } from "@banda/ui/pane"
import { afterEach, expect, test, vi } from "vitest"
import { followCalls, newStores, takeLists } from "./stores"
import { tellWoke } from "./woke"

afterEach(() => {
  vi.useRealTimers()
})

const p = "p" as ProjectId

const thread = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: id,
  mark: "idle",
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

/** A Later put off at 0 till 2 000, which its host says woke at `at` by
 * `by`. */
const woke = (
  at: number,
  by: NonNullable<ListedLater["woke"]>["by"] = "time"
): ListedLater => ({ at: 0, until: 2_000, woke: { at, by } })

/** What `tellWoke` told, with the calls following the lists, from `now`. */
function telling(now: number) {
  vi.useFakeTimers({ now })
  const stores = newStores(now)
  const told: [string, Args | undefined][] = []
  const stops = [
    followCalls(stores),
    tellWoke(stores, (action, args) => void told.push([action, args])),
  ]
  return {
    told,
    take: (listed: Listed[]) => takeLists(stores, { [p]: listed }),
    stop: () => stops.forEach((stop) => stop()),
  }
}

test("a Thread is told of once as its host says it woke by its time, not as the window's clock passes it; one that calls, by its call alone", () => {
  const { told, take, stop } = telling(1_000)
  take([
    thread("a", { later: { at: 0, until: 2_000 } }),
    thread("b", { mark: "asking", later: { at: 0, until: 2_000 } }),
  ])
  // The window's clock passes its time: its host has not said so yet.
  vi.advanceTimersByTime(1_100)
  expect(told).toEqual([])
  take([
    thread("a", { later: woke(2_000) }),
    thread("b", { mark: "asking", later: woke(2_000) }),
  ])
  expect(told).toEqual([
    [
      "notifications.tell",
      expect.objectContaining({ key: "woke:p:a", body: "Woke from Later" }),
    ],
  ])
  // Said again, it is not told again; nor once b's question is answered.
  take([
    thread("a", { later: woke(2_000) }),
    thread("b", { later: woke(2_000) }),
  ])
  expect(told).toHaveLength(1)
  stop()
})

test("a Thread a call woke, or its turn's end that calls, is told of by that call; its Person's waking, not at all; a turn stopped, as woke", () => {
  const { told, take, stop } = telling(1_000)
  take([
    thread("asked", { mark: "asking", later: woke(900, "question") }),
    thread("done", { mark: "done", later: woke(900, "done") }),
    thread("woken", { later: woke(900, "woken") }),
    thread("stopped", { later: woke(900, "done") }),
  ])
  expect(told.map(([, args]) => args?.key)).toEqual(["woke:p:stopped"])
  stop()
})

test("a Thread its Person saw wake, on this machine or another, is not told of", () => {
  const { told, take, stop } = telling(3_000)
  take([thread("a", { later: { ...woke(2_000), wokeSeen: true } })])
  expect(told).toEqual([])
  stop()
})

test("a waking over ten minutes old is not told of, as a host's first start says old Laters woke at their own times", () => {
  const now = 60 * MINUTE
  const { told, take, stop } = telling(now)
  take([
    thread("old", { later: woke(now - 11 * MINUTE) }),
    thread("fresh", { later: woke(now - 9 * MINUTE) }),
  ])
  expect(told.map(([, args]) => args?.key)).toEqual(["woke:p:fresh"])
  stop()
})

test("a Thread put off again is told of again as it wakes again", () => {
  const { told, take, stop } = telling(3_000)
  take([thread("a", { later: woke(2_000) })])
  take([
    thread("a", {
      later: { at: 2_500, until: 2_900, woke: { at: 2_900, by: "time" } },
    }),
  ])
  expect(told).toHaveLength(2)
  stop()
})
