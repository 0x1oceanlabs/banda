/**
 * Where a Strip's columns go, and how they get there (ADR 0007, decision
 * 9): a column that changes its width grows or shrinks on the look's
 * `resize`, and the columns a change puts elsewhere go there on its
 * `move`, as niri's do, instead of jumping.
 */
import type { Center, Columns as Look } from "@banda/contract/look"
import { columnsOf, moveOf } from "../look"
import { Moving } from "../motion"
import { minOf } from "../registry"
import {
  type Floor,
  displayOf,
  drawn,
  filledAt,
  free,
  groupEnds,
  heightsOf,
  share,
  type Width,
  widthIn,
  type Workspace,
} from "./model"

/** A Pane's column the Strip shows once, as asked: in the middle
 * (`Alt+C`), or, for a Thread picked, its Group's first column at the
 * left, beside the sidebar (ADR 0065, decision 8). A new object each
 * time it is asked. */
export type Reveal = { entry: string; how: "middle" | "left" }

/** A column's place once every move is done, in the Strip's scroll. */
export interface Place {
  id: string
  left: number
  right: number
}

/** The Strip's room, as CSS has it: what shows of it starts `pad` in from
 * its left, past the sidebar floating there, and is `inner` wide. */
export function room(strip: HTMLElement) {
  const style = getComputedStyle(strip)
  const pad = parseFloat(style.paddingLeft) || 0
  const gap = parseFloat(style.columnGap) || 0
  const inner = strip.clientWidth - pad - (parseFloat(style.paddingRight) || 0)
  return { pad, gap, inner, rem: remInPx() }
}

/** What the shares of a Strip are shares of. */
export type Space = { gap: number; inner: number; rem: number }

/**
 * The share of the room a column of `min` rem is never drawn narrower
 * than: the `min-width` the Strip gives it, as a share.
 */
export function floorIn(room: Space, min: number): number {
  return room.inner > 0
    ? (min * room.rem + room.gap) / (room.inner + room.gap)
    : 0
}

/** A rem, in pixels: the root's size, as `[font] size` sets it. */
export function remInPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize)
}

/** The Strip of workspace `id`, while it is drawn. */
export function stripOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-strip="${id}"]`)
}

/** What draws workspace `id` in the window's stack, round its Strip. */
export function stackOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-stack="${id}"]`)
}

/** The column `id` of `strip`, while it is drawn. */
export function columnIn(strip: HTMLElement, id: string): HTMLElement | null {
  return strip.querySelector<HTMLElement>(`:scope > [data-column="${id}"]`)
}

/** The share of `space` each column is never drawn narrower than. */
function floorsIn(space: Space, look: Look): Floor {
  return (column) => floorIn(space, minOf(column, look.min))
}

/** Each column's floor in the Strip of workspace `id`, while it is drawn. */
export function floorsOf(id: string, look: Look): Floor | undefined {
  const strip = stripOf(id)
  return strip ? floorsIn(room(strip), look) : undefined
}

/** The columns of `workspace` as the look sizes them: the width each is
 * drawn at, and the least, in rem; whether it fills the screen with its
 * Group, which shares out `space`, when known, so it fits. */
export function sized(
  workspace: Workspace,
  look: Look,
  space: Space | undefined
) {
  const floor = space && floorsIn(space, look)
  return workspace.columns.map((column, c) => ({
    ...column,
    width: widthIn(workspace, column, look, floor),
    min: minOf(column, look.min),
    ends: groupEnds(workspace, c),
    filled: filledAt(workspace, c),
  }))
}

/** The columns of `workspace` as a Strip draws them, by the look: their
 * widths, whether each is a Deck, and their Panes' heights. */
export function drawnColumns(
  workspace: Workspace,
  look: Look,
  space: Space | undefined
) {
  return sized(workspace, look, space).map((column) => ({
    ...column,
    decked: displayOf(column, look) === "deck",
    heights: heightsOf(column),
  }))
}

const scrolls = new WeakMap<HTMLElement, Moving>()
/** The scroll of each Strip the overview shows whole: it shows no scroll
 * then, and keeps this one for when it closes. */
const held = new WeakMap<HTMLElement, number>()

/** A Strip's scroll, moving on the look's spring. */
export function scrollOf(strip: HTMLElement): Moving {
  let scroll = scrolls.get(strip)
  if (!scroll) {
    scroll = new Moving(
      (left) => {
        if (held.has(strip)) held.set(strip, left)
        else strip.scrollLeft = left
      },
      () => scrolled(strip)
    )
    scrolls.set(strip, scroll)
  }
  return scroll
}

