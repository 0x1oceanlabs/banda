/**
 * Here as the Window keeps it (ADR 0087, decision 4): one record of where
 * the Person is, folded from what the Tiling drew last, the Window's own
 * areas and the device. Only the Window writes it; its widgets read it by
 * selector (`useHere`) and its acts as they run (`WindowApi.here`). Pure
 * but for its hook and its provider, so plain tests cover it. The store
 * that keeps it, `KeptHere`, is the core's (ADR 0089); what it folds, the
 * Tiling and the Window's areas, stays here.
 */
import type { ProjectId } from "@banda/contract"
import {
  type Here,
  HereContext,
  type HereStore,
  HostsContext,
  KeptHere,
  type KeptHosts,
  type Run,
  RunContext,
} from "@banda/core/react"
import { inFront } from "@banda/ui/hooks/use-in-front"
import { ItemsContext } from "@banda/ui/hooks/use-item"
import { paneHost } from "@banda/ui/pane"
import { type ReactNode, useContext, useEffect, useState } from "react"
import type { Shows } from "../calls/sight"
import { type Stores, StoresContext } from "../calls/stores"
import { current, focused, projectIn, type Workspaces } from "../tiling/model"
import { useSteady } from "./steady"

/** What the Window and the device say besides the Tiling. */
export type Around = {
  /** The Sidebar shows. */
  sidebar: boolean
  /** The Window is in front. */
  front: boolean
  /** The Project where a Pane of no Project starts. */
  home: ProjectId
}

/** Here, from the workspaces as the Tiling drew them and what is
 * `around` them, with the host the Pane in focus is on as `hostOf` says
 * (`KeptHosts.hostOf`), as its frame gives it its engine. While the
 * Tiling reads the arrangement, no workspace is on screen. */
export function hereOf(
  state: Workspaces,
  { sidebar, front, home }: Around,
  shows: Shows,
  hostOf: KeptHosts["hostOf"] = (_, named) => named
): Here {
  const workspace = current(state)
  const entry = focused(state)
  const subject = entry && shows(entry.pane)
  const host = entry && hostOf(entry.project, paneHost(entry.pane))
  return {
    front,
    sidebar,
    workspace: workspace.id
      ? {
          id: workspace.id,
          ...(workspace.project && { project: workspace.project }),
        }
      : null,
    pane: entry
      ? {
          id: entry.id,
          project: entry.project,
          ...(subject && { subject }),
          ...(host && { host }),
        }
      : null,
    project: projectIn(state) ?? home,
  }
}

/**
 * The Window's Here, from the workspaces as the Tiling drew them last
 * (`drawn`), what is around them and the device: one store for the
 * Window's life, whose readers are told after each drawing of the Window
 * that changed it. Called after the Tiling's hook, so its effect runs
 * once the Tiling has kept what it drew.
 */
export function useKeptHere(
  drawn: () => Workspaces,
  around: Omit<Around, "front">,
  shows: Shows
): KeptHere {
  const hosts = useContext(HostsContext)
  const now = useSteady({ ...around, drawn, shows, hosts })
  const [here] = useState(
    () =>
      new KeptHere(() =>
        hereOf(
          now.drawn(),
          { sidebar: now.sidebar, front: inFront(), home: now.home },
          now.shows,
          (project, named) => now.hosts.hostOf(project, named)
        )
      )
  )
  useEffect(() => here.tell())
  // The hosts change with no drawing of the Window: they tell it so.
  useEffect(() => hosts.subscribe(() => here.tell()), [hosts, here])
  return here
}

/** What the Window keeps outside React, for all it draws to read by
 * selector: the items and the calls (ADR 0088, decision 7), and Here;
 * and its `run`, steady, by which what it draws runs an action by id.
 * The items go to the Apps too, as what fills a Pane's header finds the
 * Item it shows there (`useItem`): the store, not `itemsOf`, as a put-off
 * Thread waking changes no Item and so runs no header's selector. */
export function Kept({
  stores,
  here,
  run,
  children,
}: {
  stores: Stores
  here: HereStore
  run: Run
  children: ReactNode
}) {
  return (
    <StoresContext value={stores}>
      <ItemsContext value={stores.items}>
        <HereContext value={here}>
          <RunContext value={run}>{children}</RunContext>
        </HereContext>
      </ItemsContext>
    </StoresContext>
  )
}
