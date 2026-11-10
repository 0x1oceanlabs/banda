/**
 * How the sidebar list moves (ADR 0098, decision 6; ADR 0088, decisions
 * 2, 3 and 7): one flat list, keyed, with the parts' heads and the groups'
 * headers as items in it, so a card that changes part keeps its node and
 * its Mark, and its change plays as news. What changes lands in one
 * commit; `plan` works out what it does from the list drawn and the list
 * to draw, by arithmetic, and `useListMotion` plays it in the commit with
 * `element.animate`, by opacity alone and with no frame loop of its own:
 *
 * - a card or block that goes fades out where it was, then its slot
 *   closes, and the rows below snap up;
 * - one that comes fades in, a little after when something goes too;
 * - one that changes part or form fades in where it is now: its node is
 *   kept, so the leave at its old place is that slot closing;
 * - a ghost line crossfades over the card it stands for, by CSS, and its
 *   slot closes with no motion;
 * - the rows that shift snap.
 *
 * Only rows in view, and one each side, move; past 24 moves the whole
 * batch snaps, as it does while the list is hidden, searched, motionless
 * (`[motion] off`, reduced motion) or drawn afresh (a tab, a fold, a cut
 * list shown whole).
 */
import { type RefObject, useLayoutEffect, useRef } from "react"
import type { Stand } from "@banda/ui/status"
import type { Block, Entry } from "./inbox"
import { itemKey, type Went } from "./hold"
import type { Region } from "./regions"

/** A block that is not cards. */
export type Piece = Exclude<Block, { kind: "rows" }>

/** One item of the list, in its region, as it measures: a card of so
 * many lines, a ghost line or a dimmed card among them, or a block. */
export type Item = {
  key: string
  /** Its region's key: a gap parts one region from the next. */
  region: string
  /** What it is called, as its region is. */
  place?: string
  /** Which of the measured heights it takes. */
  measure: string
} & (
  | {
      kind: "card"
      /** The part it is drawn in, and that part's place. */
      block: string
      stand: Stand
      entry: Entry
      lines: number
      /** It went by the Person's pointer, and stands as a ghost line. */
      ghost?: Went
      /** It went otherwise, and stands dimmed. */
      went?: Went
    }
  | { kind: "piece"; piece: Piece }
)

/** The height of each kind of item, in px, by its `measure`, as the list
 * measured them; the design's own before it does. */
export type Heights = ReadonlyMap<string, number>

/** The design's heights (§2.5), until the list measures its own. */
export const HEIGHTS: Readonly<Record<string, number>> = {
  "card:1": 28,
  "card:2": 50,
  "card:3": 68,
  head: 30,
  group: 28,
  divider: 13,
  more: 24,
  zero: 64,
  empty: 120,
}

/** Between two cards of one part, and between two regions, in px. */
export const ROW_GAP = 1
export const REGION_GAP = 4

/** The motion's timings, in ms, as the design's tokens in `globals.css`
 * name them: `--dur-fast`, `--dur` and `--dur-slow`; what comes waits the
 * gap after what goes, and inbox zero's words wait a little more. */
export const DUR_FAST = 120
export const DUR = 200
export const DUR_SLOW = 320
export const AFTER_LEAVES = 60
export const ZERO_WAIT = 100
/** `--ease` and `--ease-exit`. */
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)"
export const EASE_EXIT = "cubic-bezier(0.3, 0, 1, 1)"

/** How many moves one batch may play; past it, the whole batch snaps. */
export const MOST = 24

/**
 * The items of `regions`, top down: each region's group header, then its
 * blocks, each part's cards one by one, each card of `lines(place)`
 * lines, by the place it is drawn in; a ghost or a dimmed card where
 * `ghosts` or `leaving` name it.
 */
