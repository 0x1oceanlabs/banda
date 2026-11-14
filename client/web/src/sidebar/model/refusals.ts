/**
 * Why an act leaves a card where it is (spec §2.6, "Refusals"): the
 * words of the toast `S` shows on a card that asks or works, and what
 * "Archive N done" left. Pure but for the one toast.
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

/**
 * What "Archive N done" left, its cards' machines not reached, each why
 * in the words its Panes' pill says, as "mac is away": "2 not reached
 * (mac is away)"; none where it left none.
 */
export function leftSaid(away: readonly string[]): string | undefined {
  if (away.length === 0) return undefined
  const counted = new Map<string, number>()
  for (const why of away) counted.set(why, (counted.get(why) ?? 0) + 1)
  return [...counted].map(([why, n]) => `${n} not reached (${why})`).join(", ")
}
