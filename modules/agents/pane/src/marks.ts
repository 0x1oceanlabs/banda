/**
 * What each Thread means to its Person, as Banda's mark shows it (ADR 0005,
 * decision 8): it asks them, it failed, it finished while they were away,
 * it works, or it rests. The engine says only what happened; these rules
 * say what that means here. Pure, so plain tests cover them.
 */
import type { ListedThread, TurnId, TurnView } from "@bandaso/contract/agents"
import { loudest, type MarkState } from "@bandaso/ui/components/banda-mark"
import type { Attention } from "@bandaso/ui/pane"
import type { Chime } from "@bandaso/ui/sound"

/**
 * The turn of a Thread its Person has seen since it ended, by Thread: what
 * settles a turn that finished or failed. A Question asks until it is
 * answered, seen or not.
 */
export type Seen = Readonly<Record<string, TurnId>>

/** A Thread's mark: the loudest thing about it the Person has not seen. */
export function markOf(thread: ListedThread, seen: Seen): MarkState {
  if (thread.asking.length > 0) return "asking"
  const { latest } = thread
  if (!latest) return "rest"
  if (latest.state === "running") return "running"
  if (seen[thread.id] === latest.turn) return "rest"
  switch (latest.state) {
    case "done":
      return "done"
    // The engine stopped while it ran: the turn did not finish either.
    case "failed":
    case "interrupted":
      return "failed"
    // The Person stopped it, so there is nothing to tell them.
    default:
      return "rest"
  }
}

/** Whether a mark calls the Person to act, not just to look. */
export function needsPerson(mark: MarkState): boolean {
  return mark === "asking" || mark === "failed"
}

/** What a Space's Threads call their Person for, all together. */
export function attentionOf(
  threads: readonly ListedThread[],
  seen: Seen
): Attention {
  const marks = threads.map((thread) => markOf(thread, seen))
  return { mark: loudest(marks), waiting: marks.filter(needsPerson).length }
}

/**
 * The turn a Person sees settled in a Thread they look at: its latest turn
 * that began, once that ended. As the engine has it, a turn that waits, or
 * that a Person took back, never began.
 */
export function settledTurn(turns: readonly TurnView[]): TurnId | undefined {
  const begun = turns.filter(
    (turn) => turn.state !== "queued" && turn.state !== "withdrawn"
  )
  const latest = begun.at(-1)
  return latest && latest.state !== "running" ? latest.id : undefined
}

/** Each Thread's mark, by its ID, as a Watch last saw them. */
export type Marks = ReadonlyMap<string, MarkState>

/** The marks that call for the Person when a Thread comes to one. */
const CHIMES: Partial<Record<MarkState, Chime>> = {
  done: "done",
  asking: "asking",
  failed: "failed",
}

/**
 * The Threads' marks now, and the Threads that came to one that calls for
 * the Person since `before`. With nothing before, nothing calls: what
 * already was when a Watch began is no news (ADR 0009, decision 3). A
 * Thread that is new since then came from rest.
 */
export function callsOf(
  before: Marks | undefined,
  threads: readonly ListedThread[],
  seen: Seen
): { marks: Marks; calls: { thread: ListedThread; chime: Chime }[] } {
  const marks = new Map(threads.map((t) => [t.id, markOf(t, seen)]))
  if (!before) return { marks, calls: [] }
  const calls = threads.flatMap((thread) => {
    const mark = marks.get(thread.id)!
    const chime = CHIMES[mark]
    const was = before.get(thread.id) ?? "rest"
    return chime && mark !== was ? [{ thread, chime }] : []
  })
  return { marks, calls }
}
