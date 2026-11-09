/**
 * What the Window keeps outside React for its parts to read by selector
 * (ADR 0087, decision 5; ADR 0088, decision 7): the items, what the Apps
 * list now, and the calls, what calls the Person. The Watches feed them,
 * until `item@1` and `call@1` do (E8b), so a list that changes draws again
 * only what reads the part of it that changed, never the whole Window. One
 * pair for each Window. Each host's Watches say what it lists apart, this
 * machine's and each other's in `hosts.toml` (ADR 0081, decision 4): the
 * stores keep what each said last, and hold all of it merged, so a reader
 * hears each change once. Pure but for React's context, so plain tests
 * cover it.
 */
import { createContext, useCallback, useContext } from "react"
import type { ProjectId } from "@banda/contract"
import { loudest, waits, works } from "@banda/ui/components/banda-mark"
import {
  type Readable,
  sameData,
  sameEach,
  Store,
  useStore,
} from "@banda/ui/lib/store"
import {
  type Attention,
  type Call,
  callsOf,
  type Listed,
  type Lists,
  type PaneState,
  QUIET,
  withHost,
} from "@banda/ui/pane"
import {
  nextWake,
  type Snoozes,
  useSnoozesAt,
  wakeAfter,
} from "../sidebar/snoozed"

/** What calls the Person now. */
export type Calls = {
  /** The loudest of what the Watches say calls, and how many things
   * wait: the bar's Mark. */
  attention: Attention
  /** The clock snoozes are read by (ADR 0074): it moves only as the next
   * one wakes by its time. */
  now: number
  /** Every App's Calls, the Inbox, in no order: the sidebar's `order` orders
   * them. One snoozed calls no one while it sleeps. */
  list: readonly Call[]
}

export type Stores = {
  items: Store<Lists>
  calls: Store<Calls>
  /** What each host's Watches said last, by its name, this machine's as
   * `HERE`: `items` and the calls' attention merge them. */
  hosts: Map<string, Said>
}

/** What one host's Watches say: what it lists, and what calls. */
type Said = { lists: Lists; attention: Attention }

/** This machine, as the stores name the host of what it lists: a name
 * `hosts.toml` keeps for Banda's own. */
export const HERE = "this"

export function newStores(now = Date.now()): Stores {
  return {
    items: new Store<Lists>({}),
    calls: new Store<Calls>({ attention: QUIET, now, list: [] }),
    hosts: new Map(),
  }
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
    let unchanged = before?.length === listed.length
    const each = listed.map((one, i) => {
      const old = byId.get(one.id)
      const keep = old && sameData(old, one) ? old : one
      if (keep !== before?.[i]) unchanged = false
      return keep
    })
    kept[project] = before && unchanged ? before : each
    if (kept[project] !== before) same = false
  }
  return same ? was : kept
}

/** What each host said, this machine's first. */
function inOrder(hosts: ReadonlyMap<string, Said>): Said[] {
  const here = hosts.get(HERE)
  return [
    ...(here ? [here] : []),
    ...[...hosts].filter(([name]) => name !== HERE).map(([, said]) => said),
  ]
}

/** Every host's lists as one: a Project's of the first host that lists
 * it, this machine's before any other. */
function mergedLists(hosts: ReadonlyMap<string, Said>): Lists {
  const all: Record<ProjectId, readonly Listed[]> = {}
  for (const { lists } of inOrder(hosts))
    for (const [project, listed] of Object.entries(lists))
      all[project as ProjectId] ??= listed
  return all
}

/** Takes what host `host`'s Watches list now: the items hold it with
 * every other host's, another host's as the Window opens it there
 * (`onHost`). */
export function takeLists(
  { items, hosts }: Stores,
  lists: Lists,
  host = HERE
): void {
  const placed = host === HERE ? lists : onHost(lists, host)
  hosts.set(host, {
    attention: hosts.get(host)?.attention ?? QUIET,
    lists: placed,
  })
  items.set(keptLists(items.get(), mergedLists(hosts)))
}

