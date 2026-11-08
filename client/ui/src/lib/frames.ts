/**
 * The window's clock (ADR 0007, decision 9; ADR 0088, decision 3): one
 * tick for each of the browser's animation frames, and only while
 * something asks for one, so a window where nothing moves runs none. A
 * tick runs, in this order:
 *
 * 1. the moves (`onMove`), which write;
 * 2. what reads after them (`afterMoves`), so it reads where they put
 *    things that tick, whichever asked first: a Mark, a terminal's screen;
 * 3. what follows the moves (`followMoves`), only in a tick in which
 *    something moved, or that it asked for itself: first the overview,
 *    which draws the workspaces where the Strips stand, then a browser's
 *    page, which follows its tile wherever the two put it.
 *
 * Each asks for its next tick itself, and the clock stops once none does.
 */
type Run = (now: number) => void

/** A follower of the moves (`followMoves`). */
export type Follower = {
  /** It runs in the next tick, whether anything moves or not. */
  again(): void
  /** It no longer runs. */
  stop(): void
}

type Following = { run: Run; due: boolean }

const frames = {
  moves: new Map<number, Run>(),
  after: new Map<number, Run>(),
  /** The followers that run first, then the others. */
  first: new Set<Following>(),
  followers: new Set<Following>(),
  /** Something was put elsewhere that the followers yet to run follow. */
  moved: false,
  /** Inside a tick: what asks now runs in it, or asks for the next. */
  ticking: false,
  next: 0,
  asked: 0,
}

/** The next tick, asked of the browser once. */
function soon(): void {
  frames.asked ||= requestAnimationFrame(tick)
}

function ask(into: Map<number, Run>, run: Run): number {
  const id = ++frames.next
  into.set(id, run)
  soon()
  return id
}

/** Runs those of `all` that are due: all of them once something moved. */
function follow(all: Set<Following>, now: number) {
  const due = [...all].filter((each) => frames.moved || each.due)
  for (const following of due) following.due = false
  for (const following of due) if (all.has(following)) following.run(now)
}

function tick(now: number) {
  frames.asked = 0
  frames.ticking = true
  // What a step asks for comes in the next tick: the maps start afresh.
  const moves = frames.moves
  const after = frames.after
  frames.moves = new Map()
  frames.after = new Map()
  try {
    for (const run of moves.values()) run(now)
    if (moves.size > 0) frames.moved = true
    for (const run of after.values()) run(now)
    follow(frames.first, now)
    follow(frames.followers, now)
  } finally {
    frames.ticking = false
    frames.moved = false
    // A follower asked again in its own run, or after its turn.
    for (const all of [frames.first, frames.followers])
      for (const following of all) if (following.due) soon()
  }
}

/** Runs `run` in the next tick, with the other moves. */
export function onMove(run: Run): number {
  return ask(frames.moves, run)
}

/** Runs `run` in the next tick, once every move has stepped in it. */
export function afterMoves(run: Run): number {
  return ask(frames.after, run)
}

/** Takes back what `onMove` or `afterMoves` asked for. */
export function cancelFrame(id: number): void {
  frames.moves.delete(id)
  frames.after.delete(id)
}

/**
 * Something was put elsewhere outside a move's step, as a move that jumps
 * there: the followers run after it, in this tick if one runs and has not
 * reached them, else in the next.
 */
export function moved(): void {
  frames.moved = true
  if (!frames.ticking) soon()
}

/**
 * Runs `run` late in every tick in which something moved: a move stepped,
 * or `moved` said so. It asks for no tick of its own but by `again`, so a
 * follower costs nothing while nothing moves. One that runs `first` runs
 * before the others, so they follow what it puts elsewhere in the same
 * tick.
 */
export function followMoves(run: Run, { first = false } = {}): Follower {
  const all = first ? frames.first : frames.followers
  const following: Following = { run, due: false }
  all.add(following)
  return {
    again() {
      if (!all.has(following)) return
      following.due = true
      if (!frames.ticking) soon()
    },
    stop() {
      all.delete(following)
    },
  }
}
