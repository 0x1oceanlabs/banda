import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import {
  GHOSTTY_CELL,
  GHOSTTY_LINE,
  GhosttyTerminalCore,
  ghosttyCellTextAt,
  ghosttyCellWide,
  type GhosttySnapshot,
} from "./t3/core"
import type { GhosttyRuntime } from "./t3/runtime"

// The adapter fetches its WebAssembly by URL, as a page does; here, from
// the vendored files.
beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/").pop()!.split("?")[0]!
    return new Response(
      readFileSync(join(import.meta.dirname, "t3/vendor", name))
    )
  })
})

const THEME = {
  foreground: { r: 220, g: 221, b: 222 },
  background: { r: 10, g: 11, b: 12 },
  cursor: { r: 255, g: 255, b: 255 },
}

/** What the core keeps of libghostty-vt, which the reference reads. */
type Inside = {
  runtime: GhosttyRuntime
  renderState: number
  rowIteratorSlot: number
  rowCellsSlot: number
  scratch: number
}

/** A cell as T3's adapter read it: each value asked for on its own. */
type Cell = {
  text: string
  wide: number
  foreground: number
  background: number
  style: number
}

const rgb = (view: DataView, at: number) =>
  (view.getUint8(at) << 16) |
  (view.getUint8(at + 1) << 8) |
  view.getUint8(at + 2)

/**
 * The screen as T3's adapter read it, cell by cell, each value with a call
 * of its own: the reference the typed grid must match. It reads the render
 * state the last snapshot updated.
 */
function reference(core: GhosttyTerminalCore, snapshot: GhosttySnapshot) {
  const inside = core as unknown as Inside
  const runtime = inside.runtime
  const { size: styleSize, fields } = runtime.layout("GhosttyStyle")
  const style = runtime.alloc(styleSize)
  const out = runtime.alloc(4096)
  const get = (iterator: number, key: number, into: number) =>
    runtime.call("ghostty_render_state_row_cells_get", iterator, key, into) ===
    0
  runtime.call(
    "ghostty_render_state_get",
    inside.renderState,
    4,
    inside.rowIteratorSlot
  )
  const rows = runtime.readPointer(inside.rowIteratorSlot)
  const screen: { cells: Cell[]; lines: number }[] = []
  while (
    screen.length < snapshot.rows &&
    runtime.call("ghostty_render_state_row_iterator_next", rows) !== 0
  ) {
    runtime.call("ghostty_render_state_row_get", rows, 2, out)
    const raw = runtime.memoryDataView().getBigUint64(out, true)
    const flag = (key: number) => {
      runtime.memoryBytes()[out + 8] = 0
      runtime.call("ghostty_row_get", raw, key, out + 8)
      return runtime.memoryBytes()[out + 8] !== 0
    }
    const lines =
      (flag(2) ? GHOSTTY_LINE.wrapContinuation : 0) |
      (flag(1) ? GHOSTTY_LINE.wrapsToNext : 0)
    runtime.call("ghostty_render_state_row_get", rows, 3, inside.rowCellsSlot)
    const cells = runtime.readPointer(inside.rowCellsSlot)
    const row: Cell[] = []
    while (
      row.length < snapshot.cols &&
      runtime.call("ghostty_render_state_row_cells_next", cells) !== 0
    ) {
      runtime.memoryBytes().fill(0, style, style + styleSize)
      runtime.memoryDataView().setUint32(style, styleSize, true)
      get(cells, 2, style)
      runtime.memoryDataView().setUint32(out, 0, true)
      get(cells, 3, out)
      const length = runtime.memoryDataView().getUint32(out, true)
      runtime.memoryBytes()[out] = 0
      get(cells, 7, out)
      const selected = runtime.memoryBytes()[out] !== 0
      let background = get(cells, 5, out)
        ? rgb(runtime.memoryDataView(), out)
        : snapshot.background
      let foreground = get(cells, 6, out)
        ? rgb(runtime.memoryDataView(), out)
        : snapshot.foreground
      let text = ""
      if (length > 0 && get(cells, 4, out)) {
        const view = runtime.memoryDataView()
        text = String.fromCodePoint(
          ...Array.from({ length }, (_, i) => view.getUint32(out + i * 4, true))
        )
      }
      let wide = 0
      if (!text && (row.at(-1)?.text || row.length === snapshot.cols - 1)) {
        get(cells, 1, out)
        const cell = runtime.memoryDataView().getBigUint64(out, true)
        runtime.call("ghostty_cell_get", cell, 3, out + 8)
        wide = runtime.memoryDataView().getUint32(out + 8, true)
      }
      const view = runtime.memoryDataView()
      const on = (name: string) =>
        view.getUint8(style + fields[name]!.offset) !== 0
      if (on("inverse")) [foreground, background] = [background, foreground]
      if (on("faint")) {
        const channel = (shift: number) =>
          Math.floor(
            (((foreground >> shift) & 0xff) * 155 +
              ((background >> shift) & 0xff) * 100) /
              255
          )
        foreground = (channel(16) << 16) | (channel(8) << 8) | channel(0)
      }
      row.push({
        text,
        wide,
        foreground,
        background,
        style:
          (on("bold") ? GHOSTTY_CELL.bold : 0) |
          (on("italic") ? GHOSTTY_CELL.italic : 0) |
          (on("invisible") ? GHOSTTY_CELL.invisible : 0) |
          (on("strikethrough") ? GHOSTTY_CELL.strikethrough : 0) |
          (on("overline") ? GHOSTTY_CELL.overline : 0) |
          (view.getInt32(style + fields.underline!.offset, true) !== 0
            ? GHOSTTY_CELL.underline
            : 0) |
          (selected ? GHOSTTY_CELL.selected : 0),
      })
    }
    while (row.length < snapshot.cols)
      row.push({
        text: "",
        wide: 0,
        foreground: snapshot.foreground,
        background: snapshot.background,
        style: 0,
      })
    screen.push({ cells: row, lines })
  }
  runtime.free(style, styleSize)
  runtime.free(out, 4096)
  return screen
}

