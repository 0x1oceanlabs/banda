/**
 * When a Group's plate moves (ADR 0065, decision 6). Its states' motion
 * is CSS's; what CSS cannot know is when each state came, and where each
 * piece of a plate stands in its Group, which these say.
 */
import type { GroupState } from "./groups"

/** A Group's state, and when it came on the page's clock. */
export type Seen = { state: GroupState | undefined; at: number }

/**
 * When a state that was there before the Strip first saw it came: long
 * enough ago that a swell is over, and a pulse goes on.
 */
export const LONG_AGO = -1e7

/**
 * Each Group's state, and when it came: `now` for one that changed since
 * `before`, `LONG_AGO` for one not seen before. So a swell plays for a
 * change the Strip sees, and not for a plate drawn again or first drawn.
 */
export function arrivals(
  before: ReadonlyMap<string, Seen>,
  states: ReadonlyMap<string, GroupState | undefined>,
  now: number
): Map<string, Seen> {
  const seen = new Map<string, Seen>()
  for (const [group, state] of states) {
    const was = before.get(group)
    if (!was) seen.set(group, { state, at: LONG_AGO })
    else seen.set(group, was.state === state ? was : { state, at: now })
  }
  return seen
}

/** A piece of a plate: whether it starts its Group, and how wide it is. */
export type Piece = { first: boolean; width: number }

/**
 * Where each piece stands in its Group, `x` from the Group's left edge,
 * and the whole Group's width: so a sheen, drawn piece by piece, is one
 * band across the Group. The pieces of a Group come one after another,
 * its first one first.
 */
export function spans(pieces: readonly Piece[]): { x: number; span: number }[] {
  const placed: { x: number; span: number }[] = []
  for (let start = 0; start < pieces.length;) {
    let end = start + 1
    while (end < pieces.length && !pieces[end]!.first) end++
    const run = pieces.slice(start, end)
    const span = run.reduce((sum, piece) => sum + piece.width, 0)
    let x = 0
    for (const piece of run) {
      placed.push({ x, span })
      x += piece.width
    }
    start = end
  }
  return placed
}
