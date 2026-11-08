/**
 * The Tiling configures its Tiles (ADR 0088, decision 4): it works out
 * which show and which move, and gives each Tile its state, which its Pane
 * reads (`@banda/ui/lib/tile`). A Pane draws nothing while its Tile is
 * hidden, so a terminal printing off screen costs only its parsing.
 *
 * A Tile of a Strip shows while its workspace is on screen and the Tile is
 * in its Strip's clip, either:
 *
 * - where it is now, as an `IntersectionObserver` per Strip sees it after
 *   each frame: that corrects a hand's scroll, and what else slides or
 *   opens; or
 * - where a move under way takes it, worked out from where the columns end
 *   up as the move starts (`aimed`, `stacked`), and on each tick from what
 *   is left of the way, within `MARGIN` past it. So a Tile a key brings
 *   into view shows in that key's own task, and draws before it slides in;
 *   a Tile the move leaves behind goes hidden as the move passes it, and
 *   one the move only came near, once it lands.
 *
 * Every Tile shows in the overview; a Tile behind a Deck's tab, or under a
 * Pane zoomed over the window, does not. A Tile moves while its Strip
 * scrolls, its columns move or the workspaces slide.
 *
 * The margin is no sight: a Tile only within it is not on screen (ADR
 * 0087, decision 9; `calls/sight.ts`). Nothing here reads the page in a
 * tick of the clock: what it reads, it reads as a move starts, or once a
 * frame is drawn.
 */
import { followMoves } from "@banda/ui/lib/frames"
import { boxOf, type TileState } from "@banda/ui/lib/tile"
import type { Moving } from "../motion"
import {
  type ColumnMotion,
  type Place,
  places,
  room,
  scrolled,
  scrollOf,
} from "./layout"
import type { Ends, Width } from "./model"

/** How far past where a move takes its Strip's clip a Tile shows while
 * the move lasts, as a share of the Strip's width on each side. */
const MARGIN = 0.25

/** One Tile as its Strip drew it. */
export type Drawn = {
  /** Its box (`section[data-tile]`). */
  element: HTMLElement
  /** The column it is in. */
  column: string
  /** Behind a Deck's tab, or under a Pane zoomed over the window. */
  covered: boolean
  /** Zoomed over the window: it shows wherever its column is. */
  over: boolean
}

/** What a Strip drew, for its Tiles' states. */
export type Strip = {
  workspace: string
  columns: readonly { id: string; width: Width; min: number; ends?: Ends }[]
  tiles: readonly Drawn[]
  motion: ColumnMotion
}

/** The workspaces one under another, as `Workspaces` draws them. */
export type Stack = {
  /** The workspaces' ids, top to bottom. */
  order: readonly string[]
  /** Where the stack stands, in workspaces, and where it is headed. */
  place: Moving
  /** The overview shows every workspace whole. */
  overview: boolean
}

/** A Strip's Tiles as this keeps them. */
type Kept = {
  strip: HTMLElement
  drawn: Strip
  observer: IntersectionObserver
  /** The Tiles its observer sees in its clip, after the last frame. */
  seen: Set<Element>
  /** The Tiles it observes. */
  observed: Set<Element>
  /** Where each column ends up, read as the Strip was last measured. */
  places: Map<string, Place>
  /** How wide its clip is, and the margin past it while it moves. */
  view: { width: number; margin: number }
  /** Where its scroll is, and where it is headed. */
  scroll: { at: number; to: number }
  /** It moved as its Tiles were last configured. */
  moving: boolean
}

const strips = new Map<HTMLElement, Kept>()
let stack: Stack | undefined

/**
 * In each tick something moves in, after the moves: the Tiles a move
 * leaves behind go hidden, and once it lands, those it moved are shown.
 * What it reads it read as the move started; of a scroll on its way, it
 * takes where the spring has it.
 */
followMoves(() => {
  const slides = stack?.place.moving ?? false
  for (const kept of strips.values()) {
    const scroll = scrollOf(kept.strip)
    if (!(scroll.moving || slides || kept.drawn.motion.moving || kept.moving))
      continue
    // On its way, or landed where it was headed. A hand that stopped it
    // put it elsewhere, which the observer reads after the frame.
    const to = scroll.moving ? scroll.target : kept.scroll.to
    kept.scroll = { at: scroll.moving ? scroll.value : to, to }
    configure(kept)
  }
})