/** The typed grid's screen, in the reference's terms. */
function typed(snapshot: GhosttySnapshot) {
  const { grid } = snapshot
  return Array.from({ length: grid.rows }, (_, row) => ({
    cells: Array.from({ length: grid.cols }, (_, column) => {
      const index = row * grid.cols + column
      return {
        text: ghosttyCellTextAt(grid, index),
        wide: ghosttyCellWide(grid, index),
        foreground: grid.foregrounds[index]!,
        background: grid.backgrounds[index]!,
        style: grid.styles[index]! & ~GHOSTTY_CELL.grapheme & 0xff,
      }
    }),
    lines: grid.lines[row]! & ~GHOSTTY_LINE.bleeds,
  }))
}

const ESC = "\x1b"

/** Lines in every style a terminal draws: colours of the palette, 256
 * and true, backgrounds, a line erased in a colour, inverse and faint,
 * the lines a style draws, wide letters, emoji, a family of them joined,
 * a combining accent, box drawing and diagonals, a line that wraps. */
const SCREEN = [
  `plain text, then ${ESC}[31mred${ESC}[0m and ${ESC}[1;32mbold green${ESC}[0m`,
  `${ESC}[38;5;208mpalette 208${ESC}[0m ${ESC}[38;2;1;2;3mtrue colour${ESC}[0m ${ESC}[48;5;22mon green${ESC}[0m`,
  `${ESC}[44merased blue${ESC}[K${ESC}[0m`,
  `${ESC}[7minverse${ESC}[0m ${ESC}[2mfaint${ESC}[0m ${ESC}[2;7mboth${ESC}[0m ${ESC}[33;7myellow inverse${ESC}[0m`,
  `${ESC}[4munder${ESC}[0m ${ESC}[9mstruck${ESC}[0m ${ESC}[53mover${ESC}[0m ${ESC}[3mitalic${ESC}[0m ${ESC}[8mhidden${ESC}[0m`,
  "wide 漢字かな and 👍 then 👨‍👩‍👧 and é ->",
  "┌─┬─┐ ╭─╮ ╱╲╳ ⣿ ▀▄ ",
  "a line long enough that it wraps onto the next row of this narrow screen, twice",
]

async function screenOf(write: (core: GhosttyTerminalCore) => void) {
  const core = await GhosttyTerminalCore.create(40, 16, 8, 16, THEME, () => {})
  write(core)
  return core
}

describe("the typed grid", () => {
  it("holds what T3's adapter read cell by cell, in every style", async () => {
    const core = await screenOf((core) =>
      core.write(SCREEN.join("\r\n") + "\r\n")
    )
    const snapshot = core.snapshot()
    expect(snapshot.grid.cols).toBe(40)
    expect(typed(snapshot)).toEqual(reference(core, snapshot))
    // What it reads differs from cell to cell: a broken read is no match.
    const texts = typed(snapshot).map((row) =>
      row.cells.map((cell) => cell.text).join("")
    )
    expect(texts[5]).toContain("👨‍👩‍👧")
    expect(
      new Set(typed(snapshot)[1]!.cells.map((c) => c.foreground)).size
    ).toBe(3)
    // Erased in blue, to the row's end.
    expect(typed(snapshot)[2]!.cells.at(-1)!.background).not.toBe(
      snapshot.background
    )
    core.dispose()
  })

  it("holds a selection, and only the rows written since are read again", async () => {
    const core = await screenOf((core) => core.write(SCREEN.join("\r\n")))
    core.snapshot()
    core.setSelection({ x: 2, y: 1 }, { x: 10, y: 3 })
    const selected = core.snapshot()
    expect(typed(selected)).toEqual(reference(core, selected))
    expect(
      selected.grid.styles.filter((s) => (s & GHOSTTY_CELL.selected) !== 0)
        .length
    ).toBeGreaterThan(20)
    core.clearSelection()
    core.snapshot()
    // The row written, and the one the cursor left.
    core.write(`${ESC}[1;1HX`)
    const written = core.snapshot()
    expect([...written.dirtyRows]).toEqual([0, 9])
    expect(typed(written)).toEqual(reference(core, written))
    core.dispose()
  })

  it("hashes equal rows the same wherever they stand, and marks a row whose glyph is drawn past it", async () => {
    const core = await screenOf((core) =>
      core.write(
        ["same row", "other row", "same row", "╱ diagonal"].join("\r\n")
      )
    )
    const { grid } = core.snapshot()
    expect(grid.hashes[0]).toBe(grid.hashes[2])
    expect(grid.hashes[0]).not.toBe(grid.hashes[1])
    expect(grid.hashes[5]).toBe(grid.hashes[6])
    expect(
      [...grid.lines.slice(0, 4)].map((l) => l & GHOSTTY_LINE.bleeds)
    ).toEqual([0, 0, 0, GHOSTTY_LINE.bleeds])
    core.dispose()
  })
})
