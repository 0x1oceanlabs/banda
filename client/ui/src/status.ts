/**
 * Where a Thread stands for its Person, said once (ADR 0098, decision 26):
 * the sidebar, the bar's Mark and counts, `Alt+U`, the notifications and
 * the workspaces' dots all read it here, so they never disagree. Its turn,
 * open, at work, put off until Later, or archived. Pure, read against the
 * Later clock, so plain tests cover it.
 */
import type { ProjectId } from "@banda/contract"
import type { Count } from "@banda/contract/sidebar"
import { loudest, type MarkState, works } from "./lib/mark-state"
import { sleeps, wokeOf } from "./lib/later"
import type { Attention, Call, Listed, Lists } from "./pane"
import type { Chime } from "./sound/families"

/**
 * Where a Thread stands:
 * - `turn`: it calls its Person: it asks, it failed, it finished and they
 *   have not seen it, or it woke from Later by itself;
 * - `open`: nothing runs in it and nothing calls;
 * - `working`: its Agent is at work;
 * - `later`: put off, it sleeps, until a time, until its turn is done or
 *   Someday;
 * - `archived`: the Person put it away (ADR 0096).
 */
export type Stand = "turn" | "open" | "working" | "later" | "archived"

/** Each place's words, as a tab or a heading names it. */
export const STAND_WORDS: Readonly<Record<Stand, string>> = {
  turn: "Your turn",
  open: "Open",
  working: "Working",
  later: "Later",
  archived: "Archive",
}

/** The marks that call their Person, and their calls (ADR 0011): with a
 * Thread that woke by itself, what "waiting" means. */
const CHIMES: Partial<Record<MarkState, Chime>> = {
  done: "done",
  asking: "asking",
  failed: "failed",
}

/** Whether `mark` calls its Person to look or act. */
export function calls(mark: MarkState): boolean {
  return CHIMES[mark] !== undefined
}

/** Whether `listed` sleeps at `now`, put off until Later (ADR 0074). */
export function asleep(listed: Listed, now: number): boolean {
  return sleeps(listed.later, now)
}

/** When `listed` woke from Later by itself, while its Person has not seen
 * it; none otherwise. `banda status` reads it alike (`woke_at` in the
 * engine's counts.rs), so both count the same Threads. */
export function wokeAt(listed: Listed, now: number): number | undefined {
  return listed.later?.wokeSeen ? undefined : wokeOf(listed.later, now)
}

/** Where `listed` stands at `now`. A Later outranks the rest: one put off
 * calls no one while it sleeps (ADR 0074); then work; then the archive,
 * which holds only what neither works nor asks. */
export function standOf(listed: Listed, now: number): Stand {
  if (asleep(listed, now)) return "later"
  if (works(listed.mark)) return "working"
  if (listed.archived) return "archived"
  return calls(listed.mark) || wokeAt(listed, now) !== undefined
    ? "turn"
    : "open"
}

/**
 * What `listed`'s Mark shows at `now` (ADR 0099, decisions 1 and 12), the
 * one place the sidebar, the bar, a Pane's header and the notifications
 * take it from:
 * - put off, it sleeps as `later`, and an archived one sleeps so too, as
 *   the approved mocks draw the Archive's cards;
 * - back from Later by itself, it rings as `woke` (`wokeRings`);
 * - open, seen and done with, it is awake and looks around: `idle`;
 * - else its mark says it: what asks, failed or is done, or what works.
 *
 * What a working one does joins it with ADR 0099's step 3.
 */
export function lookOf(listed: Listed, now: number): { look: MarkState } {
  return { look: lookIn(listed, standOf(listed, now), now) }
}

/** What `listed`'s Mark shows on its Pane's header at `now`: its look,
 * but open and seen it rests, as the logo does, so nothing moves there. */
export function headerLookOf(listed: Listed, now: number): MarkState {
  const { look } = lookOf(listed, now)
  return look === "idle" ? "rest" : look
}

function lookIn(listed: Listed, stand: Stand, now: number): MarkState {
  if (stand === "later" || stand === "archived") return "later"
  if (stand === "turn" && wokeRings(listed, now)) return "woke"
  if (stand === "open" && listed.mark === "rest") return "idle"
  return listed.mark
}

/**
 * Whether `listed` shows that it woke from Later at `now`: it woke by
 * itself, as its time came, or it calls for nothing else. So one put off
 * while it asked comes back as Woke with the same question (ADR 0098,
 * decision 11), and one that a new question, a failure or its turn's end
 * woke early shows that call.
 */
function wokeRings(listed: Listed, now: number): boolean {
  if (wokeAt(listed, now) === undefined) return false
  const by = listed.later?.woke?.by
  return by === undefined || by === "time" || !calls(listed.mark)
}

/** Whether a Thread that stands at `stand` is put away, Later or
 * archived: what the bar's Mark, its counts and dots leave out. */
export function isAway(stand: Stand): boolean {
  return stand === "later" || stand === "archived"
}

/** Which Threads each of the bar's counts takes (ADR 0035), by where they
 * stand and their mark: the Person's turn, whole or by what asks or failed
 * and what is done, or what works. */
const TAKES: Record<Count, (stand: Stand, mark: MarkState) => boolean> = {
  asking: (stand, mark) =>
    stand === "turn" && (mark === "asking" || mark === "failed"),
  done: (stand, mark) => stand === "turn" && mark === "done",
  waiting: (stand) => stand === "turn",
  working: (stand) => stand === "working",
}

/** Whether the bar's `count` takes a Thread that stands at `stand` with
 * `mark`. What is put away no count takes: its caller leaves it out
 * (`isAway`). */
export function takes(count: Count, stand: Stand, mark: MarkState): boolean {
  return TAKES[count](stand, mark)
}

/** Whether the Person may archive `listed`: not at work, not asking. */
export function mayArchive({ mark }: Pick<Listed, "mark">): boolean {
  return !works(mark) && mark !== "asking"
}

/** The bar's Mark over every list at `now`: the loudest look of what is
 * not put away, so a Thread that woke counts too (ADR 0099, decision 9),
 * and how many are the Person's turn. */
export function attentionOf(lists: Lists, now: number): Attention {
  const looks: MarkState[] = []
  let waiting = 0
  for (const listed of Object.values(lists).flat()) {
    const stand = standOf(listed, now)
    if (isAway(stand)) continue
    looks.push(lookIn(listed, stand, now))
    if (stand === "turn") waiting++
  }
  return { mark: loudest(looks), waiting }
}

/** The things in the lists that call their Person now, each a Call (ADR
 * 0011): those whose turn it is by their mark. One put off or archived
 * calls no one. */
export function callsOf(lists: Lists, now = Date.now()): Call[] {
  return Object.entries(lists).flatMap(([project, listed]) =>
    (listed ?? []).flatMap((thing): Call[] => {
      const chime = CHIMES[thing.mark]
      if (!chime || standOf(thing, now) !== "turn") return []
      const detail = thing.calls ?? thing.said
      return [
        {
          key: `${project}:${thing.id}`,
          project: project as ProjectId,
          about: thing.id,
          chime,
          title: thing.title,
          ...(detail ? { detail } : {}),
          ...(thing.asker ? { asker: thing.asker } : {}),
          pane: thing.pane,
          ...(thing.host !== undefined && { host: thing.host }),
          since: thing.changed,
          ...(thing.answers?.length ? { answers: thing.answers } : {}),
        },
      ]
    })
  )
}
