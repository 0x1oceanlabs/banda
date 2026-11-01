/**
 * The Desk's layout: a tree of splits whose leaves are tiles, each showing
 * one Pane. Every change is a pure function from one layout to the next,
 * so plain tests cover the tiling rules; the Desk only draws the tree.
 */
import { type JsonValue, newId } from "@bandaso/contract"
import type { PaneState, Place } from "@bandaso/ui/pane"

export type Tile = { type: "tile"; id: string; pane: PaneState }

export type Split = {
  type: "split"
  id: string
  /** `row` lays its children side by side; `column`, one above another. */
  axis: "row" | "column"
  children: Node[]
  /** Each child's share, in percent; they add up to 100. */
  sizes: number[]
}

export type Node = Tile | Split

export type Layout = {
  root: Node | null
  /** Tiles by when they last had the focus, the focused one first. */
  recent: string[]
}

export type Direction = "left" | "right" | "up" | "down"

export const EMPTY: Layout = { root: null, recent: [] }

/** The tiles in reading order: left to right, top to bottom. */
export function tiles(layout: Layout): Tile[] {
  const found: Tile[] = []
  const walk = (node: Node) => {
    if (node.type === "tile") found.push(node)
    else node.children.forEach(walk)
  }
  if (layout.root) walk(layout.root)
  return found
}

export function focused(layout: Layout): Tile | undefined {
  const id = layout.recent[0]
  return tiles(layout).find((tile) => tile.id === id)
}

export function focus(layout: Layout, id: string): Layout {
  if (layout.recent[0] === id) return layout
  return { ...layout, recent: [id, ...layout.recent.filter((r) => r !== id)] }
}

/** Two Panes are the same when their kind and args are. */
export function samePane(a: PaneState, b: PaneState): boolean {
  return a.kind === b.kind && canonical(a.args) === canonical(b.args)
}

/** The Panes `before` shows and `after` does not: they left the Desk. */
export function left(before: Layout, after: Layout): PaneState[] {
  const stays = tiles(after).map((tile) => tile.pane)
  return tiles(before)
    .map((tile) => tile.pane)
    .filter((pane) => !stays.some((other) => samePane(pane, other)))
}

function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

export type Opening = {
  /** The tile that opens it; the focused one when left out. */
  from?: string
  /** Where; see {@link Place}. Left out, the Desk picks. */
  place?: Place
  /** The share in percent a new tile takes from the one it splits. */
  share?: number
}

/**
 * Shows a Pane and focuses it.
 *
 * - A tile already showing the same Pane gets the focus instead.
 * - `here` replaces the opener's Pane.
 * - `right` and `below` split the opener.
 * - Left out, the Pane takes the tile that last showed its kind, or
 *   splits the opener to the right when there is none.
 */
export function open(
  layout: Layout,
  pane: PaneState,
  opening: Opening = {}
): Layout {
  const all = tiles(layout)
  const showing = all.find((tile) => samePane(tile.pane, pane))
  if (showing) return focus(layout, showing.id)
  const place = opening.place
  const from = opener(layout, opening.from)
  if (from && place === "here")
    return focus(show(layout, from.id, pane), from.id)
  if (place === undefined) {
    const kin = layout.recent
      .map((id) => all.find((tile) => tile.id === id))
      .find((tile) => tile?.pane.kind === pane.kind)
    if (kin) return focus(show(layout, kin.id, pane), kin.id)
  }
  return split(layout, pane, {
    from: from?.id,
    place: place === "below" ? "below" : "right",
    share: opening.share,
  })
}

/** The tile that opens something: the one named, the focused one, the first. */
function opener(layout: Layout, from: string | undefined): Tile | undefined {
  const all = tiles(layout)
  return all.find((tile) => tile.id === (from ?? layout.recent[0])) ?? all[0]
}

/** Gives a tile another Pane, or new args for its own. */
export function show(layout: Layout, id: string, pane: PaneState): Layout {
  const root =
    layout.root && mapTile(layout.root, id, (tile) => ({ ...tile, pane }))
  return { ...layout, root }
}

function mapTile(node: Node, id: string, change: (tile: Tile) => Tile): Node {
  if (node.type === "tile") return node.id === id ? change(node) : node
  const children = node.children.map((child) => mapTile(child, id, change))
  return children.every((child, i) => child === node.children[i])
    ? node
    : { ...node, children }
}

/**
 * Splits a tile and shows a Pane in the new one, even when the Desk
 * already shows it. Along a split's own axis the new tile becomes a
 * sibling; across it, the tile and the new one nest in a new split.
 */
export function split(
  layout: Layout,
  pane: PaneState,
  opening: Opening & { place: "right" | "below" }
): Layout {
  const tile: Tile = { type: "tile", id: newId(), pane }
  const target = opener(layout, opening.from)
  if (!layout.root || !target) return { root: tile, recent: [tile.id] }
  const axis = opening.place === "below" ? "column" : "row"
  const share = opening.share ?? 50
  const place = (node: Node): Node => {
    if (node.type === "tile") {
      if (node.id !== target.id) return node
      return {
        type: "split",
        id: newId(),
        axis,
        children: [node, tile],
        sizes: [100 - share, share],
      }
    }
    const index = node.children.findIndex((c) => c.id === target.id)
    if (index >= 0 && node.axis === axis) {
      const own = node.sizes[index]
      const children = [...node.children]
      children.splice(index + 1, 0, tile)
      const sizes = [...node.sizes]
      sizes.splice(index, 1, (own * (100 - share)) / 100, (own * share) / 100)
      return { ...node, children, sizes }
    }
    return { ...node, children: node.children.map(place) }
  }
  return focus({ ...layout, root: place(layout.root) }, tile.id)
}