/** How far a Strip is scrolled: as it shows, or as it will once the
 * overview, which shows it whole, closes. */
export function scrolled(strip: HTMLElement): number {
  return held.get(strip) ?? strip.scrollLeft
}

/**
 * Keeps a Strip's scroll aside while the overview shows it whole, before
 * it stops clipping: its scroll goes on moving there, as a focus that
 * changes in the overview moves it. Called again, it keeps what it has.
 */
export function holdScroll(strip: HTMLElement): void {
  if (!held.has(strip)) held.set(strip, strip.scrollLeft)
}

/** Gives a Strip its scroll back once it clips again. */
export function releaseScroll(strip: HTMLElement): void {
  const left = held.get(strip)
  if (left === undefined) return
  held.delete(strip)
  strip.scrollLeft = left
}

/** The share of a column that shows between `from` and `to` of its
 * Strip's scroll, 0 to 1. */
export function shownShare(
  place: { left: number; right: number },
  view: { from: number; to: number }
): number {
  const shown = Math.min(place.right, view.to) - Math.max(place.left, view.from)
  return Math.max(0, shown) / (place.right - place.left)
}

/**
 * How much of each column of `workspace` shows inside its Strip's clip, 0
 * to 1, by its id (ADR 0087, decision 9): by where the columns end up and
 * where the scroll is headed, as `reveal` aims, so a move under way counts
 * as done. Read as it is asked, never in a move's frames. None while its
 * Strip is not drawn, or the overview shows it whole. The margin the Tile
 * states keep shown past the clip (ADR 0088) is not in it.
 */
export function shownOf(
  workspace: Workspace,
  look: Look = columnsOf()
): ReadonlyMap<string, number> | undefined {
  const strip = stripOf(workspace.id)
  if (!strip || held.has(strip)) return undefined
  const view = viewOf(strip)
  if (view.room.inner <= 0) return undefined
  return new Map(
    places(strip, sized(workspace, look, view.room), view.room).map((place) => [
      place.id,
      shownShare(place, view),
    ])
  )
}

/** What of `strip` shows once its scroll is where it is headed: from
 * `from` to `to` of the scroll, in its `room`. */
function viewOf(strip: HTMLElement) {
  const space = room(strip)
  const from = scrollOf(strip).target + space.pad
  return { room: space, from, to: from + space.inner }
}

/**
 * The width the focused column of `workspace` takes to fill the room the
 * columns wholly in view beside it leave, as niri's
 * expand-column-to-available-width: by where the columns and the scroll
 * are headed; none when its Strip is not drawn.
 */
export function roomLeft(
  workspace: Workspace,
  look: Look = columnsOf()
): Width | undefined {
  const strip = stripOf(workspace.id)
  const focused = workspace.columns[workspace.focus]
  if (!strip || !focused) return undefined
  const { room: space, from, to } = viewOf(strip)
  const { gap, inner } = space
  const taken = places(strip, sized(workspace, look, space), space)
    .filter(
      (place) =>
        place.id !== focused.id &&
        place.left >= from - 1 &&
        place.right <= to + 1
    )
    .reduce((sum, place) => sum + place.right - place.left + gap, 0)
  // The share whose width, as `widthAt` draws it, is what is left.
  const at = Math.min(1, (inner - taken + gap) / (inner + gap))
  return at > 0 ? free(at) : undefined
}

/**
 * Where the columns end up, from their widths, as CSS lays them out in
 * the Strip's room, read unless its caller has it: so a scroll aims at
 * where a column will be, not where a move has it now.
 */
export function places(
  strip: HTMLElement,
  columns: readonly { id: string; width: Width; min: number }[],
  space: ReturnType<typeof room> = room(strip)
): Place[] {
  const { pad, gap, inner } = space
  let left = pad
  return columns.map((column) => {
    const at = drawn(share(column.width) ?? 0.5, floorIn(space, column.min))
    const width = at * (inner + gap) - gap
    const place = { id: column.id, left, right: left + width }
    left += width + gap
    return place
  })
}

/** How a column comes into view: as the look's `center` says, `before`
 * the column focused before it; or with `left`, from `first`, its
 * Group's first column. */
export type Aim = { center: Center | "left"; before?: string; first?: string }

/**
 * Where the Strip's scroll goes, from `at`, to show the column `id` whole
 * in its room, `pad` in from its left and `inner` wide: by the least
 * scroll; to the middle; or to the middle only when it does not fit
 * beside `before`, else by the least scroll that shows both. With `left`,
 * `first`'s left edge goes to the room's left, as far as `id` stays
 * whole: a Group wider than the screen shows its focused column. Never
 * past the Strip's ends; none when `id` has no place.
 */
