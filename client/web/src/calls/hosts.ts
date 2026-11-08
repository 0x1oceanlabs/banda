/**
 * The other machines the Window shows below its own (ADR 0081, decision
 * 4): each host of `hosts.toml` as the desktop reaches it over ssh, with
 * its engine and its Projects. What its Apps list flows into the Window's
 * stores under its name, through one Watches for each host while it is
 * live (bar/Watches.tsx). Where a host's engine listens only the desktop
 * knows: its engine asks it on every connect, and the page keeps the
 * address nowhere. Pure but for React's context, so plain tests cover it.
 */
import {
  type Address,
  Engine,
  type ProjectId,
  type ProjectSummary,
} from "@banda/contract"
import type { Read } from "@banda/ui/hooks/use-read"
import type { Args } from "@banda/ui/module"
import { shownProjects } from "@banda/ui/lib/projects"
import { type Readable, sameEach, Store, useStore } from "@banda/ui/lib/store"
import { paneHost, type PaneState, withHost } from "@banda/ui/pane"
import { createContext, useCallback, useContext, useEffect } from "react"
import type { HostState } from "../host"

/** How the Window reaches the desktop's hosts: `device.hosts`. */
export type HostsDevice = {
  /** Hands `take` the hosts now and as they change; returns how to stop. */
  follow: (take: (hosts: HostState[]) => void) => (() => void) | undefined
  /** Where host `name`'s engine listens now. */
  engine: (name: string) => Promise<Address>
  /** Starts host `name`'s engine again there. */
  start: (name: string) => void
}

/** A host as the Window shows it. */
export type Shown = {
  name: string
  /** What the desktop says of it, but away through the tries after a
   * loss, until it is live again or says otherwise. */
  state: HostState
  /** Since when it is away, in ms since the epoch: its rows stand still
   * as they were then. */
  away?: number
  /** Its Projects while it is live or away, as its engine lists them,
   * none archived; never one this machine, or a host before it, has. */
  projects: readonly ProjectSummary[]
}

const NONE: readonly ProjectSummary[] = []

const live = (shown: Shown) => shown.state.state === "live"

/** Whether the Window shows a host's rows: while it is live, and as they
 * were while it is away. */
export function holds(shown: Shown): boolean {
  return shown.state.state === "live" || shown.state.state === "away"
}

/** Host `now` as the Window shows it at `at`, after `was`. Another go
 * after a loss is still away; any other state but live drops its
 * Projects. */
export function shownOf(
  was: Shown | undefined,
  now: HostState,
  at: number
): Shown {
  const kept = was?.projects ?? NONE
  switch (now.state) {
    case "live":
      return { name: now.name, state: now, projects: kept }
    case "away":
      return {
        name: now.name,
        state: now,
        away: was?.away ?? at,
        projects: kept,
      }
    case "connecting":
      if (was?.away !== undefined) return was
      return { name: now.name, state: now, projects: NONE }
    default:
      return { name: now.name, state: now, projects: NONE }
  }
}

/** The words for a live host of another build than this window's:
 * `dev.418 vs dev.421`, its own first. None for the same build. */
export function otherBuild(state: HostState): string | undefined {
  if (state.state !== "live") return undefined
  const { build, version, own } = state
  if (build === own.build && version === own.version) return undefined
  const short = (one: { build: string | null; version: string | null }) =>
    one.version === null
      ? (one.build?.slice(0, 7) ?? "?")
      : (/-(dev\.\d+)$/.exec(one.version)?.[1] ?? one.version)
  const there = short({ build, version })
  const here = short(own)
  // The same version of two builds, as two checkouts make: by build.
  return there === here
    ? `${build?.slice(0, 7) ?? "?"} vs ${own.build?.slice(0, 7) ?? "?"}`
    : `${there} vs ${here}`
}

/**
 * The hosts as one Window shows them: their states as the desktop tells
 * them, one engine for each, made as it first goes live and kept for the
 * Window's life, and each one's Projects as its engine lists them. This
 * machine's Projects win an ID one of them has too.
 */
