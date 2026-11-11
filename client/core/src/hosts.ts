/**
 * The other machines the Window shows below its own (ADR 0081, decision
 * 4): each host of `hosts.toml` as the desktop reaches it over ssh, with
 * its engine and its Projects. What its Apps list flows into the Window's
 * stores under its name, through one Watches for each host while it is
 * live (`client/web/src/bar/Watches.tsx`). Where a host's engine listens
 * only the desktop knows: its engine asks it on every connect, and the
 * page keeps the address nowhere. What this device remembers of the
 * hosts' names the Window hands in (`Names`), as the device keeps it.
 * Plain, so plain tests cover it; what reads it from React is
 * `react/hosts.ts`.
 */
import {
  type Address,
  Engine,
  PING,
  type ProjectId,
  type ProjectSummary,
  type Status,
  Unreachable,
} from "@banda/contract"
import {
  type AwakeWhy,
  type Battery,
  MACHINE_POWER,
  type Named,
  type Power,
} from "@banda/contract/machines"
import type { HostState } from "./device"
import { type DirectoryMemory, inWindow, type Placed } from "./directory"
import { paneHost, type PaneState, withHost } from "./pane"
import { clock, tickingClock } from "./time"
import { openProjects, shownProjects } from "./projects"
import { inMemory, Waiting, type WaitingStorage } from "./queue"
import { type Readable, sameData, sameEach, Store } from "./store"

/** How the Window reaches the desktop's hosts: `device.hosts`. */
export type HostsDevice = {
  /** Hands `take` the hosts now and as they change; returns how to stop. */
  follow: (take: (hosts: HostState[]) => void) => (() => void) | undefined
  /** Where host `name`'s engine listens now. */
  engine: (name: string) => Promise<Address>
  /** Starts host `name`'s engine again there. */
  start: (name: string) => void
}

/**
 * What this device remembers of the names the hosts say they have, by
 * their keys in `hosts.toml` (ADR 0081, decision 1; ADR 0095, decision
 * 2), so one away or stopped draws as before. The Window hands in the
 * memory the device keeps them in.
 */
export type Names = {
  /** Host `key` as this device last saw it; before its first welcome
   * here, its key with the `desktop` icon. */
  seen: (key: string) => Named
  /** Hands `take` what host `key`'s `engine` says it is called and drawn
   * by, cleaned, from each welcome and each change after, and remembers
   * the last. Returns how to stop. */
  follow: (
    engine: Engine,
    key: string,
    take: (named: Named) => void
  ) => () => void
}

/** A host before this device saw its name: by its key, with the
 * `desktop` icon. */
export const keyNamed = (key: string): Named => ({ name: key, icon: "desktop" })

/** No memory of names, as where no Window keeps one: each host by its
 * key. */
export const FORGETTING: Names = {
  seen: keyNamed,
  follow: () => () => undefined,
}

/** A host as the Window shows it. */
export type Shown = {
  /** Its key in `hosts.toml`, which the Person sees only until its first
   * welcome. */
  name: string
  /** What it says it is called and drawn by, cleaned (ADR 0095, decision
   * 2); as this device last saw it while it says nothing. */
  named: Named
  /** What the desktop says of it, but away through the tries after a
   * loss, until it is live again or says otherwise; and away while its
   * engine answers nothing (`stale`). */
  state: HostState
  /** Its engine answers nothing, though the desktop says it is live (ADR
   * 0082, decision 11): it shows away, as one the desktop says is. */
  stale?: true
  /** Since when the Window does not reach it, in ms since the epoch: away,
   * stopped, or starting again after either. Its rows stand still as they
   * were as of then (`awaySince`). */
  away?: number
  /** When the Window last heard its engine, in ms since the epoch, while
   * it does not reach it: its rows are as of then. None where it never
   * heard it. */
  asOf?: number
  /** Its Projects while the Window shows its rows (`holds`), as its
   * engine lists them, none archived; never one this machine, or a host
   * before it, has. */
  projects: readonly ProjectSummary[]
  /** Its Host scope's ID, where a Thread in its No Project starts, once
   * its engine said it, while the Window shows its rows; none while this
   * machine, or a host before it, has that ID. */
  machine?: ProjectId
  /** Its battery and why it is held awake, cleaned, as its engine says
   * them on `machine.power` (ADR 0097, decision 7): only while it is
   * live, as the last heard is no longer true once it is away; none
   * before its engine says them, and from an engine older than them. */
  power?: Power
}

const NONE: readonly ProjectSummary[] = []

const live = (shown: Shown) => shown.state.state === "live"

/** Whether the Window shows a host's rows: while it is live, and as they
 * were while it does not reach it (`Shown.away`): away, stopped, or
 * starting again after either (ADR 0101, decision 7). */
