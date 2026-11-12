/**
 * The look's problems: a widget that says when a file of the look is wrong
 * (ADR 0005, decision 11). The last good look stays, and this names the
 * file and the line; `banda look check` says the same in a terminal.
 *
 *   in    the look's problems (`useLookProblems`), and each id `[bar]`
 *         names that no module has a widget for (`useBarProblems`)
 *   draws nothing while there are none; else a warning and the first
 *         file's name, every problem in its hint and its name
 *   runs  nothing
 *
 * It always stands on the bar, last on the right where `[bar]` does not
 * place it (`layout/placed.ts`).
 */
import type { Problem } from "@banda/contract/look"
import type { Widget } from "@banda/ui/module"
import { TriangleAlertIcon } from "lucide-react"
import { useLookProblems } from "../../look"
import { useBarProblems } from "../layout/Widgets"
import { PROBLEMS } from "../widget-ids"

/** Where a file of the look is wrong, as compilers say it. */
export function problemWords(problem: Problem): string {
  const at =
    problem.line != null ? `:${problem.line}:${problem.column ?? 1}` : ""
  return `${problem.path}${at}: ${problem.message}`
}

function LookProblems() {
  const problems = [...useLookProblems(), ...useBarProblems()]
  if (problems.length === 0) return null
  const words = problems.map(problemWords).join("\n")
  return (
    <div
      role="status"
      aria-label={`The look: ${words}`}
      title={`The look keeps its last good state:\n${words}`}
      className="flex items-center gap-1 px-2 text-meta text-destructive"
    >
      <TriangleAlertIcon className="size-3.5" />
      {problems[0].path.split("/").at(-1)}
    </div>
  )
}

export const problemsWidget: Widget = {
  id: PROBLEMS,
  about:
    "Says when a file of the look is wrong, and where; the last good look stays.",
  Widget: LookProblems,
}
