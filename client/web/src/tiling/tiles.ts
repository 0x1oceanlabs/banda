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
 *   each frame: that corrects what else slides or opens; or
 * - where a move under way takes it, worked out from where the columns end
 *   up as the move starts (`drawnStrip`, `aimed`, `stacked`), within
 *   `MARGIN` past it. So a Tile a key brings into view shows in that key's
 *   own task, and draws before it slides in; on each tick, a Tile the move
 *   leaves behind goes hidden as the move passes it, and one the move only
 *   came near, once it lands.
 *
 * A Strip scrolled where the Tiling did not send it, by a hand (a swipe, a
 * drag, a nudge) or by the page, moves too: from its first scroll, before
 * the frame that shows it, the Tiles within the margin of where it is
 * show, so the next steps find them drawn; and so while a hand sizes its
 * columns.
 *
 * Every Tile shows in the overview; a Tile behind a Deck's tab, or under a
 * Pane zoomed over the window, does not. A Tile moves while its Strip
 * scrolls, its columns move or the workspaces slide.
 *
 * The margin is no sight: a Tile only within it is not on screen (ADR
 * 0087, decision 9; `calls/sight.ts`). Nothing here reads the page in a
 * tick of the clock, nor shows a Tile there, whose Pane would read it
 * then: what it reads, it reads as a move starts, as the Strip scrolls,
 * or once a frame is drawn.
 */
import { followMoves } from "@banda/ui/lib/frames"
import { boxOf, type TileBox, type TileState } from "@banda/ui/lib/tile"
import type { Moving } from "../motion"
import {
  type ColumnMotion,
  type Place,
  places,
  scrolled,
  scrollOf,
} from "./layout"
import type { Ends, Width } from "./model"

/** How far past where a move takes its Strip's clip a Tile shows while
 * the move lasts, as a share of the Strip's width on each side. */
const MARGIN = 0.25

/** How long, in ms, a Strip scrolled where the Tiling did not send it
 * waits for its next scroll before it is at rest, unless something lands
 * it first, as a swipe's end does. */
const AT_REST = 200

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
  /** Its Tiles, each with the box the Tiling holds it in. */
  tiles: readonly (Drawn & { box: TileBox | undefined })[]
  observer: IntersectionObserver
  /** The Tiles its observer sees in its clip, after the last frame. */
  seen: Set<Element>
  /** The Tiles it observes. */
  observed: Set<Element>
  /** Its columns, as it was last measured: their places follow them. */
  layout: string
  /** Where each column ends up, read as the Strip was last measured. */
  places: Map<string, Place>
  /** How wide its clip is. */
  width: number
  /** Where its scroll is, and where it is headed. */
  scroll: { at: number; to: number }
  /** It scrolled where the Tiling did not send it, and is not at rest. */
  loose: boolean
  resting: ReturnType<typeof setTimeout> | undefined
  /** It moved as its Tiles were last configured. */
  moving: boolean
  /** Stops hearing its scroll. */
  deaf: () => void
}

const strips = new Map<HTMLElement, Kept>()
let stack: Stack | undefined

/**
 * In each tick something moves in, after the moves: the Tiles a move
 * leaves behind go hidden, and once it lands, those it moved settle. What
 * it reads it read as the move started; of a scroll on its way, it takes
 * where the spring has it.
 */
followMoves(() => {
  const slides = stack?.place.moving ?? false
  for (const kept of strips.values()) {
    const scroll = scrollOf(kept.strip)
    if (!(scroll.moving || slides || kept.drawn.motion.moving || kept.moving))
      continue
    // On its way, or landed where it was headed. A hand that stopped it
    // put it elsewhere, which its scroll tells.
    const to = scroll.moving ? scroll.target : kept.scroll.to
    kept.scroll = { at: scroll.moving ? scroll.value : to, to }
    configure(kept, false)
  }
})

/**
 * The Strip `strip` was drawn: each of its Tiles' state, from what it
 * shows and where it is headed. Its layout effect calls it, after it
 * scrolled where its focus goes. It reads the page only for a new Strip,
 * or columns that changed.
 */
export function drawnStrip(strip: HTMLElement, drawn: Strip): void {
  const known = strips.get(strip)
  const kept = known ?? keep(strip, drawn)
  kept.drawn = drawn
  // Its PaneFrames' layout effects, which hold their Tiles, ran.
  kept.tiles = drawn.tiles.map((tile) => ({
    ...tile,
    box: boxOf(tile.element),
  }))
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
  if (!known || layoutOf(drawn) !== kept.layout) measure(kept)
  else {
    // Where its focus sent it in this drawing; one that jumped there
    // tells by its scroll.
    const scroll = scrollOf(strip)
    if (scroll.moving) kept.scroll = { at: scroll.value, to: scroll.target }
  }
  configure(kept, true)
}

