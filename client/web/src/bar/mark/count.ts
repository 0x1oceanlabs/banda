/**
 * The count beside the bar's logo while the sidebar is hidden (ADR 0098,
 * decision 22): how many are the Person's turn and how many work, "3 · 7",
 * the turn in its loudest call's colour; and the logo's name, which says
 * the same in words. The words are the sidebar's own: its Your turn, and
 * "7 at work", as inbox zero and the small inbox say it. Pure, so plain
 * tests cover it.
 */
import {
  callColor,
  MARK_WORDS,
  type MarkState,
  works,
} from "@banda/ui/components/banda-mark"
import type { Lists } from "@banda/ui/pane"
import { TONES } from "../../sidebar/CardStatus"
import { tally } from "../../sidebar/tally"

/** What the count says: the Person's turn, the loudest look of it, and
 * how many work. */
export type InboxCount = { turn: number; mark: MarkState; working: number }

/** Nothing calls and nothing works. */
export const NO_COUNT: InboxCount = { turn: 0, mark: "rest", working: 0 }

/** The count over every list at `now`, the Later clock: what is put away
 * counts as neither, as the sidebar's tabs count it. */
export function countOf(lists: Lists, now: number): InboxCount {
  const tallies = tally(lists, ["waiting", "working"], now)
  const turn = tallies.find((one) => one.count === "waiting")
  const working = tallies.find((one) => one.count === "working")
  return {
    turn: turn?.things.length ?? 0,
    mark: turn?.mark ?? "rest",
    working: working?.things.length ?? 0,
  }
}

/** How many work, as the small inbox's way to the sidebar says it. */
export const atWork = (working: number): string => `${working} at work`

/** The count in words, each part that has any: "3 your turn, 7 at work". */
export function countWords({ turn, working }: InboxCount): string {
  return [
    ...(turn > 0 ? [`${turn} your turn`] : []),
    ...(working > 0 ? [atWork(working)] : []),
  ].join(", ")
}

/** The class of the turn's number: its loudest call's colour, woke's
 * darker where it is small text on a light theme; the text's else. */
export function turnTone(mark: MarkState): string {
  const color = callColor(mark)
  return color ? TONES[color] : "text-foreground"
}

/**
 * What the logo says after its name (ADR 0098, decision 22): what it
 * shows where the count does not say it, "Woke" or "Offline", or which
 * machine is away while its Agents were at work (`away`, decision 18);
 * the count, "3 your turn, 7 at work"; and "Quiet on" while Quiet is on.
 * Nothing, with nothing to say.
 */
export function logoWords(
  mark: MarkState,
  count: InboxCount,
  quiet: boolean,
  away?: string
): string {
  const shown =
    mark === "rest"
      ? undefined
      : (away ?? (works(mark) ? undefined : MARK_WORDS[mark]))
  return [
    ...(shown ? [shown] : []),
    ...(count.turn + count.working > 0 ? [countWords(count)] : []),
    ...(quiet ? ["Quiet on"] : []),
  ].join(", ")
}

/** The logo's name: "Banda: 3 your turn, 7 at work", or "Banda". */
export const logoName = (words: string): string =>
  words ? `Banda: ${words}` : "Banda"
