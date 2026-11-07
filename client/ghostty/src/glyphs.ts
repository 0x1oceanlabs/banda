/**
 * Glyphs the terminal draws itself, from the cell's own edges, as Ghostty,
 * Kitty and WezTerm do (ADR 0047, decision 3): box drawing (U+2500 to
 * U+257F), blocks and shades (U+2580 to U+259F), braille (U+2800 to
 * U+28FF) and powerline's two solid triangles. A font draws them inside
 * its own height, so a frame of them breaks between rows; drawn here,
 * they join across rows and columns in any font. Every edge is on a
 * screen pixel's, so two cells side by side share theirs.
 */

/** The cell a glyph fills, in CSS pixels, and the screen's pixels per CSS
 * pixel. */
export type Cell = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly ratio: number
  readonly fontSize: number
}

/** `value` CSS pixels moved to the nearest edge of a screen pixel. */
export function onDevicePixel(value: number, ratio: number): number {
  return Math.round(value * ratio) / ratio
}

/** Each box-drawing glyph's four arms, up, right, down and left: 0 none,
 * 1 light, 2 heavy, 3 double. Made from the glyphs' Unicode names; the
 * arcs and diagonals are drawn apart and have none. */
const ARMS = Uint8Array.from(
  "01010202101020200101020210102020010102021010202001100210012002200011001200210022110012002100220010011002200120021110121021101120212022101220222010111012201110212021201210222022011101120211021201210122022102221101110212011202210121022201220211111112121112122111112121212112221111221221221212222122222122220101020210102020030330300310013003300013003100331300310033001003300130031310313033301013303130330313013103331303310133031313313133330000000000000000000000000000000110000100001000022000020000200201102001022010",
  (digit) => Number(digit)
)

/** The dashed lines, by how many dashes. */
const DASHES: Record<number, number> = {
  0x2504: 3,
  0x2505: 3,
  0x2506: 3,
  0x2507: 3,
  0x2508: 4,
  0x2509: 4,
  0x250a: 4,
  0x250b: 4,
  0x254c: 2,
  0x254d: 2,
  0x254e: 2,
  0x254f: 2,
}

/** The quadrants of U+2596 to U+259F, as bits: 1 upper left, 2 upper
 * right, 4 lower left, 8 lower right. */
const QUADRANTS = [4, 8, 1, 13, 9, 7, 11, 2, 6, 14]

/** Braille's dots 1 to 8, as column and row: the left column's three, the
 * right's three, then the bottom row's two. */
const DOTS = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
  [0, 3],
  [1, 3],
] as const

/** Powerline's solid triangles, pointing right and left. */
const POWERLINE_RIGHT = 0xe0b0
const POWERLINE_LEFT = 0xe0b2

/** Whether the terminal draws `text` itself. */
export function drawsItself(text: string): boolean {
  if (text.length !== 1) return false
  const code = text.charCodeAt(0)
  return (
    (code >= 0x2500 && code <= 0x259f) ||
    (code >= 0x2800 && code <= 0x28ff) ||
    code === POWERLINE_RIGHT ||
    code === POWERLINE_LEFT
  )
}

/** The arms of a box-drawing glyph, up, right, down and left. */
export function armsOf(code: number): [number, number, number, number] {
  const at = (code - 0x2500) * 4
  return [ARMS[at], ARMS[at + 1], ARMS[at + 2], ARMS[at + 3]]
}

/** Draws `text`, which `drawsItself`, in the context's fill style. */
export function drawGlyph(
  context: CanvasRenderingContext2D,
  text: string,
  cell: Cell
): void {
  const code = text.charCodeAt(0)
  if (code >= 0xe000) return powerline(context, code, cell)
  if (code >= 0x2800) return braille(context, code - 0x2800, cell)
  if (code >= 0x2580) return block(context, code, cell)
  if (code >= 0x256d && code <= 0x2570) return arc(context, code, cell)
  if (code >= 0x2571 && code <= 0x2573) return diagonal(context, code, cell)
  box(context, code, cell)
}

/** A rectangle from edge to edge, each on a screen pixel's. */
function fill(
  context: CanvasRenderingContext2D,
  ratio: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  const left = onDevicePixel(Math.min(x0, x1), ratio)
  const top = onDevicePixel(Math.min(y0, y1), ratio)
  const right = onDevicePixel(Math.max(x0, x1), ratio)
  const bottom = onDevicePixel(Math.max(y0, y1), ratio)
  if (right > left && bottom > top)
    context.fillRect(left, top, right - left, bottom - top)
}

/** A light line's thickness, whole screen pixels, as the font's size asks. */
function light(cell: Cell): number {
  return Math.max(1, Math.round((cell.fontSize * cell.ratio) / 12)) / cell.ratio
}

/** The cell's middle, where a light line of `thickness` starts on a screen
 * pixel. */
function middle(start: number, size: number, thickness: number, ratio: number) {
  return onDevicePixel(start + size / 2 - thickness / 2, ratio) + thickness / 2
}

