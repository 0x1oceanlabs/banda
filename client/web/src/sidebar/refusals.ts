/**
 * Why an act leaves a card where it is (spec §2.6, "Refusals"; S10b): the
 * words of the toast `S` shows on a card that asks or works, and what an
 * act on several cards at once left. Pure but for the one toast.
 */
import { toast } from "@banda/ui/components/sonner"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"

/** The toast a refusal shows in: one at a time. */
export const REFUSED = "sidebar-refused"

/**
 * Why the sidebar's `S` leaves a card where it is (spec §2.6, "Refusals"):
 * one that asks is answered first, and one at work waits for its turn's
 * end; `later` names the key in force that puts it off. The toast's title
 * says what stops it, and its next line, which wraps, what to do. None for
 * any other card.
 */
export function refusalOf(
  { stand, listed }: { stand: Stand; listed: Pick<Listed, "title" | "mark"> },
  later: string | undefined
): { title: string; description: string } | undefined {
  const title = `“${listed.title}”`
  if (stand === "working")
    return {
      title: `${title} is at work.`,
      description: later
        ? `${later} puts it off until it's done.`
        : "Put it off until it's done.",
    }
  if (listed.mark === "asking")
    return {
      title: `${title} asks you.`,
      description: later
        ? `Answer it, or ${later} puts it off.`
        : "Answer it, or put it off.",
    }
  return undefined
}

/** Says why `S` leaves the card, by `refusalOf`, in a toast, never a
 * shake. */
export function refused(
  card: Parameters<typeof refusalOf>[0],
  later: string | undefined
): void {
  const why = refusalOf(card, later)
  if (why) toast(why.title, { id: REFUSED, description: why.description })
}

/** What a card of a set says to an act that leaves it: it asks, it is at
 * work, or its machine is not reached, and why, in the words its Panes'
 * pill says, as "mac is away". */
export type Left = "asks" | "works" | { away: string }

/** How many `n` of a word, its verb by number: "1 asks", "2 ask". */
const counted = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * What an act on several cards at once left, still selected (spec §2.6):
 * "1 asks you, 2 are at work, 2 not reached (mac is away), still
 * selected"; none where it left none.
 */
export function leftSaid(left: readonly Left[]): string | undefined {
  if (left.length === 0) return undefined
  const asks = left.filter((one) => one === "asks").length
  const works = left.filter((one) => one === "works").length
  const away = new Map<string, number>()
  for (const one of left)
    if (typeof one === "object")
      away.set(one.away, (away.get(one.away) ?? 0) + 1)
  return [
    asks > 0 && `${counted(asks, "asks", "ask")} you`,
    works > 0 && `${counted(works, "is", "are")} at work`,
    ...[...away].map(([why, n]) => `${n} not reached (${why})`),
    "still selected",
  ]
    .filter(Boolean)
    .join(", ")
}

/**
 * Why Archive leaves every card of a set where it is (spec S10b): they
 * ask, or they are at work; `later` names the key in force that puts them
 * off. One card says it as `S` does on it alone.
 */
export function setRefusalOf(
  cards: readonly { stand: Stand; listed: Pick<Listed, "title" | "mark"> }[],
  later: string | undefined
): string | undefined {
  const [one] = cards
  if (!one) return undefined
  if (cards.length === 1) {
    const why = refusalOf(one, later)
    return why && `${why.title} ${why.description}`
  }
  const working = cards.filter((card) => card.stand === "working").length
  if (working === cards.length)
    return `They are at work. ${
      later ? `${later} puts them off` : "Put them off"
    } until they're done.`
  const off = later ? `${later} puts them off.` : "Put them off."
  return working > 0
    ? `They ask you or are at work. ${off}`
    : `They ask you. ${off}`
}
