/**
 * When the window plays a call (ADR 0009, decision 3): calls that come
 * together make one sound, the loudest; for a while after a sound, only a
 * louder call plays. Pure, so plain tests cover it.
 */
import { MARK_ORDER } from "@banda/ui/components/banda-mark"
import type { Chime } from "@banda/ui/sound"

/** How long calls gather before the loudest of them plays, in ms. */
export const GATHER = 100

/** How long after a sound only a louder call plays, in ms. */
export const QUIET_FOR = 1500

export type Played = { chime: Chime; at: number }

/** The loudest of `chimes`, in the Mark's order. */
export function loudestChime(chimes: readonly Chime[]): Chime | undefined {
  let loudest: Chime | undefined
  for (const chime of chimes)
    if (!loudest || MARK_ORDER[chime] > MARK_ORDER[loudest]) loudest = chime
  return loudest
}

/** Whether `chime` plays at `now`, after the sound that played `last`. */
export function plays(
  last: Played | undefined,
  chime: Chime,
  now: number
): boolean {
  if (!last || now - last.at >= QUIET_FOR) return true
  return MARK_ORDER[chime] > MARK_ORDER[last.chime]
}