/** What host `host` lists, as the Window opens it (ADR 0081): each
 * Pane on that host (`withHost`), so a row, a call or the Banda menu opens
 * it there, and no toast's answer, as its action goes to this machine's
 * engine. */
function onHost(lists: Lists, host: string): Lists {
  const placed: Record<ProjectId, readonly Listed[]> = {}
  for (const [project, listed] of Object.entries(lists))
    placed[project as ProjectId] = listed.map((one) => {
      const there: Listed = { ...one, pane: withHost(one.pane, host) }
      delete there.answers
      return there
    })
  return placed
}

/** Takes what host `host`'s Watches say calls the Person: the calls hold
 * the loudest of every host's, when it is new. */
export function takeAttention(
  { calls, hosts }: Stores,
  attention: Attention,
  host = HERE
): void {
  hosts.set(host, { lists: hosts.get(host)?.lists ?? {}, attention })
  const all = inOrder(hosts).map((said) => said.attention)
  const mark = loudest(all.map((one) => one.mark))
  const waiting = all.reduce((sum, one) => sum + one.waiting, 0)
  const was = calls.get()
  if (was.attention.mark !== mark || was.attention.waiting !== waiting)
    calls.set({ ...was, attention: { mark, waiting } })
}

/** Lets go of what host `host` listed and called for, as the Window no
 * longer shows its rows. */
export function dropHost(stores: Stores, host: string): void {
  if (host === HERE || !stores.hosts.has(host)) return
  takeLists(stores, {}, host)
  takeAttention(stores, QUIET, host)
  stores.hosts.delete(host)
}

/** What this machine lists, without the other hosts': what Quit and a
 * restart stop. */
export function ownLists({ hosts }: Stores): Lists {
  return hosts.get(HERE)?.lists ?? NO_LISTS
}

const NO_LISTS: Lists = {}

/**
 * Keeps the calls following the items and the snooze clock: worked out
 * again as the lists change, and as the next snooze wakes by its time,
 * and only then. The calls are set anew after every change of the items,
 * so what reads both may listen to the calls alone, and hears once, with
 * both new. Returns how to stop.
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
 * What every App lists, as code outside React reads it
 * (`WindowApi.items`): its listeners hear each change of the lists, and
 * a snoozed Thread waking, which changes what calls (ADR 0074).
 */
export function itemsOf({ items, calls }: Stores): Readable<Lists> {
  return {
    get: items.get,
    subscribe: (listener) => {
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
    },
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

/** How many Agents work on this machine now: those Quit and a restart
 * stop, and no other host's. */
export function workingHere(stores: Stores): number {
  return workingIn(ownLists(stores))
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

const every = (lists: Lists) => lists

/** What every App lists now, drawn again as any list changes. */
export function useLists(): Lists {
  return useItems(every)
}

/** How many Agents work on this machine now, drawn again as it changes. */
export function useWorkingHere(): number {
  const stores = useContext(StoresContext)
  const select = useCallback(() => workingHere(stores), [stores])
  return useStore(stores.items, select)
}

/** The bar's Mark: what calls the Person, and how many things wait. */
export const attentionOf = (calls: Calls) => calls.attention

/** The snooze clock. */
export const nowOf = (calls: Calls) => calls.now

/** The snoozes, read by the calls' clock, which moves as the next one
 * wakes by its time. */
export function useSnoozesNow(): Snoozes {
  return useSnoozesAt(useCalls(nowOf))
}

/** The Projects one of whose Threads calls the Person now, unless it is
 * put away: the bar's dots, drawn again only as they change. */
export function useCalling(): ProjectId[] {
  const { away } = useSnoozesNow()
  const select = useCallback((lists: Lists) => callingIn(lists, away), [away])
  return useItems(select, sameEach)
}
