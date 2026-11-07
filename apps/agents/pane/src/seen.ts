/**
 * Which finished turn of each Thread its Person has seen: one of the
 * Person's own marks the sidebar keeps (ADR 0005, decision 8). It is this
 * window's, kept in its storage, and every Pane of the module hears a
 * change at once. "Mark as unread" takes a Thread's back (ADR 0077,
 * decision 6).
 */
import type { ListedThread, ThreadId, TurnId } from "@banda/contract/agents"
import { kept } from "@banda/ui/lib/kept"
import type { Seen } from "./marks"

const seen = kept(
  "banda.agents.seen",
  (turn): turn is TurnId => typeof turn === "string"
)

/** Keeps that the Person has seen `turn` of `thread`. */
export function markSeen(thread: ThreadId, turn: TurnId) {
  if (seen.read()[thread] !== turn) seen.put(thread, turn)
}

/** The latest turn each Thread the lists hold ended, for "Mark as read". */
const ended = new Map<string, TurnId>()

/** Keeps the latest turn each of `threads` ended, as its list says. */
export function heardEnded(threads: readonly ListedThread[]) {
  for (const { id, latest } of threads)
    if (latest && latest.state !== "running") ended.set(id, latest.turn)
}

/**
 * Takes back the Person's "seen" of `thread`'s last finished turn, which
 * then calls them again; with `false`, marks it seen. A Pane that shows
 * the Thread leaves the mark as it is until the Person leaves the Thread
 * and comes back.
 */
export function markUnread(thread: string, unread: boolean) {
  if (unread) return seen.drop(thread)
  const turn = ended.get(thread)
  if (turn) markSeen(thread as ThreadId, turn)
}

/** The turns this window's Person has seen, kept current. */
export function useSeen(): Seen {
  return seen.use()
}
