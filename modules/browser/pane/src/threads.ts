/**
 * The Threads that drive tabs with Banda's tools, as the window lists
 * them (ADR 0029, decision 4): the title a driven page's pill shows, the
 * way to its Thread, and the end of its turn, which ends its drive.
 */
import type { Engine, ProjectId } from "@banda/contract"
import type { WindowApi } from "@banda/ui/module"
import {
  type Listed,
  listedOf,
  type Watch,
  type WatchProps,
} from "@banda/ui/pane"
import { useEffect, useSyncExternalStore } from "react"
import type { SiteAnswer, Wait } from "./desktop"
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

/** The Thread of `agent` as the window lists it, and its Project. */
export function threadOf(
  agent: string
): { project: ProjectId; listed: Listed } | null {
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

/**
 * The Person is done with what the Thread of `agent` handed them on the
 * page of `contents`, `why` (ADR 0029, decision 6): the tab is the
 * Thread's again.
 */
export const handBack = (
  engine: Engine,
  contents: number,
  agent: string,
  why: string
) =>
  tell(
    engine,
    agent,
    browserHost()?.answered(contents, agent),
    `Done: ${why}. Carry on.`
  )

/** What the Thread hears of each answer to whether it may use a site. */
const SAID: Record<SiteAnswer, string> = {
  once: "allowed once. Carry on.",
  always: "always allowed. Carry on.",
  deny: "denied. Carry on without it.",
}

/** The Person's answer to whether the Thread of `agent` may use `site`,
 * which it waits for on the page of `contents` (decision 7, B). */
export const allowSite = (
  engine: Engine,
  contents: number,
  agent: string,
  site: string,
  answer: SiteAnswer
) =>
  tell(
    engine,
    agent,
    browserHost()?.allowed(contents, agent, answer),
    `${site}: ${SAID[answer]}`
  )

/**
 * Says `text` in the Thread of `agent`, as the Person's message, once
 * main took the answer the Thread waited for: it starts its next turn. A
 * second press finds no wait, and says nothing. A send that fails is left
 * unhandled, which keeps it as a Problem (ADR 0039).
 */
async function tell(
  engine: Engine,
  agent: string,
  answered: Promise<boolean> | undefined,
  text: string
): Promise<void> {
  if (!(await answered)) return
  const thread = threadOf(agent)
  if (!thread) return
  await engine.command(
    "agents.send",
    {
      thread: thread.listed.id,
      text,
      images: [],
      settings: null,
      steer: false,
    },
    thread.project
  )
}

/** The title of the Thread of `agent`, as listed, drawn again as the
 * lists change. */
export function useTitleOf(agent: string): string {
  return useSyncExternalStore(
    watchLists,
    () => threadOf(agent)?.listed.title ?? "An Agent"
  )
}

/** What the sidebar's row of a Thread that waits for the Person on a tab
 * says: one they stopped, once it called there again; one that handed the
 * tab over, at once. */
function callOf(wait: Wait): string {
  switch (wait.reason) {
    case "stopped":
      return "Stopped on a tab: let it drive again there"
    case "handoff":
      return `Your turn in a tab: ${wait.why}`
    case "site":
      return `Asks to use ${wait.site}`
  }
}

/**
 * The Threads of a Project that wait for the Person on a tab, as their rows
 * show it (ADR 0029, decision 6): a Thread the Person stopped asks them
 * once it calls there again, and the window calls them as for a
 * Harness's Question. Stopping it calls nobody: the Person did.
 */
export const waitsWatch: Watch = { Watch: WaitsWatch }

function WaitsWatch({ project, report }: WatchProps) {
  useEffect(() => {
    let was: string | undefined
    const check = () => {
      const listed = asking().flatMap(({ contents, wait, asked }): Listed[] => {
        const { agent } = wait
        const thread = threadOf(agent)
        if (thread?.project !== project) return []
        return [
          {
            id: `browser:${contents}:${agent}`,
            title: thread.listed.title,
            mark: "asking",
            changed: asked,
            calls: callOf(wait),
            on: agent,
            pane: thread.listed.pane,
          },
        ]
      })
      const said = JSON.stringify(listed)
      if (said === was) return
      was = said
      const mark = listed.length ? "asking" : "rest"
      report({ mark, waiting: listed.length, listed })
    }
    check()
    // A Thread's title and Project are the lists'; the rest, the waits'.
    const stops = [watchLists(check), watchWaits(check)]
    return () => {
      for (const stop of stops) stop()
    }
  }, [project, report])
  return null
}
