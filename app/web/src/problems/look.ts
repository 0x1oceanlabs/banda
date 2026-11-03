/**
 * Looking into a Problem (ADR 0039, decision 3): a new Thread with the
 * Person's default Harness, asked to read the Problem and follow the
 * Banda skill's `problems` topic. Nothing starts by itself: it costs the
 * Person's model. When the engine runs from a checkout of Banda's source
 * and a Space is that checkout, the Thread opens there, where the topic
 * has the Agent fix it; else in the window's home Space.
 */
import type { Engine, SpaceId, SpaceSummary } from "@banda/contract"
import { openSpaces } from "@banda/ui/lib/spaces"

/** What `thread.new` is given to look into a Problem: its Space, none
 * for the window's home one, and what it asks. */
export type LookInto = { space?: SpaceId; ask: string }

/** How a Thread looks into Problem `fingerprint`, which the engine says
 * runs from `checkout`, if it does. */
export function lookInto(
  fingerprint: string,
  checkout: string | null,
  spaces: readonly SpaceSummary[]
): LookInto {
  const ask = `Look into Banda's Problem ${fingerprint}: read it with the \`problem\` tool, and follow the Banda skill's \`problems\` topic.`
  const space = openSpaces(spaces).find((one) => one.folder === checkout)
  return space ? { space: space.id, ask } : { ask }
}

/** Reads what it takes to look into Problem `fingerprint`, as it is
 * clicked: nothing is read before. */
export async function lookingInto(
  engine: Engine,
  fingerprint: string
): Promise<LookInto> {
  const [report, spaces] = await Promise.all([
    engine.call("problems.problem", { fingerprint }),
    engine.call("spaces.list", {}),
  ])
  return lookInto(fingerprint, report.checkout, spaces)
}
