import type { ProjectId } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import type { Listed } from "@banda/ui/pane"
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

test("a Thread that wakes by its time is told of once; one that calls, by its call alone", () => {
  vi.useFakeTimers({ now: 1_000 })
  const stores = newStores(1_000)
  const stops = [followCalls(stores)]
  const told: [string, Args | undefined][] = []
  stops.push(tellWoke(stores, (action, args) => void told.push([action, args])))
  takeLists(stores, {
    [p]: [
      thread("a", { snooze: { at: 0, until: 2_000 } }),
      thread("b", { mark: "asking", snooze: { at: 0, until: 2_000 } }),
      // Woken by its Person: nothing to tell.
      thread("c", { snooze: { at: 0, woke: { at: 500, by: "woken" } } }),
    ],
  })
  expect(told).toEqual([])
  vi.advanceTimersByTime(1_100)
  expect(told).toEqual([
    [
      "notifications.tell",
      expect.objectContaining({
        key: "woke:p:a",
        body: "Woke from its snooze",
      }),
    ],
  ])
  // Said again, it is not told again.
  takeLists(stores, {
    [p]: [thread("a", { snooze: { at: 0, until: 2_000 } })],
  })
  expect(told).toHaveLength(1)
  for (const stop of stops) stop()
})
