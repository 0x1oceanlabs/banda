/**
 * What is news among what calls, and where to tell of it (ADR 0011,
 * decisions 1 and 6; ADR 0056, decision 1). Pure, so plain tests cover it.
 */
import type { Notify } from "@banda/contract/look"
import type { Sight } from "@banda/ui/module"
import type { Call } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"

/**
 * The calls that are news in `now`, after `before`: a thing that starts
 * calling, or calls another way; and the things that stopped calling.
 * With nothing before, nothing is news: it already was.
 */
export function newsOf(
  before: readonly Call[] | undefined,
  now: readonly Call[]
): { fresh: Call[]; gone: Call[] } {
  if (!before) return { fresh: [], gone: [] }
  const was = new Map(before.map((call) => [call.key, call]))
  const is = new Set(now.map((call) => call.key))
  return {
    fresh: now.filter((call) => was.get(call.key)?.chime !== call.chime),
    gone: before.filter((call) => !is.has(call.key)),
  }
}

/** How the window tells of one call. */
export type Telling = { sound: boolean; toast: boolean; system: boolean }

const NOTHING: Telling = { sound: false, toast: false, system: false }

/** Where the window tells of something it tells of at all. */
export type Place = { toast: boolean; system: boolean }

/**
 * Where to tell of something, from where the Person looks: nowhere while
 * they look at it, or while the desktop is quiet; once, in one place,
 * otherwise. A call's and a Problem's alike (ADR 0039).
 */
export function placeOf(
  sight: Sight,
  settings: Notify,
  desktopQuiet: boolean
): Place | null {
  if (sight === "looking") return null
  if (desktopQuiet && settings.quiet === "desktop") return null
  const system =
    settings.system === "always" ||
    (settings.system === "away" && sight === "away")
  const toast =
    !system &&
    (settings.window === "always" ||
      (settings.window === "out-of-sight" && sight === "in-window"))
  return { toast, system }
}

/**
 * How to tell of a call: where, if `[notify]` tells of its kind; the
 * sound is `[sound]`'s to choose.
 */
export function tell(
  chime: Chime,
  sight: Sight,
  settings: Notify,
  desktopQuiet: boolean
): Telling {
  const place = placeOf(sight, settings, desktopQuiet)
  if (!place) return NOTHING
  const notifies = settings[chime]
  return {
    sound: true,
    toast: notifies && place.toast,
    system: notifies && place.system,
  }
}
