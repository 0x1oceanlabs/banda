/**
 * Looking into a Problem (ADR 0039, decision 3): a new Thread with the
 * Person's default Harness, asked to read the Problem and follow the
 * Banda skill's `problems` topic. Nothing starts by itself: it costs the
 * Person's model. When the engine runs from a checkout of Banda's source
 * and a Project is that checkout, the Thread opens there, where the topic
 * has the Agent fix it; else where a New Thread starts (`Here.starts`).
 * Another machine's Problem is read by an Agent on that machine, the only
 * one whose `problem` tool has it: with no checkout there, its Thread
 * starts in that machine's No Project.
 */
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { openProjects } from "@banda/ui/lib/projects"

/** What `thread.new` is given to look into a Problem: its Project, none
 * for where a New Thread starts, and what it asks. */
export type LookInto = { project?: ProjectId; ask: string }

/** How a Thread looks into Problem `fingerprint`, which the engine says
 * runs from `checkout`, if it does: in the Project that is that checkout,
 * else in `otherwise`, another machine's No Project, else where a New
 * Thread starts. */
export function lookInto(
  fingerprint: string,
  checkout: string | null,
  projects: readonly ProjectSummary[],
  otherwise?: ProjectId
): LookInto {
  const ask = `Look into Banda's Problem ${fingerprint}: read it with the \`problem\` tool, and follow the Banda skill's \`problems\` topic.`
  const project =
    openProjects(projects).find((one) => one.folder === checkout)?.id ??
    otherwise
  return project ? { project, ask } : { ask }
}

/** Reads what it takes to look into Problem `fingerprint`, as it is
 * clicked: nothing is read before. `engine` is the Problem's machine's,
 * and `otherwise` that machine's No Project where it is another machine. */
export async function lookingInto(
  engine: Engine,
  fingerprint: string,
  otherwise?: ProjectId
): Promise<LookInto> {
  const [report, projects] = await Promise.all([
    engine.call("problems.problem", { fingerprint }),
    engine.call("projects.list", {}),
  ])
  return lookInto(fingerprint, report.checkout, projects, otherwise)
}