export function itemsOf(
  regions: readonly Region[],
  lines: (place: Stand) => number,
  {
    ghosts,
    leaving,
  }: {
    ghosts?: ReadonlyMap<string, Went>
    leaving?: ReadonlyMap<string, Went>
  } = {}
): Item[] {
  return regions.flatMap((region) => {
    const place = region.label === undefined ? {} : { place: region.label }
    const blocks = region.group
      ? [region.group, ...region.blocks]
      : region.blocks
    return blocks.flatMap((block): Item[] => {
      if (block.kind !== "rows")
        return [
          {
            kind: "piece",
            key: block.key,
            region: region.key,
            ...place,
            measure: measureOf(block),
            piece: block,
          },
        ]
      return block.rows.map((entry): Item => {
        const key = itemKey(entry.row)
        const ghost = ghosts?.get(key)
        const went = leaving?.get(key)
        const count = lines(block.stand)
        return {
          kind: "card",
          key,
          region: region.key,
          ...place,
          measure: `card:${count}`,
          block: block.key,
          stand: block.stand,
          entry,
          lines: count,
          ...(ghost ? { ghost } : {}),
          ...(went ? { went } : {}),
        }
      })
    })
  })
}

/** Which height a block takes: inbox zero's, by whether it tells of
 * Someday; an empty tab's, by its tab; else its kind's. */
function measureOf(block: Piece): string {
  if (block.kind === "zero")
    return block.someday === undefined ? "zero" : "zero:someday"
  return block.kind === "empty" ? `empty:${block.tab}` : block.kind
}

/** What parts `item` from the one above it, in px. */
export function gapAbove(above: Item | undefined, item: Item): number {
  if (!above) return 0
  if (above.region !== item.region) return REGION_GAP
  return above.kind === "card" &&
    item.kind === "card" &&
    above.block === item.block
    ? ROW_GAP
    : 0
}

/** How tall `item` is drawn. */
export function heightOf(item: Item, heights: Heights): number {
  const measured = heights.get(item.measure) ?? HEIGHTS[item.measure]
  if (measured !== undefined) return measured
  // A layout of more lines than the design's adds a small line each.
  if (item.kind === "card") return HEIGHTS["card:3"] + 18 * (item.lines - 3)
  return HEIGHTS[item.piece.kind] ?? HEIGHTS.head
}

/** Where an item stands in the list, from its top, in px. */
export type Place = { top: number; height: number }

/** Where each of `items` stands, by arithmetic: no layout is read. */
export function placesOf(items: readonly Item[], heights: Heights): Place[] {
  let top = 0
  return items.map((item, i) => {
    top += gapAbove(items[i - 1], item)
    const height = heightOf(item, heights)
    const place = { top, height }
    top += height
    return place
  })
}

/** How tall `items` stand, all told. */
export function heightOfAll(items: readonly Item[], heights: Heights): number {
  const places = placesOf(items, heights)
  const last = places.at(-1)
  return last ? last.top + last.height : 0
}

/** The part of the list in view, from its top, in px. */
export type View = { top: number; height: number }

/** A row that shifts, from one top to another. */
export type Shift = { key: string; from: number; to: number }

/** What a batch does. */
export type Plan = {
  /** What goes, and fades out where it was. */
  leaves: string[]
  /** What comes, and fades in. */
  arrivals: string[]
  /** What changes part or form: it fades in where it is now. */
  crossfades: string[]
  /** What shifts, and snaps. */
  shifts: Shift[]
  /** Too much moves: the whole batch snaps. */
  snap: boolean
}

/** The keys of `items` in `view`, and one each side; all with no view. */
function inView(
  items: readonly Item[],
  places: readonly Place[],
  view: View | undefined
): Set<string> {
  if (!view) return new Set(items.map((item) => item.key))
  const shown = places.flatMap(({ top, height }, i) =>
    top + height > view.top && top < view.top + view.height ? [i] : []
  )
  if (shown.length === 0) return new Set()
  const first = Math.max(0, shown[0]! - 1)
  const last = Math.min(items.length - 1, shown.at(-1)! + 1)
  return new Set(items.slice(first, last + 1).map((item) => item.key))
}