export function holds(shown: Shown): boolean {
  return shown.state.state === "live" || shown.away !== undefined
}

/** Host `now` as the Window shows it at `at`, after `was`, its engine
 * last `heard` then. Away or stopped, its rows stay as they were, as of
 * when it was last heard. Another go after a loss is still away; one after
 * a stop starts, its rows kept. Any other state but live drops its
 * Projects. Before it said a name, it goes by the one `seen` remembers. */
export function shownOf(
  was: Shown | undefined,
  now: HostState,
  at: number,
  seen: (key: string) => Named = keyNamed,
  heard?: number
): Shown {
  const kept = was?.projects ?? NONE
  const { name } = now
  const named = was?.named ?? seen(name)
  switch (now.state) {
    case "live":
      return {
        name,
        named,
        state: now,
        projects: kept,
        ...(was?.power && { power: was.power }),
      }
    case "away":
    case "stopped": {
      const asOf = was?.asOf ?? heard
      return {
        name,
        named,
        state: now,
        away: was?.away ?? at,
        ...(asOf !== undefined && { asOf }),
        projects: kept,
      }
    }
    case "connecting":
      if (was?.state.state === "stopped") return { ...was, state: now }
      if (was?.away !== undefined) return was
      return { name, named, state: now, projects: NONE }
    default:
      return { name, named, state: now, projects: NONE }
  }
}

/** Since when a host the Window does not reach is out of reach, as its
 * pill, its card and its rows count: when it was last heard, else when
 * the Window found it so; none while the Window reaches it. */
export const awaySince = (shown: Shown): number | undefined =>
  shown.away === undefined ? undefined : (shown.asOf ?? shown.away)

/** When the rows of a host the Window does not reach are from at `now`,
 * as its label says it: "as of 14:02", the day too where it is not
 * today's; none where it never heard it. By 24 hours, as its label has no
 * room for more beside Start. */
export const asOfWords = (shown: Shown, now?: number): string | undefined =>
  shown.asOf === undefined ? undefined : `as of ${asOfClock(shown.asOf, now)}`

const asOfClock = (at: number, now?: number) => clock(at, now, { hours: 24 })

/** A host whose engine answers nothing, as its label's tooltip says why
 * it is away at `now`: "arc has not answered since 14:02". */
export const notAnswered = (
  named: Named,
  heard: number | undefined,
  now?: number
): string =>
  heard === undefined
    ? `${named.name} does not answer`
    : `${named.name} has not answered since ${asOfClock(heard, now)}`

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

/** A machine as a new Thread picks where it starts (ADR 0095, decision
 * 7). */
export type Machine = {
  /** Its key in `hosts.toml`; none for this machine. */
  host?: string
  /** Its name and icon, cleaned (ADR 0095, decision 2); none for this
   * machine, which goes unnamed (decision 4). */
  named?: Named
  /** Its Host scope's ID, where a Thread in its No Project starts; none
   * until its engine first said it. */
  machine?: ProjectId
  /** Whether the Window reaches it now, or shows it as it was. */
  state: "live" | "away"
  /** Since when it is away, in ms since the epoch. */
  away?: number
  /** Its Projects a Thread starts in, pinned first: none archived, none
   * whose folder is missing, none a Thread's own. */
  projects: readonly ProjectSummary[]
}

/** This machine as the Window lists it: its Projects, as its engine
 * lists them, and its Host scope's ID, once its engine said it. */
export type Ours = {
  machine?: ProjectId
  projects: readonly ProjectSummary[]
}

/**
 * The hosts as one Window shows them: their states as the desktop tells
 * them, one engine for each, made as it first goes live and kept for the
 * Window's life, and each one's Projects and Host scope as its engine
 * says them. An ID shows on one machine only, this one first (`#placed`).
 */
export class KeptHosts implements Readable<readonly Shown[]> {
  readonly #device: HostsDevice
  readonly #names: Names
  readonly #shown = new Store<readonly Shown[]>([])
  readonly #engines = new Map<string, Engine>()
  /** Each host's Projects as its engine listed them last. */
  readonly #listed = new Map<string, readonly ProjectSummary[]>()
  #ourIds: ReadonlySet<ProjectId> = new Set()
  /** This machine's Projects and Host scope, beside their IDs in `#ourIds`. */
  #ours: Ours = { projects: NONE }
  /** Each host's Host scope's ID, as its engine's welcome said it. */
  readonly #scopes = new Map<string, ProjectId>()
  readonly #machines = new Store<readonly Machine[]>(machinesOf(this.#ours, []))
  /** The clashes said once in the log, as `host project`. */
  readonly #said = new Set<string>()
  /** Each live host's `machine.power` on its engine, and how to stop
   * hearing it; kept once that engine ended or refused it, so it is not
   * asked again until the host is live again. */
  readonly #powers = new Map<string, { engine: Engine; stop: () => void }>()
  /** The hosts as the desktop told them last. */
  #told: readonly HostState[] = []

