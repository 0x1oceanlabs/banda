/**
 * The window's clock (ADR 0007, decision 9; ADR 0088, decision 3): one
 * tick for each of the browser's animation frames, and only while
 * something asks for one, so a window where nothing moves runs none. A
 * tick runs, in this order:
 *
 * 1. the moves (`onMove`), which write;
 * 2. what reads after them (`afterMoves`), so it reads where they put
 *    things that tick, whichever asked first: a terminal's screen;
 * 3. what follows the moves (`followMoves`), only in a tick in which
 *    something moved, or that it asked for itself: first the overview,
 *    which draws the workspaces where the Strips stand, then a browser's
 *    page, which follows its tile wherever the two put it;
 * 4. what draws by itself (`onDraw`), as a Mark: last, so nothing reads
 *    the layout after it in the tick, and the frame lays out once.
 *
 * Each asks for its next tick itself, and the clock stops once none does.
 * One that throws stops none of the others: its error is reported as an
 * uncaught one is, which the window's problems hear (ADR 0039).
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
  draws: new Map<number, Run>(),
  /** This tick's, set aside as it began: what is taken back in it runs
   * not, as with the browser's own frames. */
  running: [] as Map<number, Run>[],
  /** The followers that run first, then the others. */
  first: new Set<Following>(),
  followers: new Set<Following>(),
  /** Something was put elsewhere that this tick's followers follow. */
  moved: false,
  /** Something was put elsewhere that the next tick's followers follow. */
  later: false,
  /** Inside a tick: what asks now runs in it, or asks for the next. */
  ticking: false,
  /** Inside a tick, the last followers know whether they run: what is
   * put elsewhere from then on is the next tick's. */
  followed: false,
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

/** Runs `run`; one that throws leaves the rest of the tick to run. */
function safely(run: Run, now: number): void {
  try {
    run(now)
  } catch (error) {
    reportError(error)
  }
}

/** Runs those of `all` that are due: all of them once something moved. */
function follow(all: Set<Following>, now: number, last = false) {
  const due = [...all].filter((each) => frames.moved || each.due)
  for (const following of due) following.due = false
  if (last) frames.followed = true
  for (const following of due)
    if (all.has(following)) safely(following.run, now)
}

function tick(now: number) {
  frames.asked = 0
  frames.ticking = true
  frames.moved = frames.later
  frames.later = false
  // What a run asks for comes in the next tick: the maps start afresh.
  const { moves, after, draws } = frames
  frames.moves = new Map()
  frames.after = new Map()
  frames.draws = new Map()
  frames.running = [moves, after, draws]
  if (moves.size > 0) frames.moved = true
  for (const run of moves.values()) safely(run, now)
  for (const run of after.values()) safely(run, now)
  follow(frames.first, now)
  follow(frames.followers, now, true)
  for (const run of draws.values()) safely(run, now)
  frames.running = []
  frames.ticking = false
  frames.followed = false
  frames.moved = false
  // A follower asked again in its own run, or after its turn.
  for (const all of [frames.first, frames.followers])
    for (const following of all) if (following.due) soon()
}

/** Runs `run` in the next tick, with the other moves. */
export function onMove(run: Run): number {
  return ask(frames.moves, run)
}

/** Runs `run` in the next tick, once every move has stepped in it. */
export function afterMoves(run: Run): number {
  return ask(frames.after, run)
}

/** Runs `run` last in the next tick, after the moves and what follows
 * them: what draws by itself and reads little, as a Mark. */
export function onDraw(run: Run): number {
  return ask(frames.draws, run)
}

/** Takes back what `onMove`, `afterMoves` or `onDraw` asked for, even in
 * the tick it was to run in. */
export function cancelFrame(id: number): void {
  for (const asked of [
    frames.moves,
    frames.after,
    frames.draws,
    ...frames.running,
  ])
    asked.delete(id)
}

/**
 * Something was put elsewhere outside a move's step, as a move that jumps
 * there: the followers run after it, in this tick if one runs and they
 * have not yet, else in the next.
 */
export function moved(): void {
  if (frames.ticking && !frames.followed) {
    frames.moved = true
    return
  }
  frames.later = true
  soon()
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
