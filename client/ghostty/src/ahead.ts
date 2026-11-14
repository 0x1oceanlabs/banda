/**
 * Letters drawn ahead of the machine (#1242): what the Person typed over
 * a slow link, shown after the cursor, underlined, until the machine
 * sends them back. They are put into a frame's snapshot as cells, so the
 * renderer draws them as it draws any others, and the terminal's own
 * state never has them: what is copied, searched or scrolled back is the
 * machine's.
 */
import { GHOSTTY_CELL, type GhosttySnapshot } from "./t3/core"

const SPACE = 0x20

/**
 * `snapshot` with `text` after its cursor, and the cursor after the
 * text; `snapshot` itself where they do not show: with no text, a cursor
 * off the screen or hidden, anything but blanks from the cursor to its
 * row's end, or text that does not fit before that end. So a letter is
 * drawn ahead only at a line's end, never over what the machine wrote.
 */
export function withAhead(
  snapshot: GhosttySnapshot,
  text: string
): GhosttySnapshot {
  const { grid, cursorX, cursorY } = snapshot
  if (text === "" || !snapshot.cursorVisible || cursorX < 0 || cursorY < 0) {
    return snapshot
  }
  const { cols } = grid
  const row = cursorY * cols
  // The cursor keeps a cell of the row after the last letter.
  if (cursorY >= grid.rows || cursorX + text.length >= cols) return snapshot
  for (let column = cursorX; column < cols; column += 1) {
    const code = grid.codes[row + column]!
    if (code !== 0 && code !== SPACE) return snapshot
  }
  const codes = grid.codes.slice()
  const styles = grid.styles.slice()
  const foregrounds = grid.foregrounds.slice()
  const hashes = grid.hashes.slice()
  let hash = hashes[cursorY]!
  for (let at = 0; at < text.length; at += 1) {
    const cell = row + cursorX + at
    const code = text.charCodeAt(at)
    codes[cell] = code
    styles[cell] = GHOSTTY_CELL.underline
    foregrounds[cell] = snapshot.foreground
    // Another row than the machine's, to what tells rows apart by it.
    hash = (Math.imul(hash ^ code, 0x01000193) + cell) >>> 0
  }
  hashes[cursorY] = hash
  return {
    ...snapshot,
    cursorX: cursorX + text.length,
    ahead: {
      start: { x: cursorX, y: cursorY },
      end: { x: cursorX + text.length - 1, y: cursorY },
    },
    dirtyRows: new Set([...snapshot.dirtyRows, cursorY]),
    grid: { ...grid, codes, styles, foregrounds, hashes },
  }
}
