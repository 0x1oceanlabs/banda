/**
 * The Diff's stage, unstage and revert, as its buttons send them (ADR
 * 0034, decision 2). Each acts (ADR 0106, law 4): while the Project's
 * machine is away it is refused at once, never kept to run once that
 * machine is back.
 */
import type { Engine, ProjectId } from "@banda/contract"
import type { ChangeAsk } from "@banda/contract/git"
import type { Act } from "./stage"

/** Does `what` to the changes `ask` names, in `project`'s repository. */
export async function change(
  engine: Engine,
  project: ProjectId,
  what: Act,
  ask: ChangeAsk
): Promise<void> {
  await engine.call(`git.${what}`, ask, { project })
}
