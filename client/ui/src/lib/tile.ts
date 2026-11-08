/**
 * A Tile's Configure (ADR 0088, decision 4): what the Tiling tells the
 * Pane in a Tile, as a Wayland compositor configures a window. A Pane
 * reads it, never as a prop, so a move draws no Pane again: imperatively,
 * `tileOf(element).watch`, as a terminal and a browser's page do; or in
 * React, `useTile(select)`, drawn again only as what it selects changes.
 *
 * - **Hidden:** draw nothing, stop timers, hold commits (at most once a
 *   second), keep state.
 * - **Moving:** measure and resize nothing; draw what changes.
 * - **Shown:** draw.
 *
 * The state lands first; the size and the scale come with the resize gate
 * and the width the Person picks (the client's plan, P3 and P7). While the
 * window is away, no one sees it, and every Tile is hidden. A Pane outside
 * the Tiling, as in Quick Look, is shown but while the window is away.
 */
import { createContext, useCallback, useContext } from "react"
import { useSelected } from "./store"

export type TileState = "shown" | "moving" | "hidden"

export type Configure = {
  readonly state: TileState
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

/** The window is away: hidden, or its screen asleep. */
let away = false

/** The Tiles some Pane watches, which hear the window go and come back. */
const watched = new Set<TileBox>()

if (typeof document !== "undefined") {
  away = document.visibilityState === "hidden"
  document.addEventListener("visibilitychange", () => {
    away = document.visibilityState === "hidden"
    // Each brings its Configure up to date, and its Pane hears it.
    for (const box of [...watched]) box.now()
  })
}

/**
 * A Tile as the Tiling keeps it: the Tiling gives it its state
 * (`configure`), and its Pane hears each new Configure. A new one is shown.
 */
export class TileBox implements Tile {
  /** What the Tiling gave it, before the window's being away. */
  #given: TileState = "shown"
  #configure: Configure = { state: "shown", serial: 0 }
  readonly #heard = new Set<(configure: Configure) => void>()

  /** Its Configure now, brought up to date first: each watcher hears a
   * new one. */
  readonly now = (): Configure => {
    const state = away ? "hidden" : this.#given
    if (state !== this.#configure.state) {
      this.#configure = { state, serial: this.#configure.serial + 1 }
      for (const heard of [...this.#heard]) heard(this.#configure)
    }
    return this.#configure
  }

  readonly watch = (heard: (configure: Configure) => void): (() => void) => {
    this.#heard.add(heard)
    watched.add(this)
    return () => {
      this.#heard.delete(heard)
      if (this.#heard.size === 0) watched.delete(this)
    }
  }

  /** Gives the Tile `state`: its Pane hears it only if it is new. */
  configure(state: TileState): void {
    this.#given = state
    this.now()
  }
}

/** What marks a Tile's box in the page: the Tiling's `section`. */
const TILE = "[data-tile]"

const boxes = new WeakMap<Element, TileBox>()

/** The Tile of a Pane outside the Tiling: always shown, but while the
 * window is away. */
const ALONE = new TileBox()

/**
 * Says `element`, a Tile's box in the page (`[data-tile]`), is `tile`'s,
 * until the function it returns is called. The Tiling says so as it draws
 * the Tile: a Pane finds it from its effects on, though not from a layout
 * effect of its first drawing, which runs before.
 */
export function holdTile(element: Element, tile: TileBox): () => void {
  boxes.set(element, tile)
  return () => {
    if (boxes.get(element) === tile) boxes.delete(element)
  }
}

/** The Tile `element` stands in, as the Tiling keeps it; none outside a
 * Tile. Only the Tiling configures one. */
export function boxOf(element: Element): TileBox | undefined {
  const box = element.closest(TILE)
  return box ? boxes.get(box) : undefined
}

/** The Tile `element` stands in: its Pane's own element, as a terminal's
 * screen, or the place a browser's page shows over. Outside the Tiling,
 * a Tile always shown. */
export function tileOf(element: Element): Tile {
  return boxOf(element) ?? ALONE
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
