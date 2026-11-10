/**
 * The hosts from React (ADR 0081, decision 4): the Window gives what it
 * draws its `KeptHosts`, and each part reads what it needs of them by
 * selector, drawn again only as that changes.
 */
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { createContext, useCallback, useContext, useEffect } from "react"
import {
  FORGETTING,
  type HostsDevice,
  KeptHosts,
  type Machine,
  namedIn,
  type Shown,
} from "../hosts"
import type { PaneState } from "../pane"
import { sameData } from "../store"
import { useStore } from "./store"

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

/** Where a Pane reaches its engine: this machine's; or another host's,
 * by its name, with what the Window knows of that host yet, and its
 * engine once it knows it. */
export type Reach =
  | { host?: undefined; shown?: undefined; engine: Engine }
  | { host: string; shown: Shown | undefined; engine: Engine | undefined }

/**
 * Where a Pane of `project`, whose args name host `named`, reaches its
 * engine (ADR 0081, decision 4): the session it is drawn from
 * (`KeptHosts.sessionOf`), this machine's for its own Projects, else its
 * host's, kept while that host is out of reach; none while the Window
 * does not know that host yet. Drawn again only as the host it is on, or
 * what the Window knows of that host, changes.
 */
export function useReach(project: ProjectId, named: string | undefined): Reach {
  const kept = useContext(HostsContext)
  const on = useCallback(
    () => kept.hostOf(project, named),
    [kept, project, named]
  )
  const host = useStore(kept, on)
  const shown = useShownOf(host)
  if (host === undefined) return { engine: kept.sessionOf(project) }
  const pane = { args: { host } }
  return {
    host,
    shown,
    engine: shown && kept.sessionOf(project, pane, { drawn: true }),
  }
}

/** The other host a Pane of `project` is on, whose args name host
 * `named`, by its name and icon, or the one this device last saw
 * (`KeptHosts.seen`); none for this machine's, or with no Pane yet. Drawn
 * again only as they change. */
export function useNamedOf(
  project: ProjectId | undefined,
  named: string | undefined
): Named | undefined {
  const kept = useContext(HostsContext)
  const select = useCallback(
    (hosts: readonly Shown[]) => {
      const host =
        project === undefined ? undefined : kept.hostOf(project, named)
      return host === undefined ? undefined : namedIn(hosts, host, kept.seen)
    },
    [kept, project, named]
  )
  return useStore(kept, select, sameData)
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

/** This machine's Projects as a read of them stands: ready with them, or
 * not yet, or refused. */
type OursRead =
  | { state: "ready"; value: readonly ProjectSummary[] }
  | { state: "loading" | "refused" }

/** Tells `hosts` this machine's Projects, as `listed` reads them, which
 * win an ID a host has too, and its Host scope's ID, `machine`, where
 * the Window has it (`KeptHosts.ours`). */
export function useOurs(
  hosts: KeptHosts,
  listed: OursRead,
  machine?: ProjectId
): void {
  useEffect(() => {
    if (listed.state === "ready") hosts.ours(listed.value, machine)
  }, [hosts, listed, machine])
}

const allMachines = (machines: readonly Machine[]) => machines

/** The machines a new Thread starts on, as `hosts` tells them
 * (`KeptHosts.machines`), drawn again as they change. */
export const useMachinesOf = (hosts: KeptHosts): readonly Machine[] =>
  useStore(hosts.machines, allMachines)
