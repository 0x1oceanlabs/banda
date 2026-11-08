/**
 * A Tile's Configure (ADR 0088, decision 4): what the Tiling tells the
 * Pane in a Tile, as a Wayland compositor configures a window. A Pane
 * reads it, never as a prop, so a move draws no Pane again: imperatively,
 * `tileOf(element).watch`, as a terminal and a browser's page do; or in
 * React, `useTile(select)`, drawn again only as what it selects changes.
 *
 * - **Hidden:** draw nothing, stop timers, hold commits (at most once a
 *   second), keep state, and keep the size the Configure gives.
 * - **Moving:** measure and resize nothing; draw what changes.
 * - **Shown:** draw.
 *
 * The size comes through the resize gate (decision 5): one observer here
 * sees the box each Tile's Pane is drawn in, and the gate's policy says
 * when the Pane takes a size it was laid out at. A Pane fits what it draws
 * as its Configure's size or scale changes, and keeps no observer of its
 * own for it. The policy is "every frame" till the Person picks how a
 * width moves (the client's plan, P7), so a terminal still fits in each
 * frame its Tile's size changes, as it did before the gate.
 *
 * While the window is away, no one sees it, and every Tile is hidden. A
 * Pane outside the Tiling, as in Quick Look, is a Tile of its own, as
 * large as the element it asks with, and shown but while the window is
 * away.
 */
import { createContext, useCallback, useContext } from "react"
import { useSelected } from "./store"

export type TileState = "shown" | "moving" | "hidden"

/** A box's size, in CSS pixels. */
export type Size = { readonly width: number; readonly height: number }

export type Configure = {
  readonly state: TileState
  /** The size its Pane takes, in CSS pixels: of the box the Pane is drawn
   * in, as laid out, once the resize gate lets it through; 0 × 0 till it
   * is first laid out. The same object for as long as it stays the same. */
  readonly size: Size
  /** The screen's pixels to a CSS pixel, the window's own zoom counted
   * in. A Pane that zooms what it draws, as a terminal its font, keeps its
   * zoom its own. */
  readonly scale: number
  /** Counts the Configures the Tile was given: each new one is one more. */
  readonly serial: number
}

/** What a Pane reads of its Tile. */
export interface Tile {
  /** Its Configure now. */
  now(): Configure
  /** Calls `heard` with each new Configure; returns how to stop. */
  watch(heard: (configure: Configure) => void): () => void
}

/**
 * The resize gate's policy (ADR 0088, decision 5): whether a Tile's Pane
 * takes, in a Configure of `state`, the size its box was last laid out at.
 */
type Gate = (state: TileState) => boolean

/**
 * "Every frame": a Tile's Pane takes each size in the frame it was laid
 * out in, as it did before the gate, so nothing changes till the Person's
 * pick replaces it as the policy, here and only here (the client's plan,
 * P7): "at settle", a size taken once its move lands, or at most every
 * 100 ms while a hand drags and once as it lets go.
 */
const everyFrame: Gate = () => true

const gate: Gate = everyFrame

/** A size not laid out yet. */
const NONE: Size = { width: 0, height: 0 }

/** The window is away: hidden, or its screen asleep. */
let away =
  typeof document !== "undefined" && document.visibilityState === "hidden"

/** The screen's pixels to a CSS pixel, now. */
let scale = typeof devicePixelRatio === "number" ? devicePixelRatio || 1 : 1

/** The Tiles the Tiling holds, the one outside it, and those of Panes
 * outside it while they are watched: each hears the window go and come
 * back, and the screen's scale change. */
const held = new Set<TileBox>()

/** Tells a Tile its Pane's box was laid out at `size`: `TileBox` sets it,
 * for the observer here alone. */
let laidOut: (tile: TileBox, size: Size) => void

/**
 * A Tile as the Tiling keeps it: the Tiling gives it its state
 * (`configure`), the observer here its size, and its Pane hears each new
 * Configure. A new one is shown, but while the window is away.
 */
export class TileBox implements Tile {
  static {
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => {
        away = document.visibilityState === "hidden"
        for (const box of [...held]) box.#settle()
      })
    // A resolution query hears only the scale it names: each change asks
    // again for the next.
    const rescale = () => {
      scale = devicePixelRatio || 1
      for (const box of [...held]) box.#settle()
      watchScale()
    }
    const watchScale = () =>
      matchMedia(`(resolution: ${scale}dppx)`).addEventListener(
        "change",
        rescale,
        { once: true }
      )
    if (typeof matchMedia !== "undefined") watchScale()
    laidOut = (tile, size) => {
      const was = tile.#laid
      if (size.width === was.width && size.height === was.height) return
      tile.#laid = size
      tile.#settle()
    }
  }

  /** What the Tiling gave it, before the window's being away. */
  #given: TileState = "shown"
  /** The size its Pane's box was laid out at last, which the gate may
   * hold back. */
  #laid: Size = NONE
  #configure: Configure = {
    state: away ? "hidden" : "shown",
    size: NONE,
    scale,
    serial: 0,
  }
  readonly #heard = new Set<(configure: Configure) => void>()

  readonly now = (): Configure => this.#configure

  readonly watch = (heard: (configure: Configure) => void): (() => void) => {
    this.#heard.add(heard)
    return () => {
      this.#heard.delete(heard)
    }
  }

  /** The state the Tiling gave it last, the window away or not. */
  get given(): TileState {
    return this.#given
  }

  /** Gives the Tile `state`: its Pane hears it only if it is new. */
  configure(state: TileState): void {
    this.#given = state
    this.#settle()
  }

  /** Its Configure from what it was given, the size its Pane's box was
   * laid out at as the gate lets it through, the window's being away and
   * the screen's scale: each watcher hears a new one. */
  #settle(): void {
    const was = this.#configure
    const state = away ? "hidden" : this.#given
    const size = gate(state) ? this.#laid : was.size
    if (state === was.state && size === was.size && scale === was.scale) return
    this.#configure = { state, size, scale, serial: was.serial + 1 }
    for (const heard of [...this.#heard]) heard(this.#configure)
  }
}

