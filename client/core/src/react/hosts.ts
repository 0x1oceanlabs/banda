/**
 * The hosts from React (ADR 0081, decision 4): the Window gives what it
 * draws its `KeptHosts`, and each part reads what it needs of them by
 * selector, drawn again only as that changes.
 */
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { createContext, useCallback, useContext, useEffect } from "react"
import {
  type HostsDevice,
  KeptHosts,
  type Machine,
  type Names,
  namedIn,
  type Shown,
  unseen,
} from "../hosts"
import { paneHost, type PaneState } from "../pane"
import { sameData } from "../store"
import { useStore } from "./store"

/** No hosts, as where no Window follows the desktop's. */
const NOWHERE: HostsDevice = {
  follow: () => undefined,
  engine: () => Promise.reject(new Error("No other machine here.")),
  start: () => undefined,
}

/** No memory of names, as where no Window keeps one: each host by its
 * key. */
const FORGETTING: Names = { seen: unseen, follow: () => () => undefined }

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
