/**
 * The pick (ADR 0098, decision 13; spec §2.7): the one place in the list
 * that the sidebar's keys act on, by its key, never by an index. Each tab
 * keeps its own. It is a card's key (`itemKey`), or a stop that is no
 * card: a folded group, or "+ N more". The arrows move it from stop to
 * stop in the drawn order and stop at the ends; after an act took cards
 * out of the tab, it goes on to the card below, as in a mail inbox.
 * Pure, so plain tests cover it.
 */
import type { Tab } from "./inbox"

/** The pick of each tab, by its key. */
export type Picks = Partial<Readonly<Record<Tab, string>>>

/**
 * Where the pick goes after an act on `picked` took the cards `gone` out
 * of the tab, among the cards `order` drew just before it: the first card
 * below the last that went, across parts; else the nearest above the
 * first that went; else none, and the list keeps the focus and says inbox
 * zero. A pick that did not go, as after `U` or a refused `S`, stays.
 */
export function pickAfter(
  order: readonly string[],
  gone: ReadonlySet<string>,
  picked: string
): string | undefined {
  if (!gone.has(picked)) return picked
  const went = order.flatMap((key, at) => (gone.has(key) ? [at] : []))
  const below = order
    .slice((went.at(-1) ?? -1) + 1)
    .find((key) => !gone.has(key))
  if (below !== undefined) return below
  return order
    .slice(0, went[0] ?? order.length)
    .findLast((key) => !gone.has(key))
}

/**
 * The pick on the way into the list (spec §2.7): the open Thread's card,
 * if `stops` has it; else this tab's last pick, if it is still drawn;
 * else the first stop.
 */
export function pickIn(
  stops: readonly string[],
  open: string | undefined,
  last: string | undefined
): string | undefined {
  if (open !== undefined && stops.includes(open)) return open
  if (last !== undefined && stops.includes(last)) return last
  return stops[0]
}

/** How a widget key moves the pick: by some stops, or to an end. */
export type Step = number | "first" | "last"

/**
 * The stop `step` moves the pick to from `picked` among `stops`: they do
 * not wrap, so a step past an end stays there. From a pick no longer
 * drawn, a step down starts at the first and a step up at the last.
 */
export function stepped(
  stops: readonly string[],
  picked: string | undefined,
  step: Step
): string | undefined {
  if (stops.length === 0) return undefined
  if (step === "first") return stops[0]
  if (step === "last") return stops.at(-1)
  const at = picked === undefined ? -1 : stops.indexOf(picked)
  if (at === -1) return step > 0 ? stops[0] : stops.at(-1)
  return stops[Math.max(0, Math.min(stops.length - 1, at + step))]
}
