/**
 * What the Agents of the other machines open, shown beside their Threads
 * in this window (ADR 0120, decision 6): one follow for each machine that
 * is live, while the Tiling shows one of its Threads (`asked.ts`). It
 * draws nothing.
 */
import type { Engine, ProjectSummary } from "@banda/contract"
import {
  HostsContext,
  type KeptHosts,
  liveIn,
  sameEach,
  type Shown,
  useHostsBy,
} from "@banda/core/react"
import { memo, useCallback, useContext, useMemo } from "react"
import { groupedOf, kindOf } from "../registry"
import { type Kinds, showsThreadOf, useAsked } from "./asked"
import { useTiled } from "./kept"
import type { Workspaces } from "./model"

/** What the window's Pane kinds say of one. */
const KINDS: Kinds = {
  leads: (kind) => groupedOf({ kind, args: {} }),
  elsewhere: (kind) => kindOf(kind)?.elsewhere === true,
}

const NONE: readonly ProjectSummary[] = []

/** `engine` is this machine's, whose arrangement the Panes go into. */
export const Asked = memo(function Asked({ engine }: { engine: Engine }) {
  const hosts = useContext(HostsContext)
  const live = useHostsBy(liveIn, sameEach)
  return live.map((name) => (
    <From key={name} own={engine} hosts={hosts} name={name} />
  ))
})

function From({
  own,
  hosts,
  name,
}: {
  own: Engine
  hosts: KeptHosts
  name: string
}) {
  const select = useCallback(
    (all: readonly Shown[]) =>
      all.find((one) => one.name === name)?.projects ?? NONE,
    [name]
  )
  const projects = useHostsBy(select)
  const theirs = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const shows = useTiled(
    useCallback(
      (workspaces: Workspaces) => showsThreadOf(workspaces, theirs, KINDS),
      [theirs]
    )
  )
  useAsked(own, hosts.engine(name), theirs, shows, KINDS)
  return null
}
