/**
 * What calls the Person among what a module lists, what is news, and
 * where the window tells them of it (ADR 0011, decisions 1 and 6). Pure,
 * so plain tests cover it.
 */
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, PaneState } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import type { Notify } from "@banda/contract/look"

/** One thing that calls its Person now, as a module listed it. */
export type Call = {
  /** The thing, as its Pane names it (`PaneKind.shows`). */
  about: string
  chime: Chime
  title: string
  /** What it said, in a line: what it asks, why it failed, its task. */
  detail?: string
  /** What answering the call opens. */
  pane: PaneState
}

/** The marks that call for the Person, and their calls. */
const CHIMES: Partial<Record<MarkState, Chime>> = {
  done: "done",
  asking: "asking",
  failed: "failed",
}

/** The things in a list that call their Person now. */
export function callsOf(listed: readonly Listed[]): Call[] {
  return listed.flatMap((thing) => {
    const chime = CHIMES[thing.mark]
    if (!chime) return []
    const detail = thing.calls ?? thing.said
    return [
      {
        about: thing.id,
        chime,
        title: thing.title,
        ...(detail ? { detail } : {}),
        pane: thing.pane,
      },
    ]
  })
}

/**
 * The calls that are news in `now`, after `before`: a thing that starts
 * calling, or calls another way; and the things that stopped calling.
 * With nothing before, nothing is news: it already was.
 */
export function newsOf<C extends Call>(
  before: readonly C[] | undefined,
  now: readonly C[]
): { fresh: C[]; gone: C[] } {
  if (!before) return { fresh: [], gone: [] }
  const was = new Map(before.map((call) => [call.about, call]))
  const is = new Set(now.map((call) => call.about))
  return {
    fresh: now.filter((call) => was.get(call.about)?.chime !== call.chime),
    gone: before.filter((call) => !is.has(call.about)),
  }
}

/**
 * Where the Person's eyes are, for a thing that calls: on its Pane, with
 * the window in front; on the window, its Pane on screen or not; or
 * elsewhere.
 */
export type Sight = "looking" | "on-screen" | "in-window" | "away"

/** How the window tells of one call. */
export type Telling = { sound: boolean; toast: boolean; system: boolean }

const NOTHING: Telling = { sound: false, toast: false, system: false }

/**
 * How to tell of a call, from where the Person looks: nothing while they
 * look at it, or while the desktop is quiet; once, in one place,
 * otherwise. The sound is `[sound]`'s to choose.
 */
export function tell(
  chime: Chime,
  sight: Sight,
  settings: Notify,
  desktopQuiet: boolean
): Telling {
  if (sight === "looking") return NOTHING
  if (desktopQuiet && settings.quiet === "desktop") return NOTHING
  const notifies = settings[chime]
  const system =
    notifies &&
    (settings.system === "always" ||
      (settings.system === "away" && sight === "away"))
  const toast =
    notifies &&
    !system &&
    (settings.window === "always" ||
      (settings.window === "out-of-sight" && sight === "in-window"))
  return { sound: true, toast, system }
}
