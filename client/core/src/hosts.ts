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
  type ProjectId,
  type ProjectSummary,
  type Status,
} from "@banda/contract"
import {
  type AwakeWhy,
  type Battery,
  MACHINE_POWER,
  type Named,
  type Power,
} from "@banda/contract/machines"
import type { HostState } from "./device"
import { paneHost, type PaneState, withHost } from "./pane"
import { openProjects, shownProjects } from "./projects"
import type { Args } from "./run"
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

/** A host as the Window shows it. */
export type Shown = {
  /** Its key in `hosts.toml`, which the Person sees only until its first
   * welcome. */
  name: string
  /** What it says it is called and drawn by, cleaned (ADR 0095, decision
   * 2); as this device last saw it while it says nothing. */
  named: Named
  /** What the desktop says of it, but away through the tries after a
   * loss, until it is live again or says otherwise. */
  state: HostState
  /** Since when it is away, in ms since the epoch: its rows stand still
   * as they were then. */
  away?: number
  /** Its Projects while it is live or away, as its engine lists them,
   * none archived; never one this machine, or a host before it, has. */
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
 * were while it is away. */
export function holds(shown: Shown): boolean {
  return shown.state.state === "live" || shown.state.state === "away"
}

/** Host `now` as the Window shows it at `at`, after `was`. Another go
 * after a loss is still away; any other state but live drops its
 * Projects. Before it said a name, it goes by the one `seen` remembers. */
export function shownOf(
  was: Shown | undefined,
  now: HostState,
  at: number,
  seen: (key: string) => Named = keyNamed
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
      return { name, named, state: now, away: was?.away ?? at, projects: kept }
    case "connecting":
      if (was?.away !== undefined) return was
      return { name, named, state: now, projects: NONE }
    default:
      return { name, named, state: now, projects: NONE }
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

/** A machine as a new Thread picks where it starts (ADR 0095, decision
 * 7). */
export type Machine = {
  /** Its key in `hosts.toml`, a Pane's `args.host`; none for this machine. */
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

  /** This machine and the hosts a new Thread starts on (`machinesOf`),
   * told again only as what they say changes. */
  readonly machines: Readable<readonly Machine[]> = this.#machines

  /** This machine's engine, its own Projects' session (`sessionOf`). */
  readonly #here: Engine | undefined

  /** `here` is this machine's engine; none outside a Window, where no
   * Project is this machine's to act on. */
  constructor(device: HostsDevice, names: Names, here?: Engine) {
    this.#device = device
    this.#names = names
    this.#here = here
    this.#shown.subscribe(() => this.#sayMachines())
  }

  readonly get = (): readonly Shown[] => this.#shown.get()
  readonly subscribe = (listener: () => void) => this.#shown.subscribe(listener)

  /** Host `key`'s name and icon as this device last saw it (`Names`). */
  readonly seen = (key: string): Named => this.#names.seen(key)

  /** Follows the desktop's hosts; returns how to stop. */
  follow(): () => void {
    return this.#device.follow((hosts) => this.take(hosts)) ?? (() => {})
  }

  /** Takes the hosts as the desktop tells them now, at `at`. A host
   * live again has its engine try at once, not after its wait. */
  take(hosts: readonly HostState[], at = Date.now()): void {
    const was = new Map(this.get().map((one) => [one.name, one]))
    const now = hosts.map((host) =>
      shownOf(was.get(host.name), host, at, this.seen)
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
    for (const one of now)
      if (live(one) && was.get(one.name)?.state.state !== "live")
        this.#engines.get(one.name)?.wake()
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
    this.#shown.set(this.#placed(this.get()))
    // Said here too, as the hosts' rows may not change with ours.
    this.#sayMachines()
  }

  /**
   * Host `name`'s engine: one for the Window's life, made as it is first
   * asked for. It asks the desktop where that engine listens on each
   * connect, once the host is live, so a refused host is not tried again
   * by it, and a restarted engine is found where it listens now. What the
   * host says it is called and drawn by, the Window shows from then on.
   */
  engine(name: string): Engine {
    let engine = this.#engines.get(name)
    if (!engine) {
      engine = new Engine(async () => {
        await this.#live(name)
        return this.#device.engine(name)
      })
      this.#engines.set(name, engine)
      this.#names.follow(engine, name, (named) => this.#named(name, named))
      engine.watch((status) => {
        if (status.state === "open" && status.machine)
          this.#scope(name, status.machine)
      })
      this.#hearPowers()
    }
    return engine
  }

  /** The host a Pane of `project` is on, whose args name host `named`
   * (`hostOfPane`); none for this machine's. */
  hostOf(project: ProjectId, named: string | undefined): string | undefined {
    return hostOfPane(this.get(), this.#ourIds, project, named)
  }

  /**
   * The session of the machine that owns `project`, or `pane` of it, whose
   * args, or an act's on it, may name its host (`hostOf`): this machine's
   * engine for its own Projects; else that host's, one for the Window's
   * life (`engine`). Every act an App makes goes to it (ADR 0089, decision
   * 5). It is never this machine's in another's place, so an act never
   * runs on the wrong machine: a host the Window does not know, or does
   * not reach now, refuses at once (`Unreachable`) rather than wait to
   * run by itself once it is back. A Pane `drawn` from it keeps its host's
   * while that host is out of reach: it shows what it showed, and catches
   * up once the host is back.
   */
  sessionOf(
    project: ProjectId,
    pane?: Pick<PaneState, "args">,
    { drawn = false }: { drawn?: boolean } = {}
  ): Engine {
    const host = this.hostOf(project, pane && paneHost(pane))
    if (host === undefined) {
      if (!this.#here) throw new Error("This window has no engine of its own.")
      return this.#here
    }
    const shown = this.get().find((one) => one.name === host)
    if (!shown) {
      const { name } = this.seen(host)
      throw new Unreachable(host, `This window does not reach ${name}`)
    }
    if (drawn || live(shown)) return this.engine(host)
    throw new Unreachable(host, reachWords(host, shown, this.seen)!)
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

  /**
   * `hosts` placed by the one clash rule: an ID shows on the first
   * machine that has it, and on no other, in the sidebar and in a new
   * Thread's picker alike (`machinesOf`). This machine is first, and has
   * every ID it knows (`#ourIds`): its Projects, the archived, missing
   * and scratch ones too, and its Host scope's. A Pane of any of them
   * opens here (`hostOfPane`), so another machine's Project or No
   * Project of one of those IDs, shown, would open this machine's. Then
   * each host whose rows the Window shows, in the order of `hosts.toml`,
   * has its Host scope's ID, once its engine said it, and its Projects
   * as it shows them: those it holds, none archived. Each that shows
   * what it showed stays as it was.
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

/** An act refused at once (`KeptHosts.sessionOf`): the machine that owns
 * its Project, `host`, is one the Window does not reach now, or does not
 * know. It says so in the words its Panes' pill says (`reachWords`). */
export class Unreachable extends Error {
  readonly host: string
  constructor(host: string, words: string) {
    super(words)
    this.name = "Unreachable"
    this.host = host
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

/** The names of the hosts that are live now. */
export const liveIn = (hosts: readonly Shown[]): string[] =>
  hosts.filter(live).map((host) => host.name)

/** The names of the hosts whose rows the Window does not show. */
export const emptyIn = (hosts: readonly Shown[]): string[] =>
  hosts.filter((host) => !holds(host)).map((host) => host.name)

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

/** Host `host`'s name and icon, as the Window shows `hosts`; as this
 * device last saw it (`seen`), while the Window does not show it yet. */
export function namedIn(
  hosts: readonly Shown[],
  host: string,
  seen: (key: string) => Named
): Named {
  return hosts.find((one) => one.name === host)?.named ?? seen(host)
}

/** How long a host has been away at `now`, since `since` (`Shown.away`),
 * as its label says it after "away": nothing under a minute, then
 * minutes, then hours. */
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
 * Why Send waits on a Pane on host `host` (ADR 0095, decision 7), by one
 * rule of whether the Window reaches it: the host as the Window shows it
 * (`shown`), and its engine's connection (`status`). While the host is
 * not live, the pill's words (`reachWords`), so the two say the same at
 * once; away, with when Send goes. While it is live, it connects until
 * its engine is open, or says its engine refused this window. None once
 * both are.
 */
export function heldWords(
  host: string,
  shown: Shown | undefined,
  status: Status["state"],
  seen: (key: string) => Named
): string | undefined {
  const words = reachWords(host, shown, seen)
  if (words !== undefined)
    return shown?.state.state === "away"
      ? `${words}. Send once it is back.`
      : words
  if (status === "open") return undefined
  const { name } = shown?.named ?? seen(host)
  return status === "refused"
    ? `${name} refused this window`
    : `Connecting to ${name}…`
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

/** The Window's own item actions a Pane on another host runs: Archive,
 * which the Item's App sends to its host (ADR 0096). Each goes to an Item
 * of that host's alone, as an App's do. It is for a Pane that runs
 * Archive itself: the key and the Thread menus run it through the Shell's
 * own run, which goes to the Item's host already. */
const ITEMS_ELSEWHERE: ReadonlySet<string> = new Set(["sidebar.archive"])

/** What a Pane on host `there` runs of the Window's: those above, and the
 * item actions `items` its Apps say go to their Item's host (ADR 0087,
 * decision 12), as a Thread's Later, and the Window's own that do, each
 * to an Item of that host's alone (`ownItem`); none of the rest. */
export function runOnHost(
  run: (action: string, args?: Args) => void,
  items: ReadonlySet<string>,
  shownNow: () => Shown | undefined,
  own: { project: ProjectId; item: string | null }
): (action: string, args?: Args) => void {
  return (action, args) => {
    if (RUNS_ELSEWHERE.has(action)) return run(action, args)
    if (!items.has(action) && !ITEMS_ELSEWHERE.has(action)) return
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
