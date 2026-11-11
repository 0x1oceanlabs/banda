/**
 * The pick (ADR 0098, decision 13; spec §2.7): the one place in the list
 * that the sidebar's keys act on, by its key, never by an index. Each tab
 * keeps its own. It is a card's key (`itemKey`), or a stop that is no
 * card: a folded group, or "+ N more". The arrows move it from stop to
 * stop in the drawn order and stop at the ends; after an act took cards
 * out of the tab, it goes on to the card below, as in a mail inbox. The
 * selection (decision 15) is the cards checked besides, which the acts
 * take while there are any: one at a time, a range from its anchor, or
 * every card drawn. Pure, so plain tests cover it.
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

/** A stop of the pick as the selection reads it: its key, and whether it
 * is a card that may be selected, not a folded group, "+ N more" or a
 * card that left the tab while the list held. */
export type Stop = { key: string; card: boolean }

/**
 * The selection (ADR 0098, decision 15; spec §2.7): the cards checked,
 * which `S`, `Z` and `U` act on while there are any; the card a range
 * starts from, the last one checked by itself; and what was checked
 * before that range, which a range adds to, so Shift+↓ then Shift+↑ gives
 * back what it took.
 */
export type Checks = {
  selected: ReadonlySet<string>
  anchor?: string
  base: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

export const NO_CHECKS: Checks = { selected: NONE, base: NONE }

/** The selection of just `keys`, the first its anchor. */
export function checksOf(keys: Iterable<string>): Checks {
  const selected = new Set(keys)
  if (selected.size === 0) return NO_CHECKS
  const [anchor] = selected
  return { selected, anchor, base: selected }
}

/** `checks` with the card `key` checked, or no longer: as Ctrl+click,
 * `X` and `Space` do. A range starts from it next. */
export function toggled(checks: Checks, key: string): Checks {
  const selected = new Set(checks.selected)
  if (!selected.delete(key)) selected.add(key)
  return selected.size === 0
    ? NO_CHECKS
    : { selected, anchor: key, base: selected }
}

/**
 * `checks` with the range from its anchor to `to` checked, among the
 * drawn `stops`, the cards alone: as Shift+click and Shift+↑↓ do. With
 * no anchor drawn, the range starts at `from`, the pick it moved from,
 * else at `to`. What was checked before the range stays.
 */
export function ranged(
  checks: Checks,
  stops: readonly Stop[],
  to: string,
  from?: string
): Checks {
  const keys = stops.map((stop) => stop.key)
  const anchor = [checks.anchor, from, to].find(
    (key) => key !== undefined && keys.includes(key)
  )
  const at = keys.indexOf(to)
  if (anchor === undefined || at === -1) return checks
  const start = keys.indexOf(anchor)
  const span = stops
    .slice(Math.min(start, at), Math.max(start, at) + 1)
    .filter((stop) => stop.card)
    .map((stop) => stop.key)
  const selected = new Set([...checks.base, ...span])
  return selected.size === 0 ? NO_CHECKS : { ...checks, selected, anchor }
}

/** Every card the `stops` draw checked, as `Ctrl+A` does: a folded group
 * and "+ N more" are stops but no cards, and what they hide is not drawn,
 * so it stays out. */
export function allChecked(stops: readonly Stop[]): Checks {
  return checksOf(stops.filter((stop) => stop.card).map((stop) => stop.key))
}

/** `checks` with only what `stops` still draw as cards: a card that left
 * the tab leaves the selection. The same `checks` where none left. */
export function stillDrawn(checks: Checks, stops: readonly Stop[]): Checks {
  const cards = new Set(stops.filter((stop) => stop.card).map((s) => s.key))
  if ([...checks.selected].every((key) => cards.has(key))) return checks
  const selected = new Set([...checks.selected].filter((k) => cards.has(k)))
  if (selected.size === 0) return NO_CHECKS
  return {
    selected,
    ...(checks.anchor !== undefined && cards.has(checks.anchor)
      ? { anchor: checks.anchor }
      : {}),
    base: new Set([...checks.base].filter((key) => cards.has(key))),
  }
}
