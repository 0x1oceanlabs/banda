/**
 * "Ask Claude about it" (ADR 0103, decision 25): a sub-agent's Pane asks
 * its Thread's to start a message about it, in this window. The Thread's
 * Pane takes the ask as it draws its composer, which puts the sub-agent's
 * chip first; one not taken yet gives way to the next.
 */
import { useSyncExternalStore } from "react"

const asked = new Map<string, string>()
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
  asked.set(keyOf(project, thread), label)
  tell()
}

/** The sub-agent Thread `thread` of `project` is asked about, if any, kept
 * current. */
export function useAskedAbout(
  project: string,
  thread: string | null
): string | undefined {
  return useSyncExternalStore(listen, () =>
    thread === null ? undefined : asked.get(keyOf(project, thread))
  )
}

/** Takes the ask `label` of Thread `thread`, once its composer has it. */
export function tookAsk(project: string, thread: string, label: string) {
  const key = keyOf(project, thread)
  if (asked.get(key) !== label) return
  asked.delete(key)
  tell()
}
