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
 * without colour (ADR 0099, decision 1): a square, all is calm; a circle,
 * work goes on; a triangle, it asks the Person; an octagon, a stop sign,
 * it failed.
 *
 * The same character shows one Thread's look (`lookOf`), or, as the logo,
 * the loudest look of them all (see `loudest`).
 */
export type MarkState =
  /** Nothing goes on: a still hat with no eyes. */
  | "rest"
  /** A Thread with no turn running, open: awake, looks around. */
  | "idle"
  /** The Agent thinks before it acts. */
  | "thinking"
  /** A turn runs. */
  | "running"
  /** A Question waits for the Person. A triangle in `--attention`. */
  | "asking"
  /** A turn ended well and the Person has not looked yet. In `--added`. */
  | "done"
  /** A turn failed. An octagon in `--destructive`, with crossed eyes. */
  | "failed"
  /** The engine does not answer: asleep, snoring. */
  | "offline"
  /** It came back from Later by itself and its Person has not seen it: an
   * alarm clock, with two small bells, in `--woke`. */
  | "woke"
  /** Put off until Later: asleep, its eyes closed, with no snore. */
  | "later"

/** Which state the logo shows when several are true at once (ADR 0099,
 * decision 9): offline › failed › asking › woke › done › working › rest. */
export const MARK_ORDER: Record<MarkState, number> = {
  offline: 9,
  failed: 8,
  asking: 7,
  woke: 6,
  done: 5,
  running: 4,
  thinking: 3,
  idle: 2,
  later: 1,
  rest: 0,
}

/** The state that matters most among many: what the logo should show. An
 * open Thread or one put off calls no one, so the logo rests for them. */
export function loudest(states: Iterable<MarkState>): MarkState {
  let best: MarkState = "rest"
  for (const state of states) {
    if (MARK_ORDER[state] > MARK_ORDER[best]) best = state
  }
  return best === "idle" || best === "later" ? "rest" : best
}

/** A state of an Agent at work. */
export function works(state: MarkState): boolean {
  return state === "running" || state === "thinking"
}
