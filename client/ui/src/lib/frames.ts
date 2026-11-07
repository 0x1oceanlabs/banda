/**
 * The window's frames, shared by what moves and what follows it (ADR 0007,
 * decision 9): every move steps first in a frame, and what draws after
 * the moves (`afterMoves`) runs last in it, so it reads where they put
 * things that frame, whichever asked first. A browser's page that follows
 * its tile, and the overview that follows the Strips, draw there.
 */
type Run = (now: number) => void

const frames = {
  moves: new Map<number, Run>(),
  after: new Map<number, Run>(),
  next: 0,
  asked: 0,
}

function ask(into: Map<number, Run>, run: Run): number {
  const id = ++frames.next
  into.set(id, run)
  frames.asked ||= requestAnimationFrame(flush)
  return id
}

function flush(now: number) {
  frames.asked = 0
  // What a step asks for comes in the next frame: the maps start afresh.
  const moves = frames.moves
  const after = frames.after
  frames.moves = new Map()
  frames.after = new Map()
  for (const run of moves.values()) run(now)
  for (const run of after.values()) run(now)
}

/** Runs `run` in the next frame, with the other moves. */
export function onMove(run: Run): number {
  return ask(frames.moves, run)
}

/** Runs `run` in the next frame, once every move has stepped in it. */
export function afterMoves(run: Run): number {
  return ask(frames.after, run)
}

/** Takes back what `onMove` or `afterMoves` asked for. */
export function cancelFrame(id: number): void {
  frames.moves.delete(id)
  frames.after.delete(id)
}
