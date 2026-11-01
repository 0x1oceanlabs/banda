/**
 * What Enter does with a message written while the Agent works: Steering,
 * so the Agent reads it as it works (T3 Code's default), or the Queue, so
 * it waits until the turn ends. Ctrl (⌘ on a Mac) does the other. It is
 * this window's choice, kept in its storage.
 */
import { useSyncExternalStore } from "react"

export type EnterKey = "steer" | "queue"

const KEY = "banda.agents.enter-key"
const heard = new Set<() => void>()
/** The choice, for a window whose storage fails: kept until it closes. */
let here: EnterKey = "steer"

function read(): EnterKey {
  try {
    const kept = localStorage.getItem(KEY)
    return kept === "steer" || kept === "queue" ? kept : here
  } catch {
    return here
  }
}

function keep(enter: EnterKey) {
  here = enter
  try {
    localStorage.setItem(KEY, enter)
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

export function useEnterKey(): [EnterKey, (enter: EnterKey) => void] {
  const enter = useSyncExternalStore(listen, read, (): EnterKey => "steer")
  return [enter, keep]
}

/** Whether a message sent with Enter, or with Ctrl+Enter when `other`,
 * goes into the turn that runs. */
export function steers(enter: EnterKey, other: boolean): boolean {
  return (enter === "steer") !== other
}

/** The key that sends a message `how`. */
export function keyFor(enter: EnterKey, how: EnterKey): string {
  return enter === how ? "Enter" : "Ctrl+Enter"
}
