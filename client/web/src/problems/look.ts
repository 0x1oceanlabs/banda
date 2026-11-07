/**
 * Looking into a Problem (ADR 0039, decision 3): a new Thread with the
 * Person's default Harness, asked to read the Problem and follow the
 * Banda skill's `problems` topic. Nothing starts by itself: it costs the
 * Person's model. When the engine runs from a checkout of Banda's source
 * and a Project is that checkout, the Thread opens there, where the topic
 * has the Agent fix it; else in the window's home Project.
 */
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { openProjects } from "@banda/ui/lib/projects"

/** What `thread.new` is given to look into a Problem: its Project, none
 * for the window's home one, and what it asks. */
export type LookInto = { project?: ProjectId; ask: string }

/** How a Thread looks into Problem `fingerprint`, which the engine says
 * runs from `checkout`, if it does. */
export function lookInto(
  fingerprint: string,
  checkout: string | null,
  projects: readonly ProjectSummary[]
): LookInto {
  const ask = `Look into Banda's Problem ${fingerprint}: read it with the \`problem\` tool, and follow the Banda skill's \`problems\` topic.`
  const project = openProjects(projects).find((one) => one.folder === checkout)
  return project ? { project: project.id, ask } : { ask }
}

/** Reads what it takes to look into Problem `fingerprint`, as it is
 * clicked: nothing is read before. */
export async function lookingInto(
  engine: Engine,
  fingerprint: string
): Promise<LookInto> {
  const [report, projects] = await Promise.all([
    engine.call("problems.problem", { fingerprint }),
    engine.call("projects.list", {}),
  ])
  return lookInto(fingerprint, report.checkout, projects)
}
