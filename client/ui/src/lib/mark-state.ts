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
  /** A turn runs: a circle that shows what its Agent does (`MarkDoing`). */
  | "working"
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
  offline: 8,
  failed: 7,
  asking: 6,
  woke: 5,
  done: 4,
  working: 3,
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
  return state === "working"
}

/**
 * What a working mark shows its Agent doing (ADR 0099, decision 2), read
 * from its Thread's events (`doingOf` in status.ts): what its turn does,
 * by the kind of its tool call, a thought or the reply, a deletion and a
 * move drawn as an edit; else a calm series of those (`other`), as the
 * logo at work shows too. Above all that: it compacts the context, it has
 * said nothing for 3 minutes (`stuck`), or it waits on a usage limit.
 */
export type MarkDoing =
  | "think"
  | "read"
  | "search"
  | "edit"
  | "execute"
  | "fetch"
  | "reply"
  | "other"
  | "compacting"
  | "stuck"
  | "limit"

/** What a mark draws: its look, or for one at work, what its Agent does;
 * one with nothing said yet does the calm series. Its motion is keyed by
 * it (`LOOPED` in mark-rhythm.ts). */
export type Shown = Exclude<MarkState, "working"> | MarkDoing

/** What a mark in `look`, its Agent doing `doing`, draws. */
export function shownOf(look: MarkState, doing?: MarkDoing): Shown {
  return look === "working" ? (doing ?? "other") : look
}