export function revealTo(
  all: readonly Place[],
  { pad, inner }: { pad: number; inner: number },
  at: number,
  id: string | undefined,
  { center, before, first = id }: Aim
): number | undefined {
  const column = all.find((place) => place.id === id)
  if (!column) return undefined
  const least = (left: number, right: number) =>
    left - pad < at
      ? left - pad
      : right - pad - inner > at
        ? right - pad - inner
        : at
  const middle = (column.left + column.right - inner) / 2 - pad
  let to = least(column.left, column.right)
  if (center === "always") to = middle
  if (center === "left") {
    const start = all.find((place) => place.id === first) ?? column
    to = Math.max(start.left, column.right - inner) - pad
  }
  const previous = all.find((place) => place.id === before)
  if (center === "on-overflow" && previous && previous !== column) {
    const left = Math.min(column.left, previous.left)
    const right = Math.max(column.right, previous.right)
    to = right - left <= inner ? least(left, right) : middle
  }
  const most = Math.max(0, (all.at(-1)?.right ?? 0) - pad - inner)
  return Math.max(0, Math.min(most, to))
}

/** A column's width at `at`, a share of the room, as the Strip draws it;
 * a Pane's height in its column too, the gaps coming out of it alike. */
export function widthAt(at: number): string {
  return `calc(${at} * (100% + var(--gap-inner)) - var(--gap-inner))`
}

/** A Pane's `flex` at `at`, a share of its column's height. */
export function heightAt(at: number): string {
  return `0 1 ${widthAt(at)}`
}

/** The least a column of `min` rem is drawn at: that, unless the room is
 * narrower. */
export function minWidthOf(min: number): string {
  return `min(100%, ${min}rem)`
}

type Moved = {
  element: HTMLElement
  /** Its share of the room, as drawn now. */
  size: Moving
  /** How far it is drawn from its place, sideways, in pixels. */
  slide: Moving
  /** Its place and size in the layout, as last seen. */
  left: number
  width: number
  /** Its share as the Strip last drew it. */
  drawn: number
}

type Tile = {
  element: HTMLElement
  column: string
  top: number
  height: number
}

type Columns = readonly {
  id: string
  width: Width
  entries: readonly { id: string }[]
}[]

/**
 * The columns and tiles of one Strip as they move: they grow, shrink and
 * go to new places, a tile that comes fades in, and one that goes fades
 * out where it was while the rest close in.
 */
export class ColumnMotion {
  #columns = new Map<string, Moved>()
  #tiles = new Map<string, Tile>()
  #started = false
  #scroll: number | undefined
  #inner: number | undefined
  /** The column a hand sizes: the Strip's width for it waits. */
  #held: string | undefined

  /** Notes how far the Strip is scrolled, just before React changes it. */
  before(strip: HTMLElement | null) {
    this.#scroll = strip?.scrollLeft
  }

