/**
 * Each other machine's rows, kept on this device "as of" when it was last
 * heard (#1243; ADR 0106, law 4), so a window that starts shows them at
 * once: its Projects and what its Apps list in them, dim, as an away
 * machine's are, until its engine lists them again.
 *
 * Kept by the machine's key in `hosts.toml`, with where that key goes:
 * a key the Person points elsewhere starts with no rows. What is
 * archived is not kept, as the storage is small: the Archive fills as
 * the machine is heard. A machine gone from `hosts.toml`, or one that
 * refused this device, is wiped. This machine's own rows are its
 * engine's, which a window starts with.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import {
  Cache,
  type HostState,
  type KeptHosts,
  type RowsAsOf,
  type Shelf,
  type Shown,
} from "@banda/core"
import type { Listed, Lists } from "@banda/ui/pane"
import { seedLists, type Stores } from "./stores"

/** A machine's rows as the cache keeps them. */
type Rows = {
  /** Where its key went as they were kept (`whereOf`). */
  where: string
  /** Its Host scope's ID, where its engine said one. */
  machine?: ProjectId
  /** Its Projects as the Window showed them. */
  projects: readonly ProjectSummary[]
  /** What its Apps listed in them, none archived. */
  lists: Lists
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasId = (value: unknown) =>
  isRecord(value) && typeof value.id === "string"

/** Whether a kept value is a machine's rows: its parts of the right
 * kind, each Project and each thing listed with its ID. What it says
 * beyond that is the Window's own, written by this shelf's version. */
function isRows(value: unknown): value is Rows {
  if (!isRecord(value)) return false
  const { where, machine, projects, lists } = value
  return (
    typeof where === "string" &&
    (machine === undefined || typeof machine === "string") &&
    Array.isArray(projects) &&
    projects.every(hasId) &&
    isRecord(lists) &&
    Object.values(lists).every(
      (listed) => Array.isArray(listed) && listed.every(hasId)
    )
  )
}

/** The rows' shelf. Its version moves with the shape of `Listed` and of
 * a Project's summary, as a newer window would not draw an older one's. */
export const ROWS: Shelf<Rows> = { name: "rows@1", is: isRows }

/** Where a host's key goes: its ssh address and the `banda` it runs. */
const whereOf = (host: Pick<HostState, "ssh" | "banda">) =>
  JSON.stringify([host.ssh, host.banda ?? null])

/**
 * What `cache` kept of the other machines' rows, read once for each as
 * the Window first shows it. `rows` is what the Window's hosts ask
 * (`KeptHosts`): a host's Projects as of then, if its key still goes
 * where it went. Its lists wait here from then, for the stores to take
 * once (`lists`), so they are seeded only with the Projects they are in.
 */
export function asOf(cache: Cache) {
  const waiting = new Map<string, Lists>()
  return {
    cache,
    rows: (host: HostState): RowsAsOf | undefined => {
      const kept = cache.read(host.name, ROWS)
      if (kept?.value.where !== whereOf(host)) return undefined
      const { machine, projects, lists } = kept.value
      waiting.set(host.name, lists)
      return {
        projects,
        at: kept.at,
        ...(machine !== undefined && { machine }),
      }
    },
    lists: (name: string): Lists | undefined => {
      const lists = waiting.get(name)
      waiting.delete(name)
      return lists
    },
  }
}

/** This device's rows as of, in the window's storage. */
export const AS_OF = asOf(new Cache(() => localStorage))

/** `lists` as they are kept: nothing archived. */
function plain(lists: Lists): Lists {
  const kept: Record<ProjectId, readonly Listed[]> = {}
  for (const [project, listed] of Object.entries(lists))
    kept[project as ProjectId] = listed.filter((one) => !one.archived)
  return kept
}

/** How long after a change the rows are written: a Thread at work
 * changes its row with every step. */
const WAIT = 5_000

/**
 * Keeps the cache following the rows of the other machines: hands the
 * stores what `kept` read of a machine's lists as the Window first
 * showed that machine, writes each live machine's rows a while after they
 * change (`wait` ms), and wipes a machine the device let go of. Returns
 * how to stop, which writes what waits; `now` writes every live
 * machine's at once, as the window is about to go, so they are as of
 * then.
 */
export function followRows(
  hosts: KeptHosts,
  stores: Stores,
  { cache, lists }: ReturnType<typeof asOf>,
  wait = WAIT
): { stop: () => void; now: () => void } {
  /** What was written of each machine last. */
  const written = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const seed = (all: readonly Shown[]) => {
    for (const { name } of all) {
      const kept = lists(name)
      if (kept) seedLists(stores, kept, name)
    }
  }

  const wipe = (all: readonly Shown[]) => {
    // Before the device told its hosts there are none, so nothing is
    // known gone yet: the last machine taken out is left to its time.
    if (all.length === 0) return
    const kept = new Map(all.map((host) => [host.name, host]))
    for (const name of cache.machines()) {
      const host = kept.get(name)
      if (host && host.state.state !== "refused") continue
      cache.wipe(name)
      written.delete(name)
    }
  }

  const write = () => {
    clearTimeout(timer)
    timer = undefined
    for (const host of hosts.get()) {
      const { name } = host
      const lists = stores.hosts.get(name)
      // Only what it says now: not what stands as it last said it.
      if (host.state.state !== "live" || !lists || stores.away.has(name))
        continue
      const rows: Rows = {
        where: whereOf(host.state),
        ...(host.machine !== undefined && { machine: host.machine }),
        projects: host.projects,
        lists: plain(lists),
      }
      const text = JSON.stringify(rows)
      if (written.get(name) === text) continue
      written.set(name, text)
      cache.write(name, ROWS, rows)
    }
  }

  const changed = () => {
    timer ??= setTimeout(write, wait)
  }
  const told = () => {
    const all = hosts.get()
    seed(all)
    wipe(all)
    changed()
  }
  told()
  const stopHosts = hosts.subscribe(told)
  const stopItems = stores.items.subscribe(changed)
  return {
    now: () => {
      written.clear()
      write()
    },
    stop: () => {
      stopHosts()
      stopItems()
      write()
    },
  }
}
