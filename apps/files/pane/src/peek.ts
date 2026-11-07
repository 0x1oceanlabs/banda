/**
 * Whether Files' Quick Look shows (ADR 0073, decision 7), in this window,
 * and how to close it. The tile is the window's (`WindowApi.peek`), and
 * `files.file` drawn in it says so here: how a tree knows it shows, so
 * Space closes it and the arrows move it.
 */

/** How the tile showing now closes; none while none shows. */
let shown: (() => void) | null = null

/** How Quick Look closes, while it shows. */
export function peeked(): (() => void) | null {
  return shown
}

/** Says Quick Look shows, and closes by `close`; with `null`, that the
 * tile `was` closed, unless another shows already. */
export function peeking(close: (() => void) | null, was?: () => void): void {
  if (close === null && was && shown !== was) return
  shown = close
}