/**
 * The Strip `strip` was drawn: what it shows, read now, and each of its
 * Tiles' state. Its layout effect calls it, after it scrolled where its
 * focus goes.
 */
export function drawnStrip(strip: HTMLElement, drawn: Strip): void {
  const kept = strips.get(strip) ?? keep(strip, drawn)
  kept.drawn = drawn
  const now = new Set<Element>(drawn.tiles.map((tile) => tile.element))
  for (const element of kept.observed) {
    if (now.has(element)) continue
    kept.observer.unobserve(element)
    kept.observed.delete(element)
    kept.seen.delete(element)
  }
  for (const element of now) {
    if (kept.observed.has(element)) continue
    kept.observer.observe(element)
    kept.observed.add(element)
  }
  measure(strip, kept)
  configure(kept)
}

/** The Strip `strip` is no longer drawn. */
export function leftStrip(strip: HTMLElement): void {
  strips.get(strip)?.observer.disconnect()
  strips.delete(strip)
}

/** The Strip `strip` was sent to scroll elsewhere, or its room changed:
 * the Tiles where it is headed show from now. */
export function aimed(strip: HTMLElement): void {
  const kept = strips.get(strip)
  if (!kept) return
  measure(strip, kept)
  configure(kept)
}

/** The workspaces stand as `now` says, as they start a move or the
 * overview opens or closes; none once they are not drawn. Out of the
 * overview, each Strip clips and scrolls again, and is read again. */
export function stacked(now: Stack | undefined): void {
  const closed = stack?.overview === true && now?.overview !== true
  stack = now
  for (const kept of strips.values()) {
    if (closed) measure(kept.strip, kept)
    configure(kept)
  }
}

function keep(strip: HTMLElement, drawn: Strip): Kept {
  const kept: Kept = {
    strip,
    drawn,
    observer: new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          if (!kept.observed.has(target)) continue
          if (isIntersecting) kept.seen.add(target)
          else kept.seen.delete(target)
        }
        // After a frame: the page is laid out, and nothing moves in it.
        measure(strip, kept)
        configure(kept)
      },
      { root: strip }
    ),
    seen: new Set(),
    observed: new Set(),
    places: new Map(),
    view: { width: 0, margin: 0 },
    scroll: { at: 0, to: 0 },
    moving: false,
  }
  strips.set(strip, kept)
  return kept
}

/** Reads where `strip`'s columns end up and where its scroll is: never in
 * a tick, which writes. */
function measure(strip: HTMLElement, kept: Kept): void {
  const space = room(strip)
  const width = strip.clientWidth
  kept.view = { width, margin: MARGIN * width }
  kept.places = new Map(
    places(strip, kept.drawn.columns, space).map((place) => [place.id, place])
  )
  const scroll = scrollOf(strip)
  const at = scroll.moving ? scroll.value : scrolled(strip)
  kept.scroll = { at, to: scroll.target }
}

/** Whether workspace `id` is on screen, or passes over it as the
 * workspaces slide. */
function onScreen(id: string): boolean {
  if (!stack || stack.overview) return true
  const at = stack.order.indexOf(id)
  const { value, target } = stack.place
  return at > Math.min(value, target) - 1 && at < Math.max(value, target) + 1
}

/** Gives each Tile of a Strip its state, from what was last read and
 * from what moves now. */
function configure(kept: Kept): void {
  const { strip, drawn, places, seen } = kept
  const moving =
    scrollOf(strip).moving ||
    drawn.motion.moving ||
    (stack?.place.moving ?? false)
  kept.moving = moving
  const shown = onScreen(drawn.workspace)
  // The clip from where the scroll is to where it is headed, and while it
  // moves, the margin past it.
  const { width, margin } = kept.view
  const past = moving ? margin : 0
  const from = Math.min(kept.scroll.at, kept.scroll.to) - past
  const to = Math.max(kept.scroll.at, kept.scroll.to) + width + past
  const overview = stack?.overview ?? false
  for (const tile of drawn.tiles) {
    const place = places.get(tile.column)
    const inView =
      overview ||
      tile.over ||
      seen.has(tile.element) ||
      (place !== undefined && place.right > from && place.left < to)
    const state: TileState =
      !shown || tile.covered || !inView ? "hidden" : moving ? "moving" : "shown"
    boxOf(tile.element)?.configure(state)
  }
}
