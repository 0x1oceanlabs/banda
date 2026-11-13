/**
 * The hosts from React (ADR 0081, decision 4): the Window gives what it
 * draws its `KeptHosts`, and each part reads what it needs of them by
 * selector, drawn again only as that changes.
 */
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react"
import {
  awayFor,
  FORGETTING,
  type HostsDevice,
  KeptHosts,
  type Machine,
  namedIn,
  type Shown,
  thisNamed,
} from "../hosts"
import { HERE, paneHost, type PaneState } from "../pane"
import { sameData } from "../store"
import { useSelected, useStore } from "./store"

/** No hosts, as where no Window follows the desktop's. */
const NOWHERE: HostsDevice = {
  follow: () => undefined,
  engine: () => Promise.reject(new Error("No other machine here.")),
  start: () => undefined,
}

/** The Window's hosts, for what it draws; none outside one. */
export const HostsContext = createContext<KeptHosts>(
  new KeptHosts(NOWHERE, FORGETTING)
)

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

/** Host `host` as the Window shows it, drawn again as that changes; none
 * for no host, as this machine's Panes name none, or one the Window does
 * not know yet. */
export function useShownOf(host: string | undefined): Shown | undefined {
  const select = useCallback(
    (hosts: readonly Shown[]) =>
      host === undefined ? undefined : hosts.find((one) => one.name === host),
    [host]
  )
  return useHostsBy(select)
}

/** The machine that has `project` (`KeptHosts.hostOf`), drawn again as
 * that changes. */
function useHostOf(project: ProjectId, named: string | undefined) {
  const kept = useContext(HostsContext)
  const on = useCallback(
    () => kept.hostOf(project, named),
    [kept, project, named]
  )
  return useStore(kept, on)
}

/**
 * The other machine that has `project`, by its key in `hosts.toml`, and
 * as the Window shows it now; neither for this machine's, nor for one no
 * machine the Window knows has. What an App reads of a Pane's place (ADR
 * 0106, decision 1), which hands it no engine: its acts go through
 * `WindowApi.sessionOf`.
 */
export function usePlaced(
  project: ProjectId,
  named: string | undefined
): { host?: string; shown?: Shown } {
  const host = useHostOf(project, named) ?? undefined
  const shown = useShownOf(host)
  return host === undefined ? {} : { host, shown }
}

/**
 * The machine that has `project`, by its key, `HERE` for this one, and as
 * the Window shows it now (`KeptHosts.shown`); none for a Project no
 * machine the Window knows has. What a Pane says of its machine while it
 * cannot reach it, it says by this, whichever machine that is (ADR 0124).
 */
export function useMachineOf(
  project: ProjectId,
  named: string | undefined
): { key: string; shown: Shown | undefined } | undefined {
  const kept = useContext(HostsContext)
  const host = useHostOf(project, named)
  const there = useShownOf(host ?? undefined)
  const here = useStore(kept.here, itself)
  return useMemo(
    () =>
      host === null
        ? undefined
        : host === undefined
          ? { key: HERE, shown: here }
          : { key: host, shown: there },
    [host, here, there]
  )
}

/** Where a Pane reaches its engine: this machine's; or another host's,
 * by its name, with what the Window knows of that host yet, and its
 * engine once it knows it; or none, `host` null, as no machine the
 * Window knows has its Project. */
export type Reach =
  | { host?: undefined; shown?: undefined; engine: Engine }
  | { host: string; shown: Shown | undefined; engine: Engine | undefined }
  | { host: null; shown?: undefined; engine?: undefined }

/**
 * Where a Pane of `project` reaches its engine (ADR 0081, decision 4),
 * its machine as the directory says, its args naming host `named` only
 * as an arrangement written before kept it (`KeptHosts.hostOf`): the
 * session it is drawn from (`KeptHosts.sessionOf`), this machine's for
 * its own Projects, else its host's, kept while that host is out of
 * reach, as after a restart while it is away; none while the Window does
 * not know that host yet; and none, failing closed, for a Project no
 * machine the Window knows has (ADR 0106, decision 1). Drawn again only
 * as the host it is on, or what the Window knows of that host, changes.
 */
export function useReach(project: ProjectId, named: string | undefined): Reach {
  const kept = useContext(HostsContext)
  const host = useHostOf(project, named)
  const shown = useShownOf(host ?? undefined)
  if (host === null) return { host }
  // Drawn from this machine's too, while its engine is out of reach.
  if (host === undefined)
    return { engine: kept.sessionOf(project, undefined, { drawn: true }) }
  const pane = { args: { host } }
  return {
    host,
    shown,
    engine: shown && kept.sessionOf(project, pane, { drawn: true }),
  }
}

/** The other host a Pane of `project` is on (`KeptHosts.hostOf`, its args
 * naming host `named` only as an arrangement written before kept it), by
 * its name and icon, or the one this device last saw (`KeptHosts.seen`);
 * none for this machine's, for one no machine the Window knows has, or
 * with no Pane yet. Drawn again only as they change. */
