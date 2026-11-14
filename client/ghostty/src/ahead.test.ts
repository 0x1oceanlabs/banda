import { expect, test } from "vitest"
import { withAhead } from "./ahead"
import { GHOSTTY_CELL, type GhosttySnapshot } from "./t3/core"

/** A screen of one row, `cols` wide, that shows `shown`, its cursor
 * after it. */
function screen(shown: string, cols = 10): GhosttySnapshot {
  const codes = new Uint32Array(cols)
  for (let at = 0; at < shown.length; at += 1) codes[at] = shown.charCodeAt(at)
  return {
    cols,
    rows: 1,
    foreground: 0xffffff,
    background: 0,
    cursor: 0xffffff,
    cursorX: shown.length,
    cursorY: 0,
    cursorVisible: true,
    cursorBlinking: true,
    cursorStyle: 1,
    dirtyRows: new Set(),
    grid: {
      cols,
      rows: 1,
      codes,
      foregrounds: new Uint32Array(cols).fill(0x808080),
      backgrounds: new Uint32Array(cols),
      styles: new Uint16Array(cols),
      graphemes: new Array<string | undefined>(cols),
      lines: new Uint8Array(1),
      hashes: new Uint32Array([7]),
    },
  }
}

const textOf = ({ grid }: GhosttySnapshot) =>
  String.fromCharCode(...[...grid.codes].map((code) => code || 0x20)).trimEnd()

test("the letters show after the cursor, underlined, the cursor after them, and the machine's screen is as it was", () => {
  const machine = screen("$ gi")
  const drawn = withAhead(machine, "t s")
  expect(textOf(drawn)).toBe("$ git s")
  expect(drawn.cursorX).toBe(7)
  expect(drawn.ahead).toEqual({ start: { x: 4, y: 0 }, end: { x: 6, y: 0 } })
  expect([...drawn.grid.styles]).toEqual([
    0,
    0,
    0,
    0,
    GHOSTTY_CELL.underline,
    GHOSTTY_CELL.underline,
    GHOSTTY_CELL.underline,
    0,
    0,
    0,
  ])
  expect(drawn.grid.foregrounds[4]).toBe(0xffffff)
  // The row is another to what tells rows apart, and is drawn again.
  expect(drawn.grid.hashes[0]).not.toBe(7)
  expect(drawn.dirtyRows.has(0)).toBe(true)
  expect(textOf(machine)).toBe("$ gi")
  expect(machine.cursorX).toBe(4)
  expect(machine.grid.hashes[0]).toBe(7)
})

test("nothing shows with no letters, over what the machine wrote, past the row's end, or with no cursor", () => {
  const machine = screen("$ gi")
  expect(withAhead(machine, "")).toBe(machine)
  // The cursor in the middle of a line.
  const middle = { ...machine, cursorX: 2 }
  expect(withAhead(middle, "x")).toBe(middle)
  // The cursor keeps a cell after the last letter.
  expect(withAhead(machine, "12345")).not.toBe(machine)
  expect(withAhead(machine, "123456")).toBe(machine)
  const hidden = { ...machine, cursorVisible: false }
  expect(withAhead(hidden, "x")).toBe(hidden)
})