  /**
   * After each drawing: a column whose width changed grows to it from the
   * width it had; one the layout put elsewhere is drawn where it was, and
   * goes to its place; a tile not seen before comes in, and one gone goes.
   * What is there the first time is simply there. `inner` is the room
   * the shares were worked out from, when they were.
   */
  sync(strip: HTMLElement | null, columns: Columns, inner?: number) {
    const first = !this.#started
    this.#started = true
    if (!strip) return
    // A share that changed with the room, not by a key, goes with the
    // room: as the widths CSS works out do.
    const roomMoved =
      inner !== undefined && this.#inner !== undefined && inner !== this.#inner
    this.#inner = inner
    // A Strip that got narrower than its scroll is scrolled back at once:
    // what stays goes from where it was on the screen, and what went
    // fades out there.
    const shifted = (this.#scroll ?? strip.scrollLeft) - strip.scrollLeft
    this.#scroll = undefined
    const found = columns.flatMap((column) => {
      const element = columnIn(strip, column.id)
      return element ? [{ column, element }] : []
    })
    const seen = new Set(found.map(({ column }) => column.id))
    // A column that went fades out where it was last seen: before one that
    // stays grows, and moves the rest.
    for (const [id, moved] of this.#columns) {
      if (seen.has(id)) continue
      moved.size.stop()
      moved.slide.stop()
      this.#columns.delete(id)
      const pad = parseFloat(getComputedStyle(strip).paddingTop) || 0
      go(moved.element, strip, {
        top: pad,
        height: strip.clientHeight - 2 * pad,
        left: moved.left + moved.slide.value - shifted,
        width: moved.width,
      })
    }
    for (const { column, element } of found) {
      const target = share(column.width) ?? 0.5
      const known = this.#columns.get(column.id)
      if (!known) {
        this.#columns.set(column.id, this.#start(element, target))
        continue
      }
      known.element = element
      known.drawn = target
      if (this.#held === column.id) continue
      if (Math.abs(known.size.target - target) > 1e-9) {
        known.size.to(target, roomMoved ? { kind: "off" } : moveOf("resize"))
      }
    }
    const tiles = new Map<string, Tile>()
    for (const column of columns) {
      for (const entry of column.entries) {
        const element = strip.querySelector<HTMLElement>(
          `[data-tile="${entry.id}"]`
        )
        if (!element) continue
        tiles.set(entry.id, { element, column: column.id, top: 0, height: 0 })
        if (!first && !this.#tiles.has(entry.id)) come(element)
      }
    }
    for (const [id, tile] of this.#tiles) {
      if (tiles.has(id)) continue
      // A tile of a column that went goes with its column.
      const column = this.#columns.get(tile.column)
      if (seen.has(tile.column) && column) {
        go(tile.element, column.element, {
          top: tile.top,
          height: tile.height,
          left: 0,
          width: column.width,
        })
      }
    }
    // The widths are as drawn now: what moved the rest is a column that
    // opened, closed or changed its place.
    for (const moved of this.#columns.values()) {
      const left = moved.element.offsetLeft
      const by = left - moved.left + shifted
      moved.left = left
      moved.width = moved.element.offsetWidth
      if (Math.abs(by) < 0.5 || roomMoved) continue
      moved.slide.to(0, moveOf("move"), moved.slide.value - by)
    }
    for (const tile of tiles.values()) {
      tile.top = tile.element.offsetTop
      tile.height = tile.element.offsetHeight
    }
    this.#tiles = tiles
  }

  /** A column grows, shrinks or slides to its place now, or a hand sizes
   * one. */
  get moving(): boolean {
    if (this.#held !== undefined) return true
    for (const moved of this.#columns.values())
      if (moved.size.moving || moved.slide.moving) return true
    return false
  }

  /** Column `id`'s share as drawn, or as it is headed. */
  shareOf(id: string): number | undefined {
    return this.#columns.get(id)?.size.target
  }

  /** A hand sizes column `id`: it is drawn at `at` at once, whatever the
   * Strip draws meanwhile. */
  hand(id: string, at: number) {
    this.#held = id
    this.#columns.get(id)?.size.to(at, { kind: "off" })
  }

  /** The hand let go, and what it asked is drawn or refused: the column
   * goes to the width the Strip draws, if it is not there. */
  letGo() {
    const moved = this.#held && this.#columns.get(this.#held)
    this.#held = undefined
    if (moved && Math.abs(moved.size.target - moved.drawn) > 1e-9) {
      moved.size.to(moved.drawn, moveOf("resize"))
    }
  }

  stop() {
    for (const moved of this.#columns.values()) {
      moved.size.stop()
      moved.slide.stop()
    }
  }

  #start(element: HTMLElement, at: number): Moved {
    let width = at
    let offset = 0
    const moved: Moved = {
      element,
      size: new Moving(
        (next) => {
          width = next
          moved.element.style.width = widthAt(next)
          // Its neighbours moved with it: that is where they are now.
          for (const other of this.#columns.values()) {
            other.left = other.element.offsetLeft
            other.width = other.element.offsetWidth
          }
        },
        () => width
      ),
      slide: new Moving(
        (next) => {
          offset = next
          moved.element.style.translate = next === 0 ? "" : `${next}px 0`
        },
        () => offset
      ),
      left: element.offsetLeft,
      width: element.offsetWidth,
      drawn: at,
    }
    return moved
  }
}

/** How big a tile is as it starts coming in, and as it is gone: niri's. */
const COMING = 0.5
const GONE = 0.8

/** Shows a tile coming in: from nothing, half its size, to itself. */
function come(element: HTMLElement) {
  let shown = 0
  new Moving(
    (at) => {
      shown = at
      const done = at >= 1
      element.style.opacity = done ? "" : String(at)
      element.style.scale = done ? "" : String(COMING + (1 - COMING) * at)
    },
    () => shown
  ).to(1, moveOf("open"), 0)
}

/**
 * Puts a still copy in place of each canvas `element` holds, as a
 * terminal's screen: the Pane lets go of its canvas a moment later, and
 * the copy is how it looked.
 */
function freeze(element: HTMLElement) {
  for (const canvas of element.querySelectorAll("canvas")) {
    if (canvas.width === 0 || canvas.height === 0) continue
    const still = canvas.cloneNode(false) as HTMLCanvasElement
    still.getContext("2d")?.drawImage(canvas, 0, 0)
    canvas.replaceWith(still)
  }
}

/**
 * Shows a tile or a column going, after the window let it go: the element
 * it was is put back where it was, over its old place, out of reach, and
 * fades out shrinking to the middle. It stays where it was on the screen
 * as the Strip scrolls under it. Whatever it held is gone already; this
 * is how it looked.
 */
function go(
  element: HTMLElement,
  into: HTMLElement,
  where: { top: number; height: number; left: number; width: number }
) {
  const move = moveOf("close")
  if (move.kind === "off") return
  const scrolled = into.scrollLeft
  freeze(element)
  element.inert = true
  element.setAttribute("aria-hidden", "true")
  element.removeAttribute("data-column")
  element.removeAttribute("data-tile")
  Object.assign(element.style, {
    position: "absolute",
    top: `${where.top}px`,
    left: `${where.left}px`,
    width: `${where.width}px`,
    height: `${where.height}px`,
    translate: "",
    pointerEvents: "none",
    zIndex: "1",
  })
  into.append(element)
  let shown = 1
  new Moving(
    (at) => {
      shown = at
      const by = into.scrollLeft - scrolled
      element.style.opacity = String(at)
      element.style.scale = String(GONE + (1 - GONE) * at)
      element.style.translate = `${by}px 0`
      if (at <= 0) element.remove()
    },
    () => shown
  ).to(0, move, 1)
}

/**
 * Where a swipe let go lands, as niri's view gesture does: going from
 * `from`, it would come to rest by itself at `rest`; it lands on the snap
 * nearest there. A snap is where a column's left or right edge meets the
 * room's, never past the first column's left or the last's right, and the
 * focus goes to the furthest column whole there, the way it went; with
 * `center = "always"`, where a column's middle meets the room's, and the
 * focus goes to that column. A Group that fills the screen shows whole
 * or not at all.
 */
export function landing(
  all: readonly Place[],
  columns: readonly {
    filled?: boolean
    ends?: { first: boolean; last: boolean }
  }[],
  { pad, inner }: { pad: number; inner: number },
  center: Center,
  { from, rest }: { from: number; rest: number }
): { at: number; id: string } | undefined {
  const head = all[0]
  const tail = all.at(-1)
  if (!head || !tail) return undefined
  const leftOf = (place: Place) => place.left - pad
  const rightOf = (place: Place) => place.right - pad - inner
  const first = leftOf(head)
  const last = Math.max(first, rightOf(tail))
  const clamp = (at: number) => Math.min(last, Math.max(first, at))
  // Each Group that fills the screen, from its first column's left to its
  // last's right.
  const groups: { left: number; right: number }[] = []
  all.forEach((place, c) => {
    const column = columns[c]
    if (!column?.filled) return
    if (column.ends?.first || !groups.length) groups.push({ ...place })
    else groups[groups.length - 1]!.right = place.right
  })
  const cuts = (at: number) =>
    groups.some(({ left, right }) => {
      const from = at + pad
      const to = from + inner
      const whole = left >= from - 0.5 && right <= to + 0.5
      return !whole && left < to && right > from
    })
  const centred = center === "always"
  const snaps: { at: number; c: number; off: number }[] = centred
    ? []
    : [
        { at: first, c: 0, off: 0 },
        { at: last, c: all.length - 1, off: 0 },
      ]
  all.forEach((place, c) => {
    const sides =
      centred && place.right - place.left < inner
        ? [(leftOf(place) + rightOf(place)) / 2]
        : [leftOf(place), rightOf(place)]
    for (const side of sides) {
      const at = clamp(side)
      if (centred || (at > first && at < last))
        snaps.push({ at, c, off: Math.abs(at - side) })
    }
  })
  const kept = snaps.filter((snap) => !cuts(snap.at))
  const snap = (kept.length ? kept : snaps).reduce((near, one) => {
    const by = Math.abs(one.at - rest) - Math.abs(near.at - rest)
    return by < 0 || (by === 0 && one.off < near.off) ? one : near
  })
  if (centred) return { at: snap.at, id: all[snap.c]!.id }
  const whole = (place: Place | undefined) =>
    place !== undefined &&
    place.left >= snap.at + pad - 0.5 &&
    place.right <= snap.at + pad + inner + 0.5
  const way = rest >= from ? 1 : -1
  let c = snap.c
  while (whole(all[c + way])) c += way
  return { at: snap.at, id: all[c]!.id }
}