/** The Strip `strip` is no longer drawn. */
export function leftStrip(strip: HTMLElement): void {
  const kept = strips.get(strip)
  if (!kept) return
  kept.observer.disconnect()
  kept.deaf()
  clearTimeout(kept.resting)
  strips.delete(strip)
}

/** The Strip `strip` was sent to scroll elsewhere, its room changed, or a
 * hand takes its columns' widths or lets them go: from now, the Tiles
 * where it is headed show. Outside React's drawing, which `drawnStrip`
 * reads. */
export function aimed(strip: HTMLElement): void {
  const kept = strips.get(strip)
  if (!kept) return
  kept.loose = false
  clearTimeout(kept.resting)
  measure(kept)
  configure(kept, true)
}

/** The workspaces stand as `now` says, as they start a move or the
 * overview opens or closes. Out of the overview, each Strip clips and
 * scrolls again, and is read again. None once they are no longer drawn:
 * their Tiles go with them, as they were. */
export function stacked(now: Stack | undefined): void {
  const closed = stack?.overview === true && now?.overview !== true
  stack = now
  if (!now) return
  for (const kept of strips.values()) {
    if (closed) measure(kept)
    configure(kept, true)
  }
}

function keep(strip: HTMLElement, drawn: Strip): Kept {
  // A scroll the Tiling did not make, in its own task: a hand's, before
  // the frame that shows it, or the page's.
  const scrolls = () => {
    if (scrollOf(strip).moving || stack?.overview) return
    const at = scrolled(strip)
    // Where the last step of its spring put it.
    if (!kept.loose && Math.abs(at - kept.scroll.at) < 1) return
    kept.loose = true
    kept.scroll = { at, to: at }
    configure(kept, true)
    clearTimeout(kept.resting)
    kept.resting = setTimeout(() => aimed(strip), AT_REST)
  }
  strip.addEventListener("scroll", scrolls, { passive: true })
  const kept: Kept = {
    strip,
    drawn,
    tiles: [],
    observer: new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          if (!kept.observed.has(target)) continue
          if (isIntersecting) kept.seen.add(target)
          else kept.seen.delete(target)
        }
        // After a frame: the page is laid out, and nothing moves in it.
        measure(kept)
        configure(kept, true)
      },
      // A Tile that only touches the clip's edge shows nothing of itself,
      // as the column beside a Strip scrolled by the least does.
      { root: strip, rootMargin: "0px -1px" }
    ),
    seen: new Set(),
    observed: new Set(),
    layout: "",
    places: new Map(),
    width: 0,
    scroll: { at: 0, to: 0 },
    loose: false,
    resting: undefined,
    moving: false,
    deaf: () => strip.removeEventListener("scroll", scrolls),
  }
  strips.set(strip, kept)
  return kept
}

/** A Strip's columns, which their places follow. */
function layoutOf({ columns }: Strip): string {
  return columns
    .map(({ id, width, min, ends }) =>
      [id, width, min, ends?.first, ends?.last].join(" ")
    )
    .join()
}

/** Reads where a Strip's columns end up and where its scroll is: never in
 * a tick, which writes. */
function measure(kept: Kept): void {
  const { strip, drawn } = kept
  kept.layout = layoutOf(drawn)
  kept.width = strip.clientWidth
  kept.places = new Map(
    places(strip, drawn.columns).map((place) => [place.id, place])
  )
  const scroll = scrollOf(strip)
  const at = scroll.moving ? scroll.value : scrolled(strip)
  kept.scroll = { at, to: scroll.moving ? scroll.target : at }
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
 * from what moves now. In a tick (`rise` false), a hidden Tile stays
 * hidden: shown, its Pane would read the page there, as a terminal fits;
 * one a spring overshoots to waits for its frame's observer. */
function configure(kept: Kept, rise: boolean): void {
  const { strip, drawn, places, seen, width } = kept
  const moving =
    kept.loose ||
    scrollOf(strip).moving ||
    drawn.motion.moving ||
    (stack?.place.moving ?? false)
  kept.moving = moving
  const shown = onScreen(drawn.workspace)
  // The clip from where the scroll is to where it is headed, and while it
  // moves, the margin past it.
  const past = moving ? MARGIN * width : 0
  const from = Math.min(kept.scroll.at, kept.scroll.to) - past
  const to = Math.max(kept.scroll.at, kept.scroll.to) + width + past
  const overview = stack?.overview ?? false
  for (const { element, column, covered, over, box } of kept.tiles) {
    if (!box) continue
    const place = places.get(column)
    const inView =
      overview ||
      over ||
      seen.has(element) ||
      (place !== undefined && place.right > from && place.left < to)
    const state: TileState =
      !shown || covered || !inView ? "hidden" : moving ? "moving" : "shown"
    if (!rise && state !== "hidden" && box.given === "hidden") continue
    box.configure(state)
  }
}
