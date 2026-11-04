import type { Problem } from "@banda/contract/problems"
import { toast } from "@banda/ui/components/sonner"
import { LIFE, markOf } from "../calls/callToast"
import { PLACES } from "./live"

/** What the Problems' toast's buttons do. */
export type ProblemAnswers = {
  /** Asks an Agent to look into it, in a new Thread. */
  lookInto: (problem: Problem) => void
  /** Opens it in Settings → Problems. */
  details: (problem: Problem) => void
}

/** The id of the Problems' toast: one for them all, as each opens the
 * same section. */
const ID = "problems"

/**
 * The new Problems, in one toast (ADR 0039, ADR 0048): the newest, in its
 * words, how many more, Look into it, which asks an Agent in a new
 * Thread, and Details, which opens it in Settings → Problems.
 */
export function toastProblems(
  news: readonly Problem[],
  answers: ProblemAnswers
): void {
  const problem = news[0]!
  const more = news.length - 1
  toast.error("Something broke in Banda", {
    id: ID,
    duration: LIFE.failed,
    closeButton: true,
    icon: markOf("failed"),
    description: (
      <>
        <span className="block truncate font-mono">
          {problem.kind}: {problem.message}
        </span>
        In {PLACES[problem.source]}.
        {more > 0 && ` ${more} more ${more === 1 ? "is" : "are"} new.`} Kept in
        Settings → Problems.
      </>
    ),
    action: { label: "Look into it", onClick: () => answers.lookInto(problem) },
    cancel: { label: "Details", onClick: () => answers.details(problem) },
  })
}
