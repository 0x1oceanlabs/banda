/**
 * What each Thread means to its Person, as Banda's mark shows it (ADR 0005,
 * decision 8): it asks them, it failed, it finished while they were away,
 * it works, or it rests. The engine says only what happened; these rules
 * say what that means here. Pure, so plain tests cover them.
 */
import type { ListedThread, TurnId, TurnView } from "@banda/contract/agents"
import { loudest, type MarkState } from "@banda/ui/components/banda-mark"
import type { Attention } from "@banda/ui/pane"

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

/** What a Project's Threads call their Person for, all together. */
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