/** Whether `item` stands in another part or form than `was`. */
function changed(was: Item, item: Item): boolean {
  if (was.measure !== item.measure) return true
  return was.kind === "card" && item.kind === "card" && was.block !== item.block
}

/**
 * What the list does as `next` follows `drawn`, by `heights`, moving only
 * what stands in `view`: what goes from `drawn`, but a ghost line, whose
 * slot closes still; what comes; what changes; and what shifts.
 */
export function plan(
  drawn: readonly Item[],
  next: readonly Item[],
  { heights, view }: { heights: Heights; view?: View }
): Plan {
  const was = new Map(drawn.map((item) => [item.key, item]))
  const now = new Map(next.map((item) => [item.key, item]))
  const before = placesOf(drawn, heights)
  const after = placesOf(next, heights)
  const seenBefore = inView(drawn, before, view)
  const seenAfter = inView(next, after, view)
  const leaves = drawn
    .filter((item) => !now.has(item.key) && seenBefore.has(item.key))
    .filter((item) => item.kind !== "card" || !item.ghost)
    .map((item) => item.key)
  const arrivals = next
    .filter((item) => !was.has(item.key) && seenAfter.has(item.key))
    .map((item) => item.key)
  const crossfades = next
    .filter((item) => {
      const old = was.get(item.key)
      return !!old && changed(old, item) && seenAfter.has(item.key)
    })
    .map((item) => item.key)
  const tops = new Map(drawn.map((item, i) => [item.key, before[i]!.top]))
  const shifts = next.flatMap((item, i): Shift[] => {
    const from = tops.get(item.key)
    const to = after[i]!.top
    return from === undefined || from === to || crossfades.includes(item.key)
      ? []
      : [{ key: item.key, from, to }]
  })
  const moves = leaves.length + arrivals.length + crossfades.length
  return { leaves, arrivals, crossfades, shifts, snap: moves > MOST }
}

/** Whether the window moves nothing: `[motion] off`, or the system asks
 * for reduced motion. */