  /** This machine and the hosts a new Thread starts on (`machinesOf`),
   * told again only as what they say changes. */
  readonly machines: Readable<readonly Machine[]> = this.#machines

  /** The Window's one clock for the words of a host it does not reach
   * (#988): each second while anything listens, so every pill, card and
   * label says the same at once. */
  readonly clock: Readable<number> = tickingClock(1_000)

  /** This machine's engine, its own Projects' session (`sessionOf`). */
  readonly #here: Engine | undefined

  /** The messages that wait for a host to be back (ADR 0105): each goes
   * once the Window reaches that host again, as it is live and its engine
   * open and answering. */
  readonly waiting: Waiting

  /** Which machine has each Project, as this device found it last. */
  readonly #directory: DirectoryMemory

  /** `here` is this machine's engine; none outside a Window, where no
   * Project is this machine's to act on. What waits is kept in `waiting`,
   * the device's storage in a Window, which every window on the device
   * shares; only the main window `drains` it: sends it, and gives back
   * what does not go (#1299). The `directory` is kept where the Window
   * keeps it, the same storage; else in this window alone. */
  constructor(
    device: HostsDevice,
    names: Names,
    here?: Engine,
    {
      waiting = inMemory(),
      drains = true,
      directory = inWindow(),
    }: {
      waiting?: WaitingStorage
      drains?: boolean
      directory?: DirectoryMemory
    } = {}
  ) {
    this.#device = device
    this.#names = names
    this.#here = here
    this.#directory = directory
    this.#shown.subscribe(() => this.#sayMachines())
    this.waiting = new Waiting(waiting, {
      named: (host) => namedIn(this.get(), host, this.seen).name,
      // A message queued now goes in its host's time as its engine heard
      // it last.
      ahead: (host) => this.#engines.get(host)?.offset,
      drains,
    })
    this.waiting.subscribe(() => this.#sendWaiting())
  }

  readonly get = (): readonly Shown[] => this.#shown.get()
  readonly subscribe = (listener: () => void) => this.#shown.subscribe(listener)

  /** Host `key`'s name and icon as this device last saw it (`Names`). */
  readonly seen = (key: string): Named => this.#names.seen(key)

  /** Follows the desktop's hosts, and what waits for them; returns how to
   * stop. */
  follow(): () => void {
    const waiting = this.waiting.start()
    const hosts = this.#device.follow((hosts) => this.take(hosts))
    return () => {
      hosts?.()
      waiting()
    }
  }

  /**
   * Takes the hosts as the desktop tells them now, at `at`. A host live
   * again has its engine try at once, not after its wait. One not live,
   * or gone from `hosts.toml`, has its engine away (`Engine.away`): an
   * act to it fails at once, in the words of its pill, and one on its way
   * fails as one that may have run, never to go later by itself (ADR 0082,
   * decision 16; ADR 0106, law 4). One live whose engine answers nothing
   * (stale) shows away, as of when it was last heard, and its engine stays
   * open to hear it answer.
   */
  take(hosts: readonly HostState[], at = Date.now()): void {
    this.#told = hosts
    const was = new Map(this.get().map((one) => [one.name, one]))
    const now = hosts.map((host) =>
      this.#shownNow(was.get(host.name), host, at)
    )
    for (const one of now) {
      if (!holds(one)) this.#listed.delete(one.name)
      // An engine that said goodbye tries no more: a host live again gets
      // a new one.
      if (live(one) && this.#engines.get(one.name)?.status.state === "refused")
        this.#engines.delete(one.name)
    }
    this.#shown.set(this.#placed(now))
    this.#hearPowers()
    for (const [name, engine] of this.#engines) {
      const told = hosts.find((host) => host.name === name)
      if (told?.state !== "live") engine.away(this.#unreachable(name))
      else if (was.get(name)?.state.state !== "live") engine.wake()
    }
    this.#sendWaiting()
  }

  /** Sends what waits for each host the Window reaches now: live, its
   * engine open and answering. Its engine is made for it if need be. Only
   * the main window sends. */
  #sendWaiting(): void {
    if (!this.waiting.drains) return
    const hosts = new Set(this.waiting.get().map((wait) => wait.host))
    for (const shown of this.get()) {
      if (!hosts.has(shown.name) || !live(shown)) continue
      const engine = this.engine(shown.name)
      if (engine.status.state === "open" && !engine.stale)
        this.waiting.send(shown.name, engine)
    }
  }

  /** Host `told` as the Window shows it at `at`, after `was`: as the
   * desktop tells it, but away while its engine answers nothing. */
  #shownNow(was: Shown | undefined, told: HostState, at: number): Shown {
    const engine = this.#engines.get(told.name)
    const heard = engine?.heard
    if (told.state !== "live" || !engine?.stale)
      return shownOf(was, told, at, this.seen, heard)
    const { name, ssh, banda } = told
    const why = notAnswered(was?.named ?? this.seen(name), heard)
    const away: HostState = {
      name,
      ssh,
      ...(banda !== undefined && { banda }),
      state: "away",
      why,
    }
    return { ...shownOf(was, away, at, this.seen, heard), stale: true }
  }

  /** Takes host `name`'s Projects, as its engine listed them, while the
   * Window shows its rows. */
  projects(name: string, listed: readonly ProjectSummary[]): void {
    const host = this.get().find((one) => one.name === name)
    if (!host || !holds(host)) return
    this.#listed.set(name, listed.map(drawnHere))
    this.#shown.set(this.#placed(this.get()))
  }

  /** Takes this machine's Projects, which win an ID a host has too, and
   * its Host scope's ID, `machine`, which a Pane of its No Project is in. */
  ours(projects: readonly ProjectSummary[], machine?: ProjectId): void {
    const ids = projects.map((project) => project.id)
    this.#ourIds = new Set(machine === undefined ? ids : [...ids, machine])
    this.#ours = { machine, projects }
    // The directory keeps them as this machine's, once its engine said
    // its ID, so its Panes are its own from a window's first moment.
    if (machine !== undefined) this.#learn(this.#ourIds, { machine })
    this.#shown.set(this.#placed(this.get()))
    // Said here too, as the hosts' rows may not change with ours.
    this.#sayMachines()
  }

  /**
   * Takes a Project this machine's engine just answered as made, before
   * its list says so: what opens in it at once, as the first Thread of
   * one the Person added, is this machine's, not a Project no machine has.
   */
  added(project: ProjectSummary): void {
    const others = this.#ours.projects.filter((one) => one.id !== project.id)
    this.ours([...others, project], this.#ours.machine)
  }

  /**
   * Reads this machine's Projects again from its engine, for one no
   * machine the Window knows has: its list is read as the window comes
   * to the front, so a Project added since, as by `banda project add`, is
   * not on it yet. Where that read fails, what the Window knows stays.
   */
  async reread(): Promise<void> {
    try {
      const listed = await this.#here?.call("projects.list", {})
      if (listed) this.ours(listed, this.#ours.machine)
    } catch {
      // The act that asked is refused, in its words.
    }
  }

  /**
   * Host `name`'s engine: one for the Window's life, made as it is first
   * asked for. It asks the desktop where that engine listens on each
   * connect while the host is live, so a refused host is not tried again
   * by it, and a restarted engine is found where it listens now. While
   * the host is not live it is away, and tries again as the host is live
   * (`take`). A mark it loses with the connection names the host, as the
   * link may drop before the desktop says the host is away. What the host
   * says it is called and drawn by, the Window shows from then on.
   */
  engine(name: string): Engine {
    let engine = this.#engines.get(name)
    if (!engine) {
      engine = new Engine(
        async () => {
          const one = this.#told.find((host) => host.name === name)
          if (one?.state !== "live") throw this.#unreachable(name)
          return this.#device.engine(name)
        },
        {
          unreachable: () => this.#unreachable(name),
          // Another machine's engine is asked whether it still answers:
          // stale, its host shows away until it answers again.
          ping: PING,
          onStale: () => this.take(this.#told),
        }
      )
      this.#engines.set(name, engine)
      this.#names.follow(engine, name, (named) => this.#named(name, named))
      engine.watch((status) => {
        if (status.state !== "open") return
        if (status.machine) this.#scope(name, status.machine)
        // What waits for the host goes as its engine is open again.
        this.#sendWaiting()
      })
      this.#hearPowers()
    }
    return engine
  }

  /**
   * The machine that has `project` (ADR 0106, decision 1): none for this
   * machine, as it wins an ID a host has too; else the host whose rows
   * list it now, or whose No Project it is; else the one the directory
   * found last, where this device kept it, so a Pane restored while its
   * host is away goes there; else host `named`, as the args of an
   * arrangement written before the directory kept it (`paneHost`); else
   * `null`: no machine the Window knows has it, and an act on it fails
   * closed, never on this machine in its place.
   */
  hostOf(project: ProjectId, named?: string): string | undefined | null {
    if (this.#ourIds.has(project)) return undefined
    const listing = this.get().find(
      (host) =>
        host.machine === project ||
        host.projects.some((one) => one.id === project)
    )
    if (listing) return listing.name
    // Its own keys alone: an ID as "constructor" is no place the device kept.
    const kept = this.#directory.read()
    if (Object.hasOwn(kept, project)) return this.#reached(kept[project]!)
    return named ?? null
  }

  /**
   * The machine a place the directory kept is, as the Window reaches it
   * now: this one by its ID; a host by the ID its engine said, so one
   * renamed in `hosts.toml` is still found once it was reached; else by
   * the key it was kept with.
   */
  #reached({ machine, host }: Placed): string | undefined {
    if (machine !== undefined) {
      if (machine === this.#ours.machine) return undefined
      for (const [name, scope] of this.#scopes)
        if (scope === machine && this.get().some((one) => one.name === name))
          return name
    }
    return host
  }

  /** Keeps `placed` for those of `projects` the directory says something
   * else of, in one write. */
  #learn(projects: Iterable<ProjectId>, placed: Placed): void {
    const kept = this.#directory.read()
    const fresh = [...projects]
      .filter((id) => !sameData(kept[id], placed))
      .map((id) => [id, placed] as const)
    if (fresh.length > 0) this.#directory.putAll(fresh)
  }

  /**
   * The session of the machine that owns `project`, or `pane` of it, whose
   * args may name its host as an arrangement written before the directory
   * did (`hostOf`): this machine's engine for its own Projects; else that
   * host's, one for the Window's life (`engine`). Every act an App makes
   * goes to it (ADR 0089, decision 5). It is never this machine's in
   * another's place, so an act never runs on the wrong machine: a host the
   * Window does not know, or does not reach now, refuses at once
   * (`Unreachable`) rather than wait to run by itself once it is back, and
   * so does a Project no machine the Window knows has (ADR 0106, law 3). A
   * Pane `drawn` from it keeps its host's while that host is out of reach:
   * it shows what it showed, and catches up once the host is back.
   */
  sessionOf(
    project: ProjectId,
    pane?: Pick<PaneState, "args">,
    { drawn = false }: { drawn?: boolean } = {}
  ): Engine {
    const host = this.hostOf(project, pane && paneHost(pane))
    if (host === null) throw new Unreachable("", UNKNOWN, { machine: "" })
    if (host === undefined) {
      if (!this.#here) throw new Error("This window has no engine of its own.")
      return this.#here
    }
    const shown = this.get().find((one) => one.name === host)
    if (shown && (drawn || live(shown))) return this.engine(host)
    throw this.#unreachable(host)
  }

  /**
   * Why an act on host `name` is refused now: in the words its Panes'
   * pill says, as "arc is away", by the name it says it has, since when
   * it is away; while it is live, as Send says it while its engine is not
   * open, "Connecting to arc"; for a host the Window does not know, as
   * one taken out of hosts.toml, "This window does not reach arc".
   */
  #unreachable(name: string): Unreachable {
    const shown = this.get().find((one) => one.name === name)
    const machine = (shown?.named ?? this.seen(name)).name
    const words = shown
      ? (reachWords(name, shown, this.seen) ?? `Connecting to ${machine}`)
      : `This window does not reach ${machine}`
    return new Unreachable(name, words, { machine, as_of: shown?.away })
  }

  /**
   * `pane` of `project` as the arrangement keeps it, as a pick or a Pane
   * opens or changes it: its args name no host, as the directory says
   * which machine has its Project (ADR 0106, decision 1). A host its args
   * name, as an arrangement written before kept it, the directory takes
   * first where it knows nothing of that Project, so the Pane still goes
   * there after a restart; so does the host of the Pane that opens it,
   * `opener`, whose Project it is though that host has not listed it yet.
   */
  paneOn(project: ProjectId, pane: PaneState, opener?: string): PaneState {
    const named = paneHost(pane)
    const host = named ?? opener
    if (host !== undefined && this.hostOf(project) === null)
      this.#learn([project], { host })
    return named === undefined ? pane : withHost(pane, undefined)
  }

  /** The Apps each host's engine last listed in its welcome, kept from
   * the first time the router asked (`modulesOf`), watched once each. */
  readonly #welcomed = new WeakMap<Engine, readonly string[] | undefined>()

  /**
   * The Apps host `name`'s engine runs, as its welcome listed them while
   * it was open last (ADR 0106, law 6): the router's word on whether an
   * App is there. None before its engine was first open since it was
   * asked, so an App is not taken for missing before that host said.
   */
  modulesOf(name: string): readonly string[] | undefined {
    const engine = this.#engines.get(name)
    if (!engine) return undefined
    if (!this.#welcomed.has(engine)) {
      // Watched once, though asked on every draw while that host is away.
      this.#welcomed.set(engine, undefined)
      const said = (status: Status) => {
        if (status.state === "open") this.#welcomed.set(engine, status.modules)
      }
      said(engine.status)
      engine.watch(said)
    }
    return this.#welcomed.get(engine)
  }

  /** Starts host `name`'s engine again there. */
  start(name: string): void {
    this.#device.start(name)
  }

  /** Takes what host `name` says it is called and drawn by now. */
  #named(name: string, named: Named): void {
    this.#shown.set(
      this.get().map((one) =>
        one.name !== name || sameData(one.named, named)
          ? one
          : { ...one, named }
      )
    )
  }

  /**
   * Hears the battery of each live host whose engine is made, on
   * `machine.power`, and lets go of each other's (ADR 0097, decision 7):
   * what a host away said is no longer true. An engine that refuses the
   * stream, as an older one does, or ends it, is not asked again until
   * its host is live again.
   */
  #hearPowers(): void {
    const now = new Set(liveIn(this.get()))
    for (const [name, heard] of this.#powers) {
      if (now.has(name) && this.#engines.get(name) === heard.engine) continue
      heard.stop()
      this.#powers.delete(name)
    }
    for (const name of now) {
      const engine = this.#engines.get(name)
      if (!engine || this.#powers.has(name)) continue
      const stop = hearPower(
        engine,
        (said) => this.#power(name, cleanPower(said)),
        () => this.#power(name, undefined)
      )
      this.#powers.set(name, { engine, stop })
    }
  }

  /** Takes what host `name` says of its power now, while it is live;
   * none, as its engine ends the stream, or the host goes away. */
  #power(name: string, power: Power | undefined): void {
    const hosts = this.get()
    const at = hosts.findIndex((one) => one.name === name)
    const one = hosts[at]
    if (!one || sameData(one.power, power)) return
    if (power !== undefined && !live(one)) return
    const now = { ...one, power }
    if (power === undefined) delete now.power
    this.#shown.set(hosts.map((host, i) => (i === at ? now : host)))
  }

  /** Takes host `name`'s Host scope's ID, as its engine said it. */
  #scope(name: string, machine: ProjectId): void {
    if (this.#scopes.get(name) === machine) return
    this.#scopes.set(name, machine)
    this.#shown.set(this.#placed(this.get()))
  }

  /** Tells the machines again, where they say something new. */
  #sayMachines(): void {
    const now = machinesOf(this.#ours, this.get())
    if (!sameData(now, this.#machines.get())) this.#machines.set(now)
  }

  /**
   * `hosts` placed by the one clash rule: an ID shows on the first
   * machine that has it, and on no other, in the sidebar and in a new
   * Thread's picker alike (`machinesOf`). This machine is first, and has
   * every ID it knows (`#ourIds`): its Projects, the archived, missing
   * and scratch ones too, and its Host scope's. A Pane of any of them
   * opens here (`hostOf`), so another machine's Project or No
   * Project of one of those IDs, shown, would open this machine's. Then
   * each host whose rows the Window shows, in the order of `hosts.toml`,
   * has its Host scope's ID, once its engine said it, and its Projects
   * as it shows them: those it holds, none archived. Each that shows
   * what it showed stays as it was. The directory keeps where each is,
   * its archived ones too, as a Pane opens one from the Archive.
   */
  #placed(hosts: readonly Shown[]): readonly Shown[] {
    const taken = new Set(this.#ourIds)
    const free = (host: string, id: ProjectId) => {
      if (taken.has(id)) {
        this.#clash(host, id)
        return false
      }
      taken.add(id)
      return true
    }
    return hosts.map((host) => {
      if (!holds(host)) return host
      const { name } = host
      const said = this.#scopes.get(name)
      const machine = said !== undefined && free(name, said) ? said : undefined
      const listed = this.#listed.get(name) ?? NONE
      const projects = [
        ...shownProjects(listed),
        ...listed.filter((project) => project.scratch && !project.archived),
      ].filter((project) => free(name, project.id))
      const archived = listed.filter(
        (project) => project.archived && !taken.has(project.id)
      )
      const place = { ...(said !== undefined && { machine: said }), host: name }
      this.#learn(
        [
          ...[...projects, ...archived].map(({ id }) => id),
          ...(machine === undefined ? [] : [machine]),
        ],
        place
      )
      return machine === host.machine && sameEach(projects, host.projects)
        ? host
        : { ...host, machine, projects }
    })
  }

  #clash(host: string, id: ProjectId): void {
    const key = `${host} ${id}`
    if (this.#said.has(key)) return
    this.#said.add(key)
    console.warn(
      `banda: ${host} has a Project or a Host scope of an ID shown before it, ${id}: the window shows the first`
    )
  }
}

/**
 * The machines a new Thread starts on (ADR 0095, decision 7): this one
 * first, unnamed; then each host whose rows the Window shows, live or
 * away, by its name and icon. Each with its Host scope's ID, once its
 * engine said it, and its open Projects, pinned first: none archived,
 * none whose folder is missing, none a Thread's own. `hosts` are as the
 * Window places them (`KeptHosts`), so an ID this machine, or a host
 * before, has shows on that one only, as in the sidebar.
 */
export function machinesOf(ours: Ours, hosts: readonly Shown[]): Machine[] {
  const open = (projects: readonly ProjectSummary[]) =>
    openProjects(shownProjects(projects))
  const machines: Machine[] = [
    { machine: ours.machine, state: "live", projects: open(ours.projects) },
  ]
  for (const host of hosts) {
    const { state } = host.state
    if (state !== "live" && state !== "away") continue
    machines.push({
      host: host.name,
      named: host.named,
      machine: host.machine,
      state,
      away: host.away,
      projects: open(host.projects),
    })
  }
  return machines
}

/** Why an act on a Project no machine the Window knows has is refused,
 * and what a Pane of it shows (ADR 0106, law 3): it fails closed. */
export const UNKNOWN = "This window does not reach that machine"

/** An act refused at once (`KeptHosts.sessionOf`, `Engine.away`): the
 * machine that owns its Project is one the Window does not reach now, or
 * does not know. The contract's, handed on with the hosts, so an App
 * takes it from where it takes them. */
export { Unreachable }

/** A host's Project as this Window draws it: a picture sign shows its
 * first letter, as only that host's engine reads its picture. */
function drawnHere(project: ProjectSummary): ProjectSummary {
  const { sign, name } = project
  if (sign.kind !== "picture") return project
  const text = [...name][0]?.toUpperCase() ?? ""
  return { ...project, sign: { ...sign, kind: "letters", text } }
}

/** The names of the hosts that are live now. */
export const liveIn = (hosts: readonly Shown[]): string[] =>
  hosts.filter(live).map((host) => host.name)

/** The names of the hosts whose rows the Window does not show. */
export const emptyIn = (hosts: readonly Shown[]): string[] =>
  hosts.filter((host) => !holds(host)).map((host) => host.name)

/** Host `host`'s name and icon, as the Window shows `hosts`; as this
 * device last saw it (`seen`), while the Window does not show it yet. */
export function namedIn(
  hosts: readonly Shown[],
  host: string,
  seen: (key: string) => Named
): Named {
  return hosts.find((one) => one.name === host)?.named ?? seen(host)
}

/** How long a host has been away at `now`, since `since` (`awaySince`),
 * as its pill and its card say it after "away": nothing under a minute,
 * then minutes, then hours. Its label says instead what its rows are as
 * of (`asOfWords`). */
export function awayFor(
  since: number | undefined,
  now: number
): string | undefined {
  const minutes = since === undefined ? 0 : Math.floor((now - since) / 60_000)
  if (minutes < 1) return undefined
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`
}

/** Hears `machine.power` on `engine`: a stream of the machine's that
 * the contract's methods do not list, as `machine.named` is. */
function hearPower(
  engine: Engine,
  onPiece: (said: unknown) => void,
  onEnd: () => void
): () => void {
  const hear = engine.stream.bind(engine) as unknown as (
    project: undefined,
    method: string,
    params: object,
    onPiece: (piece: unknown) => void,
    onEnd: () => void
  ) => () => void
  return hear(undefined, MACHINE_POWER, {}, onPiece, onEnd)
}

/** Whether `said` is one of the two whys a machine is held awake for. */
const isWhy = (said: unknown): said is AwakeWhy =>
  said === "working" || said === "plugged-in"

/** A whole number from `least` to `most`, if `said` is one. */
const whole = (said: unknown, least: number, most: number) =>
  typeof said === "number" &&
  Number.isInteger(said) &&
  said >= least &&
  said <= most
    ? said
    : undefined

/**
 * What another machine says of its power, as the page takes it (ADR
 * 0097, decision 6): a battery only where each word of it is one, its
 * percent from 0 to 100 and its time in whole minutes, else none; a why
 * only of the two, else none.
 */
export function cleanPower(said: unknown): Power {
  const { battery, awake } = (
    typeof said === "object" && said !== null ? said : {}
  ) as { battery?: unknown; awake?: unknown }
  const why = isWhy(awake) ? awake : null
  if (typeof battery !== "object" || battery === null) return { awake: why }
  const { percent, charging, on_power, left } = battery as Record<
    string,
    unknown
  >
  const at = whole(percent, 0, 100)
  const time = whole(left, 0, 100 * 60)
  if (
    at === undefined ||
    typeof charging !== "boolean" ||
    typeof on_power !== "boolean"
  )
    return { awake: why }
  return {
    battery: {
      percent: at,
      charging,
      on_power,
      ...(time !== undefined && { left: time }),
    },
    awake: why,
  }
}

/** Minutes as a clock says a time left: `2:02`. */
const hoursOf = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`

/** Whether a battery is on battery, not on power: what the warning and
 * its icon read. */
export const onBattery = (battery: Battery): boolean =>
  !battery.on_power && !battery.charging

/**
 * Another machine's battery in full, as Settings, its hover and the
 * warning say it (ADR 0097, decision 7): "42% · on battery · 2:02 left",
 * "67% · charging · 0:48 to full", "80% · on power". A time its system
 * does not know yet is left out, and so is one on power while it does not
 * charge.
 */
export function batteryWords(battery: Battery): string {
  const { percent, charging, left } = battery
  const state = charging
    ? "charging"
    : onBattery(battery)
      ? "on battery"
      : "on power"
  const time =
    left === undefined || state === "on power"
      ? []
      : [`${hoursOf(left)} ${charging ? "to full" : "left"}`]
  return [`${percent}%`, state, ...time].join(" · ")
}

/** How many Agents work on a machine, with their verb: "1 Agent
 * works", "2 Agents work". */
export const agentsWork = (working: number): string =>
  working === 1 ? "1 Agent works" : `${working} Agents work`

/**
 * Why another machine is awake now, by what it says (`Power.awake`) and
 * how many of its Agents' Turns run in this window's lists (ADR 0097,
 * decision 7): as Settings says it under its Battery line, "Kept awake:
 * 2 Agents work there.", and as its hover says it beside Awake, "While 2
 * Agents work there". Held for Agents with none running, it is the 10
 * minutes after its last Turn. A window that has none of its lists
 * (`undefined`), as a popped-out one, says neither.
 */
export function awakeWords(
  awake: AwakeWhy | null,
  working: number | undefined
): { line: string; short: string } {
  switch (awake) {
    case "working":
      return working === undefined
        ? {
            line: "Kept awake: for its Agents.",
            short: "For its Agents",
          }
        : working > 0
          ? {
              line: `Kept awake: ${agentsWork(working)} there.`,
              short: `While ${agentsWork(working)} there`,
            }
          : {
              line: "Kept awake: for 10 minutes after its last Turn.",
              short: "For 10 minutes after its last Turn",
            }
    case "plugged-in":
      return {
        line: "Kept awake: plugged in, its switch on.",
        short: "While plugged in, its switch on",
      }
    default:
      return {
        line: "Sleeps by itself when idle.",
        short: "Sleeps by itself when idle",
      }
  }
}

/** What a Pane on host `host` says while it cannot reach it, as the
 * Window shows that host (`shown`), by the name it says it has, or the
 * one this device last saw (`seen`); none while it is live. Not known
 * yet, as before the desktop first tells the hosts, it waits. */
export function reachWords(
  host: string,
  shown: Shown | undefined,
  seen: (key: string) => Named
): string | undefined {
  const { name } = shown?.named ?? seen(host)
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

/**
 * Why the Window does not reach host `host` now, by one rule: the host as
 * the Window shows it (`shown`), and its engine's connection (`status`).
 * While the host is not live, the pill's words (`reachWords`), so the two
 * say the same at once. While it is live, it connects until its engine is
 * open, or says its engine refused this window. None once both are. What
 * goes now or not at all, as a reply's Run, is refused in these words.
 */
export function unreachedWords(
  host: string,
  shown: Shown | undefined,
  status: Status["state"],
  seen: (key: string) => Named
): string | undefined {
  const words = reachWords(host, shown, seen)
  if (words !== undefined || status === "open") return words
  const { name } = shown?.named ?? seen(host)
  return status === "refused"
    ? `${name} refused this window`
    : `Connecting to ${name}…`
}

/**
 * Why Send waits on a Pane on host `host` (ADR 0095, decision 7), as
 * `unreachedWords` says it; away, with when Send goes.
 */
export function heldWords(
  host: string,
  shown: Shown | undefined,
  status: Status["state"],
  seen: (key: string) => Named
): string | undefined {
  const words = unreachedWords(host, shown, status, seen)
  return shown?.state.state === "away"
    ? `${words}. Send once it is back.`
    : words
}
