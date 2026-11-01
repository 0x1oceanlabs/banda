/**
 * What a Person wrote to a Thread and has not sent yet, kept in this
 * window's storage, so it waits for them when they come back, as in T3
 * Code (ADR 0010, decision 7). Every Pane on the same Thread holds the
 * same draft.
 */
import { useState, useSyncExternalStore } from "react"

const PREFIX = "banda.agents.draft."
const heard = new Set<() => void>()
/** The drafts read so far, and all of them for a window whose storage
 * fails: kept until it closes. */
const here = new Map<string, string>()

function read(thread: string): string {
  if (!here.has(thread))
    try {
      here.set(thread, localStorage.getItem(PREFIX + thread) ?? "")
    } catch {
      here.set(thread, "")
    }
  return here.get(thread) ?? ""
}

function keep(thread: string, text: string) {
  here.set(thread, text)
  try {
    if (text) localStorage.setItem(PREFIX + thread, text)
    else localStorage.removeItem(PREFIX + thread)
  } catch {
    // `here` holds it.
  }
  heard.forEach((hear) => hear())
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  // Another window on the same storage changed a draft.
  const elsewhere = (event: StorageEvent) => {
    if (!event.key?.startsWith(PREFIX)) return
    here.delete(event.key.slice(PREFIX.length))
    hear()
  }
  window.addEventListener("storage", elsewhere)
  return () => {
    heard.delete(hear)
    window.removeEventListener("storage", elsewhere)
  }
}

/** The composer's text for `thread`, kept as its draft; a Thread not yet
 * started keeps it only while its Pane is open. */
export function useDraft(
  thread: string | null
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [unstarted, setUnstarted] = useState("")
  const kept = useSyncExternalStore(
    listen,
    () => (thread === null ? "" : read(thread)),
    () => ""
  )
  if (thread === null) return [unstarted, setUnstarted]
  return [
    kept,
    (next) =>
      keep(thread, typeof next === "function" ? next(read(thread)) : next),
  ]
}