export class KeptHosts implements Readable<readonly Shown[]> {
  readonly #device: HostsDevice
  readonly #shown = new Store<readonly Shown[]>([])
  readonly #engines = new Map<string, Engine>()
  /** Each host's Projects as its engine listed them last. */
  readonly #listed = new Map<string, readonly ProjectSummary[]>()
  #ours: ReadonlySet<ProjectId> = new Set()
  /** The clashes said once in the log, as `host project`. */
  readonly #said = new Set<string>()

  constructor(device: HostsDevice) {
    this.#device = device
  }

  readonly get = (): readonly Shown[] => this.#shown.get()
  readonly subscribe = (listener: () => void) => this.#shown.subscribe(listener)

  /** Follows the desktop's hosts; returns how to stop. */
  follow(): () => void {
    return this.#device.follow((hosts) => this.take(hosts)) ?? (() => {})
  }

  /** Takes the hosts as the desktop tells them now, at `at`. */
  take(hosts: readonly HostState[], at = Date.now()): void {
    const was = new Map(this.get().map((one) => [one.name, one]))
    const now = hosts.map((host) => shownOf(was.get(host.name), host, at))
    for (const one of now) {
      if (!holds(one)) this.#listed.delete(one.name)
      // An engine that said goodbye tries no more: a host live again gets
      // a new one.
      if (live(one) && this.#engines.get(one.name)?.status.state === "refused")
        this.#engines.delete(one.name)
    }
    this.#shown.set(this.#placed(now))
  }

  /** Takes host `name`'s Projects, as its engine listed them, while the
   * Window shows its rows. */
  projects(name: string, listed: readonly ProjectSummary[]): void {
    const host = this.get().find((one) => one.name === name)
    if (!host || !holds(host)) return
    this.#listed.set(name, listed.map(drawnHere))
    this.#shown.set(this.#placed(this.get()))
  }

  /** Takes this machine's Projects, which win an ID a host has too. */
  ours(projects: readonly ProjectSummary[]): void {
    this.#ours = new Set(projects.map((project) => project.id))
    this.#shown.set(this.#placed(this.get()))
  }

  /**
   * Host `name`'s engine: one for the Window's life, made as it is first
   * asked for. It asks the desktop where that engine listens on each
   * connect, once the host is live, so a refused host is not tried again
   * by it, and a restarted engine is found where it listens now.
   */
  engine(name: string): Engine {
    let engine = this.#engines.get(name)
    if (!engine) {
      engine = new Engine(async () => {
        await this.#live(name)
        return this.#device.engine(name)
      })
      this.#engines.set(name, engine)
    }
    return engine
  }

  /** The host a Pane of `project` is on, whose args name host `named`
   * (`hostOfPane`); none for this machine's. */
  hostOf(project: ProjectId, named: string | undefined): string | undefined {
    return hostOfPane(this.get(), this.#ours, project, named)
  }

  /** `pane` of `project` as a pick opens it (`pane.pick`): its args name
   * the host it is on (`hostOf`), so it opens on that host's engine, never
   * on this machine's with another host's Project (ADR 0081); none for
   * this machine's. */
  paneOn(project: ProjectId, pane: PaneState): PaneState {
    return withHost(pane, this.hostOf(project, paneHost(pane)))
  }

  /** Starts host `name`'s engine again there. */
  start(name: string): void {
    this.#device.start(name)
  }

  /** Waits until host `name` is live. */
  #live(name: string): Promise<void> {
    return new Promise((done) => {
      const look = () => {
        const one = this.get().find((host) => host.name === name)
        if (one?.state.state !== "live") return
        stop()
        done()
      }
      const stop = this.subscribe(look)
      look()
    })
  }

  /** `hosts` with each one's Projects as it shows them: those it holds,
   * none archived, and none this machine or a host before it has. Each
   * that shows what it showed keeps its list. */
  #placed(hosts: readonly Shown[]): readonly Shown[] {
    const taken = new Set(this.#ours)
    return hosts.map((host) => {
      const listed = this.#listed.get(host.name)
      if (!listed || !holds(host)) return host
      const mine = [
        ...shownProjects(listed),
        ...listed.filter((project) => project.scratch && !project.archived),
      ].filter((project) => {
        if (!taken.has(project.id)) return true
        this.#clash(host.name, project.id)
        return false
      })
      for (const project of mine) taken.add(project.id)
      return sameEach(mine, host.projects) ? host : { ...host, projects: mine }
    })
  }

  #clash(host: string, project: ProjectId): void {
    const key = `${host} ${project}`
    if (this.#said.has(key)) return
    this.#said.add(key)
    console.warn(
      `banda: ${host} has a Project of the same ID as one shown before it, ${project}: the window shows the first`
    )
  }
}

/** A host's Project as this Window draws it: a picture sign shows its
 * first letter, as only that host's engine reads its picture. */
function drawnHere(project: ProjectSummary): ProjectSummary {
  const { sign, name } = project
  if (sign.kind !== "picture") return project
  const text = [...name][0]?.toUpperCase() ?? ""
  return { ...project, sign: { ...sign, kind: "letters", text } }
}

/** No hosts, as where no Window follows the desktop's. */
const NOWHERE: HostsDevice = {
  follow: () => undefined,
  engine: () => Promise.reject(new Error("No other machine here.")),
  start: () => undefined,
}

/** The Window's hosts, for what it draws; none outside one. */
export const HostsContext = createContext<KeptHosts>(new KeptHosts(NOWHERE))

/** The names of the hosts that are live now. */
export const liveIn = (hosts: readonly Shown[]): string[] =>
  hosts.filter(live).map((host) => host.name)

/** The names of the hosts whose rows the Window does not show. */
export const emptyIn = (hosts: readonly Shown[]): string[] =>
  hosts.filter((host) => !holds(host)).map((host) => host.name)

/** `select` of the hosts, drawn again only as what it selects changes. */
export function useHostsBy<S>(
  select: (hosts: readonly Shown[]) => S,
  equal?: (a: S, b: S) => boolean
): S {
  return useStore(useContext(HostsContext), select, equal)
}

const all = (hosts: readonly Shown[]) => hosts

/** The hosts as the Window shows them, drawn again as any changes. */
export const useHosts = (): readonly Shown[] => useHostsBy(all)

/**
 * The host a Pane of `project` is on: none when this machine has the
 * Project, as it wins an ID a host has too; else host `named`, as the
 * Pane's args keep it (`paneHost`), known yet or not, so the Pane waits
 * for it after a restart; else the host that lists the Project, for a
 * Pane opened where its host went unsaid.
 */
export function hostOfPane(
  hosts: readonly Shown[],
  ours: ReadonlySet<ProjectId>,
  project: ProjectId,
  named: string | undefined
): string | undefined {
  if (ours.has(project)) return undefined
  if (named !== undefined) return named
  return hosts.find((host) => host.projects.some((one) => one.id === project))
    ?.name
}

/** What a Pane on host `name` says while it cannot reach it, as the
 * Window shows that host (`shown`); none while it is live. Not known
 * yet, as before the desktop first tells the hosts, it waits. */
export function reachWords(
  name: string,
  shown: Shown | undefined
): string | undefined {
  if (!shown) return `Waiting for ${name}`
  const { state } = shown
  switch (state.state) {
    case "live":
      return undefined
    case "away":
      return `${name} is away`
    case "connecting":
      return `Connecting to ${name}`
    case "signin":
      return `Sign in to Tailscale to reach ${name}`
    case "stopped":
      return `Banda is stopped on ${name}`
    case "refused":
      return `${name}: ${state.why}`
  }
}

/** The Window's actions a Pane on another host runs: the page's own
 * paste and copy, and the settings. None reaches this machine's files or
 * its engine's Projects. */
const RUNS_ELSEWHERE: ReadonlySet<string> = new Set([
  "edit.paste",
  "edit.paste-plain",
  "edit.copy-image",
  "settings.open",
])

/** What a Pane on host `there` runs of the Window's: those above, and the
 * item actions `items` its Apps say go to their Item's host (ADR 0087,
 * decision 12), as a Thread's snooze, each to an Item of that host's
 * alone (`ownItem`); none of the rest. */
export function runOnHost(
  run: (action: string, args?: Args) => void,
  items: ReadonlySet<string>,
  shownNow: () => Shown | undefined,
  own: { project: ProjectId; item: string | null }
): (action: string, args?: Args) => void {
  return (action, args) => {
    if (RUNS_ELSEWHERE.has(action)) return run(action, args)
    if (!items.has(action)) return
    const asked = ownItem(shownNow(), own, args)
    if (asked) run(action, asked)
  }
}

/**
 * The args of an item action a Pane on another host runs (ADR 0081): its
 * Item, the one the Pane shows where they name none, in the Pane's own
 * Project where they name none. That Project must be one of the host's as
 * the Window shows it (`shown`), so the action goes to its engine, never
 * to one of this machine's, which wins an ID both have, nor another
 * host's; none for another, and nothing runs. A Thread that host has not
 * placed in a Project yet, as one unplaced in No Project, is one of none.
 */
export function ownItem(
  shown: Shown | undefined,
  own: { project: ProjectId; item: string | null },
  args?: Args
): Args | undefined {
  const project = args?.project ?? own.project
  const item = args?.item ?? own.item
  if (typeof project !== "string" || typeof item !== "string") return undefined
  if (!shown?.projects.some((one) => one.id === project)) return undefined
  return { ...args, project, item }
}

/** Where a Pane reaches its engine: this machine's; or another host's,
 * by its name, with what the Window knows of that host yet, and its
 * engine once it knows it. */
export type Reach =
  | { host?: undefined; shown?: undefined; engine: Engine }
  | { host: string; shown: Shown | undefined; engine: Engine | undefined }

/**
 * Where a Pane of `project`, whose args name host `named`, reaches its
 * engine (ADR 0081, decision 4): `engine`, this machine's, for its own
 * Projects; else its host's. Drawn again only as the host it is on, or
 * what the Window knows of that host, changes.
 */
export function useReach(
  engine: Engine,
  project: ProjectId,
  named: string | undefined
): Reach {
  const kept = useContext(HostsContext)
  const on = useCallback(
    () => kept.hostOf(project, named),
    [kept, project, named]
  )
  const host = useStore(kept, on)
  const select = useCallback(
    (hosts: readonly Shown[]) =>
      host === undefined ? undefined : hosts.find((one) => one.name === host),
    [host]
  )
  const shown = useStore(kept, select)
  if (host === undefined) return { engine }
  return { host, shown, engine: shown && kept.engine(host) }
}

/** The engine of a Project, or of `pane` of it, which may name its host
 * (`hostOfPane`): its host's, never this machine's in its place, else
 * this machine's `engine`; the same function while those stay. */
export function useEngineOf(
  engine: Engine
): (project: ProjectId, pane?: PaneState) => Engine {
  const kept = useContext(HostsContext)
  return useCallback(
    (project: ProjectId, pane?: PaneState) => {
      const host = kept.hostOf(project, pane && paneHost(pane))
      return host === undefined ? engine : kept.engine(host)
    },
    [kept, engine]
  )
}

/** How the Window shows host `name` now, as an act asks it; the same
 * function while the Window's hosts stay. */
export function useShownNow(): (name: string) => Shown | undefined {
  const kept = useContext(HostsContext)
  return useCallback(
    (name: string) => kept.get().find((one) => one.name === name),
    [kept]
  )
}

/** A Pane of a Project as a pick opens it (`KeptHosts.paneOn`); the same
 * function while the Window's hosts stay. */
export function usePaneOn(): (
  project: ProjectId,
  pane: PaneState
) => PaneState {
  const kept = useContext(HostsContext)
  return useCallback(
    (project: ProjectId, pane: PaneState) => kept.paneOn(project, pane),
    [kept]
  )
}

/** Tells `hosts` this machine's Projects, as `listed` reads them, which
 * win an ID a host has too (`KeptHosts.ours`). */
export function useOurs(
  hosts: KeptHosts,
  listed: Read<ProjectSummary[]>
): void {
  useEffect(() => {
    if (listed.state === "ready") hosts.ours(listed.value)
  }, [hosts, listed])
}
