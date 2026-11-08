/**
 * What the Window keeps outside React for its parts to read by selector
 * (ADR 0087, decision 5; ADR 0088, decision 7): the items, what the Apps
 * list now, and the calls, what calls the Person. The Watches feed them,
 * until `item@1` and `call@1` do (E8b), so a list that changes draws again
 * only what reads the part of it that changed, never the whole Window. One
 * pair for each Window; keyed by host from W0. Pure but for React's
 * context, so plain tests cover it.
 */
import { createContext, useContext } from "react"
import type { ProjectId } from "@banda/contract"
import { waits, works } from "@banda/ui/components/banda-mark"
import { Store, useStore } from "@banda/ui/lib/store"
import {
  type Attention,
  type Call,
  callsOf,
  type Listed,
  type Lists,
  type PaneState,
  QUIET,
} from "@banda/ui/pane"
import { nextWake, wakeAfter } from "../sidebar/snoozed"

/** What calls the Person now. */
export type Calls = {
  /** The loudest of what the Watches say calls, and how many things
   * wait: the bar's Mark. */
  attention: Attention
  /** The clock snoozes are read by (ADR 0074): it moves only as the next
   * one wakes by its time. */
  now: number
  /** Every App's Calls, the Inbox, in no order: `sidebarOrder` orders
   * them. One snoozed calls no one while it sleeps. */
  list: readonly Call[]
}

export type Stores = { items: Store<Lists>; calls: Store<Calls> }

export function newStores(now = Date.now()): Stores {
  return {
    items: new Store<Lists>({}),
    calls: new Store<Calls>({ attention: QUIET, now, list: [] }),
  }
}

/** Whether two values of plain data, as a Listed is, say the same. */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  const one = a as Record<string, unknown>
  const other = b as Record<string, unknown>
  return keys.every(
    (key) => Object.hasOwn(other, key) && sameData(one[key], other[key])
  )
}

/**
 * `now`, with what did not change since `was` kept as it was: each
 * Listed, by its id, and each Project's list. A Watch says its whole list
 * again for any change in it, so a reader that selects one Listed is
 * drawn again only when that one changes.
 */
export function keptLists(was: Lists, now: Lists): Lists {
  let same = Object.keys(was).length === Object.keys(now).length
  const kept: Record<ProjectId, readonly Listed[]> = {}
  for (const [key, listed] of Object.entries(now)) {
    const project = key as ProjectId
    const before = was[project]
    const byId = new Map(before?.map((one) => [one.id, one]))
    let all = before?.length === listed.length
    const each = listed.map((one, i) => {
      const old = byId.get(one.id)
      const keep = old && sameData(old, one) ? old : one
      if (keep !== before?.[i]) all = false
      return keep
    })
    kept[project] = before && all ? before : each
    if (kept[project] !== before) same = false
  }
  return same ? was : kept
}

/** Takes what the Watches list now. */
export function takeLists({ items }: Stores, lists: Lists): void {
  items.set(keptLists(items.get(), lists))
}

/** Takes what the Watches say calls the Person, when it is new. */
export function takeAttention({ calls }: Stores, attention: Attention): void {
  const was = calls.get()
  if (
    was.attention.mark !== attention.mark ||
    was.attention.waiting !== attention.waiting
  )
    calls.set({ ...was, attention })
}

/**
 * Keeps the calls following the items and the snooze clock: worked out
 * again as the lists change, and as the next snooze wakes by its time,
 * and only then. Returns how to stop.
 */
export function followCalls({ items, calls }: Stores): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = (now: number) => {
    clearTimeout(timer)
    const lists = items.get()
    calls.set({ ...calls.get(), now, list: callsOf(lists, now) })
    const next = nextWake(lists, now)
    if (next !== undefined)
      timer = setTimeout(() => work(Date.now()), wakeAfter(next))
  }
  work(calls.get().now)
  const stop = items.subscribe(() => work(calls.get().now))
  return () => {
    stop()
    clearTimeout(timer)
  }
}

/**
 * Calls `listener` as the lists change, and as a snoozed Thread wakes,
 * which changes what calls (ADR 0074): `WindowApi.watchLists`. Returns how
 * to stop.
 */
export function watchLists(
  { items, calls }: Stores,
  listener: () => void
): () => void {
  let now = calls.get().now
  const stopItems = items.subscribe(listener)
  const stopCalls = calls.subscribe(() => {
    if (calls.get().now === now) return
    now = calls.get().now
    listener()
  })
  return () => {
    stopItems()
    stopCalls()
  }
}

/** What a Pane shows, as its App lists it in `lists`. */
export function listedIn(
  lists: Lists,
  entry: { project: ProjectId; pane: PaneState },
  shows: (pane: PaneState) => string | null
): Listed | undefined {
  const thing = shows(entry.pane)
  return thing
    ? lists[entry.project]?.find((listed) => listed.id === thing)
    : undefined
}

/** How many of what the Apps list work now: the Agents at work. */
export function workingIn(lists: Lists): number {
  return Object.values(lists)
    .flat()
    .filter((listed) => works(listed.mark)).length
}

/** The Projects one of whose Threads calls the Person, unless it is put
 * away: those whose workspace the bar marks with a dot (ADR 0065,
 * decision 9). */
export function callingIn(
  lists: Lists,
  away: (listed: Listed) => boolean
): ProjectId[] {
  return Object.entries(lists)
    .filter(([, listed]) => listed.some((one) => waits(one.mark) && !away(one)))
    .map(([project]) => project as ProjectId)
}

/** The Window's stores, for its parts drawn inside it; elsewhere, as in a
 * popped-out window, empty ones. */
export const StoresContext = createContext<Stores>(newStores())

/** `select` of what the Apps list now, drawn again only as it changes. */
export function useItems<S>(
  select: (lists: Lists) => S,
  equal?: (a: S, b: S) => boolean
): S {
  return useStore(useContext(StoresContext).items, select, equal)
}

/** `select` of what calls now, drawn again only as it changes. */
export function useCalls<S>(
  select: (calls: Calls) => S,
  equal?: (a: S, b: S) => boolean
): S {
  return useStore(useContext(StoresContext).calls, select, equal)
}

/** The whole of what it is given: what reads every list selects. */
export const all = <T>(value: T): T => value
