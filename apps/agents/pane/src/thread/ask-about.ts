/**
 * "Ask Claude about it" (ADR 0103, decision 25): a sub-agent's Pane asks
 * its Thread's to start a message about it, in this window. The Thread's
 * Pane takes the ask as it draws its composer, which puts the sub-agent's
 * chip first; one not taken yet gives way to the next. The Crew Pane's
 * Ask Claude to go on asks the same way, with a ready message (decision
 * 26).
 */
import { useSyncExternalStore } from "react"

/** What a Thread's composer is asked to start: a message about the
 * sub-agent `about`, its chip first, or the ready message `draft`. */
export type Ask = { about: string } | { draft: string }

const asked = new Map<string, Ask>()
const heard = new Set<() => void>()

const keyOf = (project: string, thread: string) => `${project}\n${thread}`

function tell() {
  for (const hear of heard) hear()
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  return () => void heard.delete(hear)
}

/** Asks Thread `thread` of `project` to start a message about the
 * sub-agent `label`. */
export function askAbout(project: string, thread: string, label: string) {
  asked.set(keyOf(project, thread), { about: label })
  tell()
}

/** Asks Thread `thread` of `project` to put the ready message `text` in
 * its composer, after what is written there. */
export function draftIn(project: string, thread: string, text: string) {
  asked.set(keyOf(project, thread), { draft: text })
  tell()
}

/** What Thread `thread` of `project` is asked to start, if anything, kept
 * current. */
export function useAskedAbout(
  project: string,
  thread: string | null
): Ask | undefined {
  return useSyncExternalStore(listen, () =>
    thread === null ? undefined : asked.get(keyOf(project, thread))
  )
}

/** Takes the ask `ask` of Thread `thread`, once its composer has it. */
export function tookAsk(project: string, thread: string, ask: Ask) {
  const key = keyOf(project, thread)
  if (asked.get(key) !== ask) return
  asked.delete(key)
  tell()
}