function box(context: CanvasRenderingContext2D, code: number, cell: Cell) {
  const { left, top, width, height, ratio } = cell
  const t = light(cell)
  // Each weight's thickness; a double line's is its two lines and the gap.
  const thick = [0, t, 2 * t, 3 * t]
  const cx = middle(left, width, t, ratio)
  const cy = middle(top, height, t, ratio)
  const arms = armsOf(code)
  const [up, right, down, leftArm] = arms
  const dashes = DASHES[code]
  if (dashes) {
    // A dashed line crosses the cell evenly, so cells side by side keep
    // its rhythm.
    const vertical = up > 0
    const w = thick[Math.max(...arms)]
    const [from, size] = vertical ? [top, height] : [left, width]
    const across = (vertical ? cx : cy) - w / 2
    for (let n = 0; n < dashes; n++) {
      const start = from + (size * (n + 0.2)) / dashes
      const end = from + (size * (n + 0.8)) / dashes
      if (vertical) fill(context, ratio, across, start, across + w, end)
      else fill(context, ratio, start, across, end, across + w)
    }
    return
  }
  // One arm, from the cell's `edge` to past its middle, between the arms
  // on either side of it.
  const arm = (
    weight: number,
    vertical: boolean,
    edge: number,
    sideA: number,
    sideB: number
  ) => {
    if (weight === 0) return
    const centre = vertical ? cx : cy
    const mid = vertical ? cy : cx
    const toward = edge > mid ? 1 : -1
    // A line `offset` from the middle, reaching `past` it.
    const line = (offset: number, past: number, w: number) => {
      const from = mid - toward * past
      const a = centre + offset - w / 2
      if (vertical) fill(context, ratio, a, from, a + w, edge)
      else fill(context, ratio, from, a, edge, a + w)
    }
    if (weight !== 3)
      return line(0, Math.max(thick[sideA], thick[sideB]) / 2, thick[weight])
    // Double: two light lines a light line apart. A line stops at the arm
    // on its side; with none there, it reaches the outer edge of the arm on
    // the other side, so the corner closes.
    const past = (side: number, other: number) =>
      side ? (side === 3 ? -t / 2 : 0) : thick[other] / 2
    line(-t, past(sideA, sideB), t)
    line(t, past(sideB, sideA), t)
  }
  arm(up, true, top, leftArm, right)
  arm(down, true, top + height, leftArm, right)
  arm(leftArm, false, left, up, down)
  arm(right, false, left + width, up, down)
}

function arc(context: CanvasRenderingContext2D, code: number, cell: Cell) {
  const { left, top, width, height, ratio } = cell
  const t = light(cell)
  const cx = middle(left, width, t, ratio)
  const cy = middle(top, height, t, ratio)
  // ╭ ╮ ╯ ╰: the corner the arc turns toward.
  const [x, y] = {
    0x256d: [left + width, top + height],
    0x256e: [left, top + height],
    0x256f: [left, top],
    0x2570: [left + width, top],
  }[code] as [number, number]
  const r = Math.min(width, height) / 2
  context.save()
  context.strokeStyle = context.fillStyle
  context.lineWidth = t
  context.beginPath()
  context.moveTo(cx, y)
  context.lineTo(cx, cy + Math.sign(y - cy) * r)
  context.arcTo(cx, cy, cx + Math.sign(x - cx) * r, cy, r)
  context.lineTo(x, cy)
  context.stroke()
  context.restore()
}

function diagonal(context: CanvasRenderingContext2D, code: number, cell: Cell) {
  const { left, top, width, height } = cell
  context.save()
  context.strokeStyle = context.fillStyle
  context.lineWidth = light(cell)
  context.beginPath()
  if (code !== 0x2572) {
    context.moveTo(left + width, top)
    context.lineTo(left, top + height)
  }
  if (code !== 0x2571) {
    context.moveTo(left, top)
    context.lineTo(left + width, top + height)
  }
  context.stroke()
  context.restore()
}

function block(context: CanvasRenderingContext2D, code: number, cell: Cell) {
  const { left, top, width, height, ratio } = cell
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    fill(
      context,
      ratio,
      left + x0 * width,
      top + y0 * height,
      left + x1 * width,
      top + y1 * height
    )
  if (code === 0x2580) return rect(0, 0, 1, 0.5)
  if (code <= 0x2588) return rect(0, 1 - (code - 0x2580) / 8, 1, 1)
  if (code <= 0x258f) return rect(0, 0, (0x2590 - code) / 8, 1)
  if (code === 0x2590) return rect(0.5, 0, 1, 1)
  if (code <= 0x2593) {
    // Shades: the whole cell, a quarter, a half or three quarters seen.
    context.save()
    context.globalAlpha *= (code - 0x2590) / 4
    rect(0, 0, 1, 1)
    context.restore()
    return
  }
  if (code === 0x2594) return rect(0, 0, 1, 1 / 8)
  if (code === 0x2595) return rect(7 / 8, 0, 1, 1)
  const quadrants = QUADRANTS[code - 0x2596]
  if (quadrants & 1) rect(0, 0, 0.5, 0.5)
  if (quadrants & 2) rect(0.5, 0, 1, 0.5)
  if (quadrants & 4) rect(0, 0.5, 0.5, 1)
  if (quadrants & 8) rect(0.5, 0.5, 1, 1)
}

function braille(context: CanvasRenderingContext2D, dots: number, cell: Cell) {
  const { left, top, width, height, ratio } = cell
  const size = Math.max(
    1 / ratio,
    onDevicePixel(Math.min(width / 2, height / 4) * 0.5, ratio)
  )
  for (let bit = 0; bit < 8; bit++) {
    if (!(dots & (1 << bit))) continue
    const [column, row] = DOTS[bit]
    context.fillRect(
      onDevicePixel(left + ((column + 0.5) * width) / 2 - size / 2, ratio),
      onDevicePixel(top + ((row + 0.5) * height) / 4 - size / 2, ratio),
      size,
      size
    )
  }
}

// A font insets or scales these, leaving a gap where the triangle should
// meet the next cell; filled from the cell's edges, they meet it.
function powerline(
  context: CanvasRenderingContext2D,
  code: number,
  cell: Cell
) {
  const { left, top, width, height } = cell
  const right = left + width
  const [base, point] = code === POWERLINE_RIGHT ? [left, right] : [right, left]
  context.beginPath()
  context.moveTo(base, top)
  context.lineTo(point, top + height / 2)
  context.lineTo(base, top + height)
  context.closePath()
  context.fill()
}