/** Closes a tile; the tile focused before it gets the focus. */
export function close(layout: Layout, id: string): Layout {
  const remove = (node: Node): Node | null => {
    if (node.type === "tile") return node.id === id ? null : node
    const kept: Node[] = []
    const sizes: number[] = []
    node.children.forEach((child, i) => {
      const left = remove(child)
      if (left) {
        kept.push(left)
        sizes.push(node.sizes[i])
      }
    })
    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0]
    const total = sizes.reduce((a, b) => a + b, 0)
    return {
      ...node,
      children: kept,
      sizes: sizes.map((s) => (s * 100) / total),
    }
  }
  const root = layout.root && remove(layout.root)
  return { root, recent: layout.recent.filter((r) => r !== id) }
}

/** Keeps the shares a Person dragged a split to. */
export function resize(layout: Layout, split: string, sizes: number[]): Layout {
  const change = (node: Node): Node => {
    if (node.type === "tile") return node
    if (node.id === split)
      return node.sizes.length === sizes.length ? { ...node, sizes } : node
    return { ...node, children: node.children.map(change) }
  }
  return { ...layout, root: layout.root && change(layout.root) }
}

type Box = { left: number; top: number; right: number; bottom: number }

function boxes(node: Node, box: Box, into: Map<string, Box>): Map<string, Box> {
  if (node.type === "tile") return into.set(node.id, box)
  let start = node.axis === "row" ? box.left : box.top
  const length =
    node.axis === "row" ? box.right - box.left : box.bottom - box.top
  node.children.forEach((child, i) => {
    const end = start + (length * node.sizes[i]) / 100
    const part =
      node.axis === "row"
        ? { ...box, left: start, right: end }
        : { ...box, top: start, bottom: end }
    boxes(child, part, into)
    start = end
  })
  return into
}

const EDGE = 1e-6

/**
 * Moves the focus to the next tile in a direction: the nearest one that
 * shares an edge with the focused tile, the one focused last on a tie.
 */
export function move(layout: Layout, direction: Direction): Layout {
  const current = focused(layout)
  if (!layout.root || !current) return layout
  const all = boxes(
    layout.root,
    { left: 0, top: 0, right: 1, bottom: 1 },
    new Map()
  )
  const from = all.get(current.id)!
  const horizontal = direction === "left" || direction === "right"
  const overlaps = (box: Box) =>
    horizontal
      ? box.top < from.bottom - EDGE && box.bottom > from.top + EDGE
      : box.left < from.right - EDGE && box.right > from.left + EDGE
  const gap = (box: Box) => {
    switch (direction) {
      case "left":
        return from.left - box.right
      case "right":
        return box.left - from.right
      case "up":
        return from.top - box.bottom
      case "down":
        return box.top - from.bottom
    }
  }
  const rank = (id: string) => {
    const at = layout.recent.indexOf(id)
    return at < 0 ? Infinity : at
  }
  let best: { id: string; gap: number } | undefined
  for (const [id, box] of all) {
    if (id === current.id || !overlaps(box)) continue
    const distance = gap(box)
    if (distance < -EDGE) continue
    if (
      !best ||
      distance < best.gap - EDGE ||
      (Math.abs(distance - best.gap) <= EDGE && rank(id) < rank(best.id))
    ) {
      best = { id, gap: distance }
    }
  }
  return best ? focus(layout, best.id) : layout
}

/**
 * Reads a layout kept from an earlier run; `null` when it is not one. A
 * tile of a kind this window does not know stays: the Desk says so.
 */
export function parse(value: unknown): Layout | null {
  if (!isObject(value) || !Array.isArray(value.recent)) return null
  const node = (raw: unknown): Node | null => {
    if (!isObject(raw) || typeof raw.id !== "string") return null
    if (raw.type === "tile") {
      const pane = raw.pane
      if (
        !isObject(pane) ||
        typeof pane.kind !== "string" ||
        !isObject(pane.args)
      ) {
        return null
      }
      return { type: "tile", id: raw.id, pane: pane as PaneState }
    }
    if (raw.type !== "split" || (raw.axis !== "row" && raw.axis !== "column"))
      return null
    if (!Array.isArray(raw.children) || !Array.isArray(raw.sizes)) return null
    const children = raw.children.map(node)
    if (children.length < 2 || children.some((c) => c === null)) return null
    if (
      raw.sizes.length !== children.length ||
      raw.sizes.some((s) => typeof s !== "number")
    ) {
      return null
    }
    return {
      type: "split",
      id: raw.id,
      axis: raw.axis,
      children: children as Node[],
      sizes: raw.sizes,
    }
  }
  const root = value.root === null ? null : node(value.root)
  if (value.root !== null && root === null) return null
  const ids = new Set(tiles({ root, recent: [] }).map((tile) => tile.id))
  const recent = value.recent.filter(
    (id): id is string => typeof id === "string" && ids.has(id)
  )
  return { root, recent }
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
