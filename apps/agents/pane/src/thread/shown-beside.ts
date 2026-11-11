/**
 * Which sub-agent each Thread's Pane beside shows, in this window (ADR
 * 0103, decision 21): the Thread lights that one's row while it does. The
 * Pane says so for as long as it is drawn, and takes it back as it goes or
 * shows another.
 */
import { useSyncExternalStore } from "react"
import type { SubagentId } from "@banda/contract/agents"

const shown = new Map<string, SubagentId>()
const heard = new Set<() => void>()

const keyOf = (project: string, thread: string) => `${project}\n${thread}`

function tell() {
  for (const hear of heard) hear()
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  return () => void heard.delete(hear)
}

/** Says the Pane beside Thread `thread` of `project` shows `sub`'s row's
 * sub-agent; returns what takes it back, unless another took its place. */
export function showBeside(
  project: string,
  thread: string,
  sub: SubagentId
): () => void {
  const key = keyOf(project, thread)
  shown.set(key, sub)
  tell()
  return () => {
    if (shown.get(key) !== sub) return
    shown.delete(key)
    tell()
  }
}

/** The row Thread `thread` of `project` lights now, if any. */
export function shownBeside(
  project: string,
  thread: string
): SubagentId | undefined {
  return shown.get(keyOf(project, thread))
}

/** {@link shownBeside}, kept current as the Pane beside changes. */
export function useShownBeside(
  project: string,
  thread: string
): SubagentId | undefined {
  return useSyncExternalStore(listen, () => shownBeside(project, thread))
}
