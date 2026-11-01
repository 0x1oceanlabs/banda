/**
 * Which finished turn of each Thread its Person has seen: one of the
 * Person's own marks the sidebar keeps (ADR 0005, decision 8). It is this
 * window's, kept in its storage, and every Pane of the module hears a
 * change at once.
 */
import type { ThreadId, TurnId } from "@bandaso/contract/agents"
import { kept } from "@bandaso/ui/lib/kept"
import type { Seen } from "./marks"

const seen = kept(
  "bandaso.agents.seen",
  (turn): turn is TurnId => typeof turn === "string"
)

/** Keeps that the Person has seen `turn` of `thread`. */
export function markSeen(thread: ThreadId, turn: TurnId) {
  if (seen.read()[thread] !== turn) seen.put(thread, turn)
}

/** The turns this window's Person has seen, kept current. */
export function useSeen(): Seen {
  return seen.use()
}
