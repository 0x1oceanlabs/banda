/**
 * The states Banda's mark shows, and how they rank, apart from how it
 * draws them (`components/banda-mark`): pure, so the status of a Thread
 * (`status.ts`) reads them with no React.
 */

/**
 * Banda's mark: three tiles, the window's tiling, and the top one, tipped
 * like a hat, is the Agent at work. At rest it is still and has no eyes.
 * When something happens it wakes: it opens its eyes, moves, changes its
 * shape, and settles back.
 *
 * Its shape says what kind of state it is, so a list reads at a glance and
 * without colour: a square, all is calm; a circle, work goes on; a
 * triangle, it needs the Person.
 *
 * The same character shows one Thread's state, or, as the logo, the
 * loudest state of them all (see `loudest`).
 */
export type MarkState =
  /** Nothing goes on: a still hat with no eyes. */
  | "rest"
  /** A Thread with no turn running: awake, looks around. */
  | "idle"
  /** The Agent thinks before it acts. */
  | "thinking"
  /** A turn runs. */
  | "running"
  /** A Question waits for the Person. Lit in `--attention`. */
  | "asking"
  /** A turn ended well and the Person has not looked yet. */
  | "done"
  /** A turn failed. Red, in `--destructive`. */
  | "failed"
  /** The engine does not answer: asleep. */
  | "offline"

/** Which state the logo shows when several are true at once. */
export const MARK_ORDER: Record<MarkState, number> = {
  offline: 7,
  failed: 6,
  asking: 5,
  done: 4,
  running: 3,
  thinking: 2,
  idle: 1,
  rest: 0,
}

/** The state that matters most among many: what the logo should show. */
export function loudest(states: Iterable<MarkState>): MarkState {
  let best: MarkState = "rest"
  for (const state of states) {
    if (MARK_ORDER[state] > MARK_ORDER[best]) best = state
  }
  return best === "idle" ? "rest" : best
}

/** A state of an Agent at work. */
export function works(state: MarkState): boolean {
  return state === "running" || state === "thinking"
}
