/**
 * The Threads that drive tabs with Banda's tools, as the window lists
 * them (ADR 0029, decision 4): the title a driven page's pill shows, the
 * way to its Thread, and the end of its turn, which ends its drive.
 */
import type { SpaceId } from "@banda/contract"
import type { WindowApi } from "@banda/ui/module"
import {
  type Listed,
  listedOf,
  type Watch,
  type WatchProps,
} from "@banda/ui/pane"
import { useEffect, useSyncExternalStore } from "react"
import { browserHost } from "./host"
import { asking, drivers, watchPages, watchWaits } from "./pages"

/** The window, while the module runs. */
let shell: WindowApi | null = null
/** What hears the lists change, from before the module runs. */
const listening = new Set<() => void>()
const watchLists = (listener: () => void) => {
  listening.add(listener)
  return () => void listening.delete(listener)
}

/** The Thread of `agent` as the window lists it, and its Space. */
export function threadOf(
  agent: string
): { space: SpaceId; listed: Listed } | null {
  return shell && listedOf(shell.lists(), agent)
}

/** The Thread of `agent` as listed, drawn again as the lists change. */
export function useThreadOf(agent: string): Listed | null {
  return useSyncExternalStore(watchLists, () => threadOf(agent)?.listed ?? null)
}

/**
 * Follows the Threads that drive tabs until the return is called: one
 * whose turn ended, or that began another, drives none now, and main lets
 * its tabs go. A Thread that drives with no turn running, as a test's
 * Agent does, drives until the Person stops it.
 */
export function followThreads(window: WindowApi): () => void {
  shell = window
  /** When the turn began that each driving Thread runs. */
  const turns = new Map<string, number>()
  const check = () => {
    const driving = drivers()
    for (const agent of driving) {
      const began = threadOf(agent)?.listed.began
      const was = turns.get(agent)
      if (was === undefined) {
        if (began !== undefined) turns.set(agent, began)
      } else if (began !== was) {
        turns.delete(agent)
        browserHost()?.settled(agent)
      }
    }
    for (const agent of turns.keys())
      if (!driving.has(agent)) turns.delete(agent)
  }
  const heard = () => {
    for (const listener of listening) listener()
  }
  const stops = [window.watchLists(heard), watchLists(check), watchPages(check)]
  heard()
  return () => {
    for (const stop of stops) stop()
    if (shell === window) shell = null
  }
}

/** What the sidebar's row of a Thread the Person stopped on a tab says,
 * once it called there again. */
export const STOPPED = "Stopped on a tab: let it drive again there"

/**
 * The Threads of a Space that wait for the Person on a tab, as their rows
 * show it (ADR 0029, decision 6): a Thread the Person stopped asks them
 * once it calls there again, and the window calls them as for a
 * Harness's Question. Stopping it calls nobody: the Person did.
 */
export const waitsWatch: Watch = { Watch: WaitsWatch }

function WaitsWatch({ space, report }: WatchProps) {
  useEffect(() => {
    let was: string | undefined
    const check = () => {
      const listed = asking().flatMap(
        ({ contents, agent, asked }): Listed[] => {
          const thread = threadOf(agent)
          if (thread?.space !== space) return []
          return [
            {
              id: `browser:${contents}:${agent}`,
              title: thread.listed.title,
              mark: "asking",
              changed: asked,
              calls: STOPPED,
              on: agent,
              pane: thread.listed.pane,
            },
          ]
        }
      )
      const said = JSON.stringify(listed)
      if (said === was) return
      was = said
      const mark = listed.length ? "asking" : "rest"
      report({ mark, waiting: listed.length, listed })
    }
    check()
    // A Thread's title and Space are the lists'; the rest, the waits'.
    const stops = [watchLists(check), watchWaits(check)]
    return () => {
      for (const stop of stops) stop()
    }
  }, [space, report])
  return null
}
