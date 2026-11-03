/**
 * Every Space's servers in one list, in the order they came (ADR 0044,
 * decision 5): what `terminal.ports` says of each Space, put together.
 * Pure, so plain tests cover it.
 */
import type { SpaceId } from "@banda/contract"
import type { Server } from "@banda/contract/terminal"

/** A server, and the Space it is in. */
export type Placed = { space: SpaceId; server: Server }

const same = (a: Server, b: Server) =>
  a.port === b.port && a.process === b.process

/**
 * `before` once `space` says its servers are `servers`: its servers gone
 * leave, the ones still there keep their place and take what it says of
 * them now, and the new ones come last.
 */
export function arrived(
  before: readonly Placed[],
  space: SpaceId,
  servers: readonly Server[]
): Placed[] {
  const kept = before.flatMap((placed) => {
    if (placed.space !== space) return [placed]
    const now = servers.find((server) => same(server, placed.server))
    return now ? [{ space, server: now }] : []
  })
  const known = (server: Server) =>
    kept.some((placed) => placed.space === space && same(placed.server, server))
  const fresh = servers.filter((server) => !known(server))
  return [...kept, ...fresh.map((server) => ({ space, server }))]
}
