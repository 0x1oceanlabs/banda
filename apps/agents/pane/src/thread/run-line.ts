/**
 * A reply's Run (ADR 0063, decision 6): a shell line of a code block, run
 * in a new terminal beside the Thread, on the machine the Thread's Project
 * is on, as the router places it (ADR 0106, law 3).
 *
 * It goes now or not at all (ADR 0106, decision 4): while that machine is
 * out of reach it is refused at once and no Pane opens, so a line never
 * runs later by itself once the machine is back.
 */
import type { ProjectId } from "@banda/contract"
import { Unreachable } from "@banda/core/react"
import { toast } from "@banda/ui/components/sonner"
import { problem } from "@banda/ui/lib/words"
import type { PaneProps } from "@banda/ui/pane"
import type { ThreadArgs } from "./session"

/**
 * What Run does for a Thread of `project`, on machine `host` where that is
 * another's; `away`, why that machine does not take an act now. None where
 * no window runs it, so a code block offers no Run.
 */
export function runLineOf(
  run: PaneProps<ThreadArgs>["run"],
  project: ProjectId,
  host: string | undefined,
  away: string | undefined
): ((line: string) => void) | null {
  if (!run) return null
  return (line) => {
    if (host !== undefined && away !== undefined) {
      toast.error(problem(new Unreachable(host, away), "Run"))
      return
    }
    run("terminal.run", { line, project })
  }
}
