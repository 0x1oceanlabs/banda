/**
 * What each Thread means to its Person, as Banda's mark shows it (ADR 0005,
 * decision 8): it asks them, it failed, it finished while they were away,
 * it works, or it rests. The engine says only what happened; these rules
 * say what that means here. Pure, so plain tests cover them.
 */
import type { ListedThread, TurnId, TurnView } from "@banda/contract/agents"
import type { MarkState } from "@banda/ui/components/banda-mark"

/**
 * A Thread's mark: the loudest thing about it the Person has not seen. A
 * turn that finished or failed settles once its host keeps it seen, the
 * latest that ended the Person saw (ADR 0096); a Question asks until it
 * is answered, seen or not.
 */
export function markOf(thread: ListedThread): MarkState {
  if (thread.asking.length > 0) return "asking"
  const { latest } = thread
  if (!latest) return "rest"
  if (latest.state === "running") return "working"
  if (thread.seen === latest.turn) return "rest"
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
