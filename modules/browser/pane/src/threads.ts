/**
 * The Threads that drive tabs with Banda's tools, as the window lists
 * them (ADR 0029, decision 4): the title a driven page's pill shows, the
 * way to its Thread, and the end of its turn, which ends its drive.
 */
import type { SpaceId } from "@banda/contract"
import type { WindowApi } from "@banda/ui/module"
import { type Listed, listedOf } from "@banda/ui/pane"
import { useSyncExternalStore } from "react"
import { browserHost } from "./host"
import { drivers, watchPages } from "./pages"

/** The window, while the module runs. */
let shell: WindowApi | null = null

/** The Thread of `agent` as the window lists it, and its Space. */
export function threadOf(
  agent: string
): { space: SpaceId; listed: Listed } | null {
  return shell && listedOf(shell.lists(), agent)
}

const unwatched = () => () => {}

/** The Thread of `agent` as listed, drawn again as the lists change. */
export function useThreadOf(agent: string): Listed | null {
  return useSyncExternalStore(
    shell?.watchLists ?? unwatched,
    () => threadOf(agent)?.listed ?? null
  )
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
  const stops = [window.watchLists(check), watchPages(check)]
  return () => {
    for (const stop of stops) stop()
    if (shell === window) shell = null
  }
}
