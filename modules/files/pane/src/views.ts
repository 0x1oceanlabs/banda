/**
 * Three views of one folder over one pick (ADR 0073, decisions 3 and 15;
 * step F6): the tree, the List; Miller columns, each folder from the top
 * to the pick a column, the last one previewing a file; and a Gallery, a
 * big preview over a filmstrip of what the pick's folder holds. Each lists
 * the folders it shows and moves the pick with the arrows its own way;
 * the rest, the keys, the menu, the drag and the operations, is the
 * Pane's, the same in each. A path is the tree's, from the top folder,
 * a folder's ending with `/`. Pure, so plain tests cover it.
 */
import type { Entry } from "@banda/contract/files"
import { foldersOf } from "@banda/ui/lib/tree-paths"
import { isFolder, type Listed, shownOf, type Showing } from "./tree"

/** How a Files Pane shows its folder. */
export type View = "list" | "columns" | "gallery"

export const VIEWS: readonly View[] = ["list", "columns", "gallery"]

/** The view a Pane's args name; the List when they name none. */
export function viewOf(view: string | undefined): View {
  return VIEWS.find((one) => one === view) ?? "list"
}

/** The folder a row is in: `""` the top. */
export function parentRow(row: string): string {
  return foldersOf(row).at(-1) ?? ""
}

/** What a folder shows, in the engine's order: each name under it as a
 * row, a folder's with its `/`, with what the engine said of it. None for
 * one not listed yet. */
export function itemsIn(
  listed: Listed,
  folder: string,
  showing: Showing
): { row: string; entry: Entry }[] {
  return shownOf(listed.get(folder) ?? [], showing).map((entry) => ({
    row: `${folder}${entry.name}${isFolder(entry) ? "/" : ""}`,
    entry,
  }))
}

/** The rows a folder shows, as `itemsIn` finds them. */
export function rowsIn(
  listed: Listed,
  folder: string,
  showing: Showing
): string[] {
  return itemsIn(listed, folder, showing).map(({ row }) => row)
}

/** The entry a row names, from what its folder listed. */
export function entryOf(listed: Listed, row: string): Entry | undefined {
  const name = row.replace(/\/$/, "").split("/").at(-1)
  return listed.get(parentRow(row))?.find((entry) => entry.name === name)
}

/** The columns from the top to `picked`: each folder on its way, and the
 * folder itself when one is picked, whose names come next. */
export function columnsOf(picked: string | null): string[] {
  if (!picked) return [""]
  return ["", ...foldersOf(picked), ...(picked.endsWith("/") ? [picked] : [])]
}

/** The folders a view lists and watches: the tree's open ones; the
 * columns'; the filmstrip's folder and those on its way. */
export function listedFor(
  view: View,
  picked: string | null,
  open: readonly string[]
): readonly string[] {
  if (view === "list") return open
  if (view === "columns") return columnsOf(picked).slice(1)
  return picked ? foldersOf(picked) : []
}

/** An arrow, or the ends of a list, as a view moves its pick by it. */
export type Arrow = "up" | "down" | "left" | "right" | "home" | "end"

/** The arrow a key is, by its name, as a list's own keys are. */
export const ARROWS: { readonly [key: string]: Arrow } = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
}

/**
 * Where `arrow` moves the pick in Columns or a Gallery; none where it
 * moves nowhere. `rows` gives what a folder shows. In Columns ↑ ↓ move in
 * the pick's column, → goes into a folder picked, ← back to its folder;
 * in a Gallery ← → move along the filmstrip. With nothing picked, the first
 * row of the top is.
 */
export function moved(
  view: Exclude<View, "list">,
  arrow: Arrow,
  picked: string | null,
  rows: (folder: string) => readonly string[]
): string | null {
  const folder = picked === null ? "" : parentRow(picked)
  const here = rows(folder)
  const at = picked === null ? -1 : here.indexOf(picked)
  const step = (by: number) =>
    here[Math.max(0, Math.min(here.length - 1, at + by))] ?? null
  if (picked === null || at < 0) return here[0] ?? null
  const along =
    view === "gallery"
      ? { left: -1, right: 1, up: 0, down: 0 }
      : { left: 0, right: 0, up: -1, down: 1 }
  switch (arrow) {
    case "home":
      return here[0] ?? null
    case "end":
      return here.at(-1) ?? null
    case "left":
      if (view === "columns") return folder === "" ? null : folder
      break
    case "right":
      if (view === "columns")
        return picked.endsWith("/") ? (rows(picked)[0] ?? null) : null
      break
  }
  const next = step(along[arrow])
  return next === picked ? null : next
}

/** The size of a filmstrip's item and the room between, in px. */
export const FILM = { item: 82, gap: 6 }

/**
 * The items of a filmstrip `count` long to draw, scrolled to `scroll` in a
 * view `width` wide, with `over` more on each side: `from` up to, but
 * not, `to`. A folder of thousands draws a screenful.
 */
export function filmWindow({
  count,
  scroll,
  width,
  over = 4,
}: {
  count: number
  scroll: number
  width: number
  over?: number
}): { from: number; to: number } {
  const step = FILM.item + FILM.gap
  const first = Math.floor(Math.max(0, scroll) / step)
  const shown = Math.ceil(Math.max(0, width) / step) + 1
  return {
    from: Math.max(0, first - over),
    to: Math.min(count, first + shown + over),
  }
}

/** Where a filmstrip scrolls to show item `at` in a view `width` wide,
 * scrolled to `scroll` now: in its middle, as a Finder's does, once it
 * goes out of view; `scroll` while it shows whole. */
export function filmScroll(at: number, scroll: number, width: number): number {
  const step = FILM.item + FILM.gap
  const start = FILM.gap + at * step
  if (start >= scroll && start + FILM.item <= scroll + width) return scroll
  return Math.max(0, Math.round(start + FILM.item / 2 - width / 2))
}
