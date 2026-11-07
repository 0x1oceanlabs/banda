/**
 * Every Project's servers in one list, in the order they came (ADR 0044,
 * decision 5): what `terminal.ports` says of each Project, put together.
 * Pure, so plain tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Server } from "@banda/contract/terminal"

/** A server, and the Project it is in. */
export type Placed = { project: ProjectId; server: Server }

const same = (a: Server, b: Server) =>
  a.port === b.port && a.process === b.process

/**
 * `before` once `project` says its servers are `servers`: its servers gone
 * leave, the ones still there keep their place and take what it says of
 * them now, and the new ones come last.
 */
export function arrived(
  before: readonly Placed[],
  project: ProjectId,
  servers: readonly Server[]
): Placed[] {
  const kept = before.flatMap((placed) => {
    if (placed.project !== project) return [placed]
    const now = servers.find((server) => same(server, placed.server))
    return now ? [{ project, server: now }] : []
  })
  const known = (server: Server) =>
    kept.some(
      (placed) => placed.project === project && same(placed.server, server)
    )
  const fresh = servers.filter((server) => !known(server))
  return [...kept, ...fresh.map((server) => ({ project, server }))]
}