/** What marks a Tile's box in the page: the Tiling's `section`. */
const TILE = "[data-tile]"

const boxes = new WeakMap<Element, TileBox>()

/** The Tile of a Pane outside the Tiling, for `useTile`: always shown, but
 * while the window is away; of no size, as it stands for none. */
const ALONE = new TileBox()
held.add(ALONE)

/** The resize gate's observer, made as the first Tile is held: one for
 * every Tile, with what it observes for each. */
let observer: ResizeObserver | undefined
const observed = new WeakMap<Element, TileBox>()

/** Observes `box`, which `tile`'s Pane is drawn in, for its size, until
 * the function it returns is called. */
function observe(box: Element, tile: TileBox): () => void {
  if (typeof ResizeObserver === "undefined") return () => {}
  // Heard after layout and before paint: what a Pane fits to its new
  // size shows in the frame that laid it out.
  observer ??= new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      const tile = observed.get(target)
      if (tile)
        laidOut(tile, { width: contentRect.width, height: contentRect.height })
    }
  })
  observed.set(box, tile)
  observer.observe(box)
  return () => {
    if (observed.get(box) !== tile) return
    observed.delete(box)
    observer?.unobserve(box)
  }
}

/** The box a Tile's Pane is drawn in: the last part of the Tile's box,
 * under its header, as the Tiling's frame draws it (`PaneFrame`). */
function paneBoxOf(tile: Element): Element {
  return tile.lastElementChild ?? tile
}

/**
 * Says `element`, a Tile's box in the page (`[data-tile]`), is `tile`'s,
 * until the function it returns is called; meanwhile the resize gate sizes
 * it. The Tiling says so as it draws the Tile: a Pane finds it from its
 * effects on, though not from a layout effect of its first drawing, which
 * runs before.
 */
export function holdTile(element: Element, tile: TileBox): () => void {
  boxes.set(element, tile)
  held.add(tile)
  const unobserve = observe(paneBoxOf(element), tile)
  return () => {
    unobserve()
    if (boxes.get(element) !== tile) return
    boxes.delete(element)
    held.delete(tile)
  }
}

/** The Tile `element` stands in, as the Tiling keeps it; none outside a
 * Tile. Only the Tiling configures one. */
export function boxOf(element: Element): TileBox | undefined {
  const box = element.closest(TILE)
  return box ? boxes.get(box) : undefined
}

/** The Tiles' boxes a Pane looked for before the Tiling held them. */
const early = new WeakSet<Element>()

/** The Tiles of Panes outside the Tiling, by the element each asked with. */
const alone = new WeakMap<Element, Tile>()

/**
 * The Tile of a Pane outside the Tiling that asks with `element`: shown
 * but while the window is away, and as large as `element`. It is observed,
 * and hears the window and the screen, while it is watched, as nothing
 * says when it goes; asked then, it says what it is now.
 */
function aloneOf(element: Element): Tile {
  const known = alone.get(element)
  if (known) return known
  const box = new TileBox()
  let watching = 0
  let unobserve = () => {}
  const tile: Tile = {
    now: () => {
      if (watching === 0) box.configure("shown")
      return box.now()
    },
    watch: (heard) => {
      if (watching++ === 0) {
        held.add(box)
        box.configure("shown")
        unobserve = observe(element, box)
      }
      const unwatch = box.watch(heard)
      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        unwatch()
        if (--watching > 0) return
        held.delete(box)
        unobserve()
      }
    },
  }
  alone.set(element, tile)
  return tile
}

/**
 * The Tile `element` stands in: its Pane's own element, as a terminal's
 * screen, or the place a browser's page shows over. Outside the Tiling,
 * a Tile of its own, as large as `element`.
 *
 * Asked from a layout effect of the Pane's first drawing, before the
 * Tiling holds its Tile, it finds none, and says so once: that Pane would
 * draw while hidden, and never hear its size. Ask from an effect.
 */
export function tileOf(element: Element): Tile {
  const box = element.closest(TILE)
  if (!box) return aloneOf(element)
  const tile = boxes.get(box)
  if (tile) return tile
  if (!early.has(box)) {
    early.add(box)
    console.warn(
      "tileOf: asked before the Tiling holds the Tile, so it reads as always shown. Ask from an effect, not a layout effect of the first drawing.",
      box
    )
  }
  return ALONE
}

/** The Tile a Pane is drawn in, which the Tiling gives it, for `useTile`
 * and for parts of `@banda/ui` that a Pane draws, as `useLive`. */
export const TileContext = createContext<Tile>(ALONE)

/**
 * What `select` takes of the Configure of the Tile this is drawn in,
 * drawn again only as that changes: a Pane that only stops a timer while
 * hidden selects `state === "hidden"`, and a move draws it not.
 */
export function useTile<T>(select: (configure: Configure) => T): T {
  const tile = useContext(TileContext)
  const subscribe = useCallback(
    (listener: () => void) => tile.watch(() => listener()),
    [tile]
  )
  return useSelected(subscribe, () => select(tile.now()))
}
