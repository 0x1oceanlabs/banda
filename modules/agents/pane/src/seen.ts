/**
 * Which finished turn of each Thread its Person has seen: one of the
 * Person's own marks the sidebar keeps (ADR 0005, decision 8). It is this
 * window's, kept in its storage, and every Pane of the module hears a
 * change at once.
 */
import { useSyncExternalStore } from "react"
import type { ThreadId, TurnId } from "@bandaso/contract/agents"
import type { Seen } from "./marks"

const KEY = "bandaso.agents.seen"
/** The Threads it remembers, the latest seen last: an old one falls off. */
const KEEP = 500
const NONE: Seen = {}

const heard = new Set<() => void>()
/** What was seen, for a window whose storage fails: kept until it closes. */
let here: Seen = NONE
/** The text `here` was read from, so a read that finds no change keeps it. */
let text: string | null = null

function read(): Seen {
  try {
    const kept = localStorage.getItem(KEY)
    if (kept === text) return here
    text = kept
    here = parse(kept)
  } catch {
    // `here` holds it.
  }
  return here
}

function parse(kept: string | null): Seen {
  try {
    const value: unknown = JSON.parse(kept ?? "null")
    if (typeof value !== "object" || value === null) return NONE
    const pairs = Object.entries(value).filter(
      (pair): pair is [string, TurnId] => typeof pair[1] === "string"
    )
    return Object.fromEntries(pairs)
  } catch {
    return NONE
  }
}

/** Keeps that the Person has seen `turn` of `thread`. */
export function markSeen(thread: ThreadId, turn: TurnId) {
  const before = read()
  if (before[thread] === turn) return
  const others = Object.entries(before).filter(([id]) => id !== thread)
  const pairs = others.slice(-(KEEP - 1))
  here = Object.fromEntries([...pairs, [thread, turn]])
  try {
    text = JSON.stringify(here)
    localStorage.setItem(KEY, text)
  } catch {
    // `here` holds it.
  }
  heard.forEach((hear) => hear())
}

function listen(hear: () => void): () => void {
  heard.add(hear)
  // Another window on the same storage saw a Thread.
  const elsewhere = (event: StorageEvent) => event.key === KEY && hear()
  window.addEventListener("storage", elsewhere)
  return () => {
    heard.delete(hear)
    window.removeEventListener("storage", elsewhere)
  }
}

/** The turns this window's Person has seen, kept current. */
export function useSeen(): Seen {
  return useSyncExternalStore(listen, read, () => NONE)
}