function motionless(): boolean {
  return (
    document.documentElement.hasAttribute("data-still") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/** The scroller the list is in. */
const scrollerOf = (list: HTMLElement) =>
  list.closest<HTMLElement>("[data-slot=scroll-area-viewport]")

/** The part of `list` its scroller shows: one read, made in the commit
 * that moves, never in a frame. */
function viewOf(list: HTMLElement): View | undefined {
  const scroller = scrollerOf(list)
  if (!scroller) return undefined
  const port = scroller.getBoundingClientRect()
  return {
    top: port.top - list.getBoundingClientRect().top,
    height: port.height,
  }
}

/** The list's items as drawn, by key: not those on their way out. */
function drawnIn(list: HTMLElement): Map<string, HTMLElement> {
  const drawn = new Map<string, HTMLElement>()
  for (const child of list.children)
    if (
      child instanceof HTMLElement &&
      child.dataset.key &&
      child.dataset.going === undefined
    )
      drawn.set(child.dataset.key, child)
  return drawn
}

/**
 * Plays each batch of the list drawn in `list` from `items`: as `plan`
 * says, by the heights the list measures once while `measure` stays the
 * same (the look, its font, the cards' density); nothing as `scene` changes, which draws
 * the list afresh, nor while it is `searching`. What goes is the node
 * React let go of, put back where it was, inert and hidden from a screen
 * reader, for as long as it fades. A new batch takes those out at once.
 * The list says the height its items add up to (`data-height`), for the
 * motion test to hold the arithmetic to what is drawn.
 */
export function useListMotion(
  list: RefObject<HTMLElement | null>,
  items: readonly Item[],
  {
    scene,
    measure,
    searching = false,
  }: { scene: unknown; measure: readonly unknown[]; searching?: boolean }
): void {
  const heights = useRef(new Map<string, number>())
  const measured = useRef<readonly unknown[]>([])
  const was = useRef<{ items: readonly Item[]; scene: unknown }>(undefined)
  const elements = useRef(new Map<string, HTMLElement>())
  const going = useRef(new Map<HTMLElement, Animation>())
  useLayoutEffect(() => {
    const root = list.current
    if (!root) return
    const before = was.current
    const gone = elements.current
    was.current = { items, scene }
    elements.current = drawnIn(root)
    // Each kind of item is measured the first time it is drawn, and again
    // only as the look changes: one read each, and none in a frame; to the
    // fraction of a px, as a screen of 1.6 draws them, so the sums are the
    // list's as drawn.
    const same =
      measured.current.length === measure.length &&
      measure.every((one, i) => Object.is(one, measured.current[i]))
    if (!same) {
      measured.current = measure
      heights.current = new Map()
    }
    for (const item of items) {
      const element = elements.current.get(item.key)
      if (element && !heights.current.has(item.measure))
        heights.current.set(
          item.measure,
          element.getBoundingClientRect().height
        )
    }
    const height = String(heightOfAll(items, heights.current))
    if (root.getAttribute("data-height") !== height)
      root.setAttribute("data-height", height)
    if (!before) return
    // Planned for the whole list first: what only says something new
    // moves nothing, and lets what goes finish its fade.
    const all = plan(before.items, items, { heights: heights.current })
    const scened = before.scene !== scene
    const moving = all.leaves.length + all.arrivals.length > 0
    if (!scened && !moving && all.crossfades.length === 0) return
    for (const [element, fading] of going.current) {
      fading.cancel()
      element.remove()
    }
    going.current.clear()
    if (scened || searching || document.hidden || motionless()) return
    const moves = plan(before.items, items, {
      heights: heights.current,
      view: viewOf(root),
    })
    if (!moves.snap) play(root, moves, before.items, items, gone, going.current)
  })
}

/** Plays `moves` in `root`, from `drawn` to `items`: the nodes of what
 * goes are among `gone`, and each one fading out is kept in `going`. */
function play(
  root: HTMLElement,
  moves: Plan,
  drawn: readonly Item[],
  items: readonly Item[],
  gone: ReadonlyMap<string, HTMLElement>,
  going: Map<HTMLElement, Animation>
) {
  const now = drawnIn(root)
  const leaving = new Set(moves.leaves)
  for (const [i, item] of drawn.entries()) {
    const element = gone.get(item.key)
    if (!leaving.has(item.key) || !element || element.isConnected) continue
    // Back where it was: before the first item below it that stays.
    const below = drawn
      .slice(i + 1)
      .map((one) => now.get(one.key))
      .find((one) => one !== undefined)
    element.inert = true
    element.dataset.going = ""
    element.setAttribute("aria-hidden", "true")
    root.insertBefore(element, below ?? null)
    // A card that left while the list held fades from its dim, which is
    // its own, inside.
    const fading = element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: DUR_FAST,
      easing: EASE_EXIT,
      fill: "forwards",
    })
    going.set(element, fading)
    fading.onfinish = () => {
      going.delete(element)
      element.remove()
    }
  }
  const wait = moves.leaves.length > 0 ? AFTER_LEAVES : 0
  const coming = new Map(items.map((item) => [item.key, item]))
  for (const key of [...moves.arrivals, ...moves.crossfades]) {
    const element = now.get(key)
    const item = coming.get(key)
    if (!element || !item) continue
    // Inbox zero's words come slowly, a little after the rest.
    const zero = item.kind === "piece" && item.piece.kind === "zero"
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: zero ? DUR_SLOW : DUR,
      delay: zero ? wait + ZERO_WAIT : wait,
      easing: EASE,
      fill: "backwards",
    })
  }
}
