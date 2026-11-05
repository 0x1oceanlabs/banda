/**
 * What follows a git action of a Thread's card: its Agent is told what
 * changed, in a notice it reads before its next message (`agents.notice`),
 * so a commit it did not make is no surprise; and when no card of the
 * Space is in sight, the Person is told how a commit, push or pull ended,
 * in a toast (`notifications.tell`). A card in sight says it itself.
 */
import type { Engine, SpaceId } from "@banda/contract"
import type { Args, Sight, WindowApi } from "@banda/ui/module"

/** The cards drawn now, by Space: each one's Thread, none for a new one. */
const cards = new Map<SpaceId, Map<symbol, string | null>>()

/** What the window lets the module ask, while it runs. */
let kept: WindowApi | null = null

/** Keeps `window` for the module while it runs it; returns how to let it
 * go. */
export function keepWindow(window: WindowApi): () => void {
  kept = window
  return () => {
    if (kept === window) kept = null
  }
}

/** Says a card of `thread` in `space` is drawn; returns how to say it is
 * gone. A hidden card is not drawn, nor a closed popover's. */
export function cardShown(space: SpaceId, thread: string | null): () => void {
  const one = Symbol(space)
  const drawn = cards.get(space) ?? new Map<symbol, string | null>()
  cards.set(space, drawn.set(one, thread))
  return () => {
    drawn.delete(one)
    if (drawn.size === 0 && cards.get(space) === drawn) cards.delete(space)
  }
}

/** Whether a card of `space` drawn for one of `threads` is in sight: its
 * Thread's Pane on screen with the window in front; a new Thread's, which
 * no Pane names yet, with the window in front. */
export function inSight(
  space: SpaceId,
  threads: Iterable<string | null>,
  sight: (thing?: { space: SpaceId; about: string }) => Sight
): boolean {
  for (const thread of threads) {
    if (thread === null) {
      if (sight() !== "away") return true
      continue
    }
    const seen = sight({ space, about: thread })
    if (seen === "looking" || seen === "on-screen") return true
  }
  return false
}

/** How a run of the git button ended, as the card says it. */
export type Ended =
  | { is: "done"; title: string; detail?: string; notice?: string }
  | { is: "failed"; message: string }

/** The toast of a run that ended, as `notifications.tell` takes it: one
 * per Space, the next replacing it; a failure sounds and says why. */
export function toldOf(space: SpaceId, ended: Ended, named?: string): Args {
  const where: Args = named ? { space: named } : {}
  if (ended.is === "done")
    return {
      key: `git.${space}`,
      kind: "done",
      title: ended.title,
      ...(ended.detail ? { body: ended.detail } : {}),
      ...where,
      buttons: [],
      silent: true,
    }
  return {
    key: `git.${space}`,
    kind: "failed",
    title: "Git failed",
    body: ended.message,
    ...where,
    buttons: [],
    close: true,
  }
}

/** Tells `thread`'s Agent `text`: what the Person did from its card. A
 * notice that does not go is no failure of what was done. */
export function tellAgent(
  engine: Engine,
  space: SpaceId,
  thread: string | null,
  text: string | undefined
): void {
  if (thread === null || !text) return
  engine
    .command("agents.notice", { thread, text }, space)
    .catch((error: unknown) =>
      console.warn("the Thread's Agent was not told", error)
    )
}

/** What follows a run of the card's git button in `space`, started from
 * `thread`'s card: its Agent hears what changed, and the Person how it
 * ended when no card of the Space is in sight. */
export function afterRun(
  engine: Engine,
  space: SpaceId,
  thread: string | null,
  run: Ended
): void {
  if (run.is === "done") tellAgent(engine, space, thread, run.notice)
  const window = kept
  if (!window) return
  const drawn = cards.get(space)?.values() ?? []
  if (inSight(space, drawn, (thing) => window.sight(thing))) return
  const spaces = window.spaces()
  const named =
    spaces.length > 1
      ? spaces.find((each) => each.id === space)?.name || undefined
      : undefined
  window.run("notifications.tell", toldOf(space, run, named))
}