export function useNamedOf(
  project: ProjectId | undefined,
  named: string | undefined
): Named | undefined {
  const kept = useContext(HostsContext)
  const select = useCallback(
    (hosts: readonly Shown[]) => {
      const host =
        project === undefined ? undefined : kept.hostOf(project, named)
      return host === undefined || host === null
        ? undefined
        : namedIn(hosts, host, kept.seen)
    },
    [kept, project, named]
  )
  return useStore(kept, select, sameData)
}

const anyHost = (hosts: readonly Shown[]) => hosts.length > 0
const itself = <T>(one: T) => one

/** Whether `hosts.toml` has another machine, drawn again only as that
 * changes. */
export const useAnyHost = (): boolean => useHostsBy(anyHost)

/** This machine's name and icon (`KeptHosts.hereNamed`); none until its
 * engine first says them. */
export const useHereNamed = (): Named | undefined =>
  useStore(useContext(HostsContext).hereNamed, itself)

/**
 * Where the Person writes to `pane` of `project` from, for its Agent (ADR
 * 0122): this window's machine, by its name, and whether that is the
 * machine that has the Pane; none until this machine's engine said its
 * name. Worked out from the Pane, so an App never asks where it is (ADR
 * 0106, law 6).
 */
export function useWrittenFrom(
  project: ProjectId,
  pane: Pick<PaneState, "args">
): { machine: string; here: boolean } | null {
  const machine = useHereNamed()?.name
  const here = useHostOf(project, paneHost(pane)) === undefined
  return useMemo(
    () => (machine === undefined ? null : { machine, here }),
    [machine, here]
  )
}

/** This machine's name and icon where the Window names it (`thisNamed`),
 * as `thisToo` says, drawn again only as that changes. */
export function useThisNamed(thisToo: boolean): Named | undefined {
  const others = useAnyHost()
  return thisNamed(useHereNamed(), thisToo, others)
}

/** The session an act on a Project, or on `pane` of it, goes to
 * (`KeptHosts.sessionOf`): its host's, never this machine's in its
 * place, refused at once while the Window does not reach that host; the
 * same function while the Window's hosts stay. */
export function useEngineOf(): (
  project: ProjectId,
  pane?: Pick<PaneState, "args">
) => Engine {
  const kept = useContext(HostsContext)
  return useCallback(
    (project: ProjectId, pane?: Pick<PaneState, "args">) =>
      kept.sessionOf(project, pane),
    [kept]
  )
}

/** How the Window shows host `name` now, as an act asks it; the same
 * function while the Window's hosts stay. */
export function useShownNow(): (name: string) => Shown | undefined {
  const kept = useContext(HostsContext)
  return useCallback((name: string) => kept.shown(name), [kept])
}

/** A Pane of a Project as a pick or a Pane opens it, with no host in its
 * args (`KeptHosts.paneOn`); the same function while the Window's hosts
 * stay. */
export function usePaneOn(): KeptHosts["paneOn"] {
  const kept = useContext(HostsContext)
  return useCallback(
    (project, pane, opener) => kept.paneOn(project, pane, opener),
    [kept]
  )
}

/** This machine's Projects as a read of them stands: ready with them, or
 * not yet, or refused. */
type OursRead =
  | { state: "ready"; value: readonly ProjectSummary[] }
  | { state: "loading" | "refused" }

/** Tells `hosts` this machine's Projects, as `listed` reads them, which
 * win an ID a host has too, and its Host scope's ID, `machine`, where
 * the Window has it (`KeptHosts.ours`): as the Window draws them, before
 * any effect of what it draws runs, as a module's start, so none acts on
 * this machine's Project while the hosts take it for one no machine has
 * (ADR 0106, decision 1). */
export function useOurs(
  hosts: KeptHosts,
  listed: OursRead,
  machine?: ProjectId
): void {
  useLayoutEffect(() => {
    if (listed.state === "ready") hosts.ours(listed.value, machine)
  }, [hosts, listed, machine])
}

const allMachines = (machines: readonly Machine[]) => machines

/** The machines a new Thread starts on, as `hosts` tells them
 * (`KeptHosts.machines`), drawn again as they change. */
export const useMachinesOf = (hosts: KeptHosts): readonly Machine[] =>
  useStore(hosts.machines, allMachines)

const still = () => () => undefined

/** `select` of the Window's one clock (`KeptHosts.clock`), drawn again
 * only as what it selects changes: words, not the time itself, which
 * changes as it is read. While not `ticking`, it reads the clock as it is
 * drawn. A `select` made once, not at each drawing, spares React a read. */
export function useNowOf<S>(select: (now: number) => S, ticking = true): S {
  const { clock } = useContext(HostsContext)
  const read = useCallback(() => select(clock.get()), [clock, select])
  return useSelected(ticking ? clock.subscribe : still, read)
}

/** How long host `shown` has been away, by the Window's one clock, as its
 * pill and its card say it after "away" (`awayFor`), so both say the
 * same: since the Window last heard it. None while it is not away, as
 * stopped says no time, nor where the Window never heard it, as after a
 * restart while it is away: it does not know since when (ADR 0105, the
 * mock's frame 6). */
export function useAwayFor(shown: Shown): string | undefined {
  const since = shown.state.state === "away" ? shown.asOf : undefined
  return useNowOf(
    useCallback((now: number) => awayFor(since, now), [since]),
    since !== undefined
  )
}
