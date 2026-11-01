/**
 * What Enter does with a message written while the Agent works: it goes
 * into the turn, which the Agent reads as it works (T3 Code's default),
 * or it waits in the queue until the turn ends. Ctrl (⌘ on a Mac) does
 * the other. It is this window's choice, kept in its storage.
 */
import { useSyncExternalStore } from "react"

export type FollowUp = "steer" | "queue"

const KEY = "bandaso.agents.follow-up"
const heard = new Set<() => void>()
/** The choice, for a window whose storage fails: kept until it closes. */
let here: FollowUp = "steer"

export function readFollowUp(): FollowUp {
  try {
    const kept = localStorage.getItem(KEY)
    return kept === "steer" || kept === "queue" ? kept : here
  } catch {
    return here
  }
}

function keep(followUp: FollowUp) {
  here = followUp
  try {
    localStorage.setItem(KEY, followUp)
  } catch {
    // `here` holds it.
  }
  heard.forEach((hear) => hear())
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  // Another window on the same storage changed it.
  const elsewhere = (event: StorageEvent) => event.key === KEY && hear()
  window.addEventListener("storage", elsewhere)
  return () => {
    heard.delete(hear)
    window.removeEventListener("storage", elsewhere)
  }
}

export function useFollowUp(): [FollowUp, (followUp: FollowUp) => void] {
  const followUp = useSyncExternalStore(
    listen,
    readFollowUp,
    (): FollowUp => "steer"
  )
  return [followUp, keep]
}

/** Whether a message sent with Enter, or with Ctrl+Enter when `other`,
 * goes into the turn that runs. */
export function steers(followUp: FollowUp, other: boolean): boolean {
  return (followUp === "steer") !== other
}
