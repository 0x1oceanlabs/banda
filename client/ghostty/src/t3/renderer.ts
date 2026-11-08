import {
  GHOSTTY_CELL,
  GHOSTTY_CELL_WIDE,
  GHOSTTY_LINE,
  ghosttyCellTextAt,
  ghosttyCellWide,
  type GhosttyGrid,
  type GhosttySnapshot,
} from "./core";
import { drawGlyph, drawsItself, onDevicePixel } from "../glyphs";

export { onDevicePixel };

export interface GhosttyCellMetrics {
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
}

export interface GhosttyCellRange {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

const DEFAULT_SELECTION_BACKGROUND = "rgba(72, 122, 191, 0.35)";

// Banda: colours are 0xRRGGBB (ADR 0088, step P4); each one's CSS is made once.
const cssColors = new Map<number, string>();

function cssColor(color: number): string {
  let css = cssColors.get(color);
  if (css === undefined) {
    if (cssColors.size > 1024) cssColors.clear();
    css = `rgb(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff})`;
    cssColors.set(color, css);
  }
  return css;
}

// Banda: the lines a cell's style draws over it.
const DECORATIONS = GHOSTTY_CELL.underline | GHOSTTY_CELL.strikethrough | GHOSTTY_CELL.overline;

// Banda: the style bits a run of text shares, besides its foreground.
const TEXT_STYLE = GHOSTTY_CELL.bold | GHOSTTY_CELL.italic | GHOSTTY_CELL.invisible;

function sameTextStyle(grid: GhosttyGrid, left: number, right: number): boolean {
  // Selection only tints the background; splitting text runs shifts glyph spacing when advances differ from cell width.
  return (
    grid.foregrounds[left] === grid.foregrounds[right] &&
    (grid.styles[left]! & TEXT_STYLE) === (grid.styles[right]! & TEXT_STYLE)
  );
}

// Banda: cells by their index in the grid; the run ends by its row's end.
function ghosttyTextRunEnd(grid: GhosttyGrid, start: number, rowEnd: number): number {
  let end = start + 1;
  while (end < rowEnd) {
    if (ghosttyCellWide(grid, end) === GHOSTTY_CELL_WIDE.spacerTail) {
      end += 1;
      continue;
    }
    const text = ghosttyCellTextAt(grid, end);
    if (
      text.length === 0 ||
      // Banda: a glyph the terminal draws itself, powerline's too, is a run of its own.
      drawsItself(text) ||
      !sameTextStyle(grid, end, start)
    )
      break;
    end += 1;
  }
  return end;
}

function fontForCell(style: number, fontSize: number, fontFamily: string): string {
  const italic = (style & GHOSTTY_CELL.italic) !== 0 ? "italic" : "normal";
  const weight = (style & GHOSTTY_CELL.bold) !== 0 ? "700" : "400";
  return `${italic} ${weight} ${fontSize}px ${fontFamily}`;
}

export function measureGhosttyCell(
  context: CanvasRenderingContext2D,
  fontSize: number,
  fontFamily: string,
  // Banda: screen pixels per CSS pixel; a row is whole ones tall (README).
  ratio = globalThis.devicePixelRatio || 1,
): GhosttyCellMetrics {
  context.font = `normal 400 ${fontSize}px ${fontFamily}`;
  const widthMeasurement = context.measureText("M");
  const verticalMeasurement = context.measureText("Mg");
  const ascent = verticalMeasurement.actualBoundingBoxAscent || fontSize;
  const descent = verticalMeasurement.actualBoundingBoxDescent;
  const glyphHeight = ascent + descent;
  const height =
    Math.max(1, Math.round(Math.max(Math.round(fontSize * 1.35), Math.ceil(glyphHeight)) * ratio)) /
    ratio;
  return {
    width: Math.max(1, widthMeasurement.width),
    height,
    baseline: onDevicePixel(Math.round((height - glyphHeight) / 2 + ascent), ratio),
  };
}

export function terminalGridSize(
  width: number,
  height: number,
  metrics: GhosttyCellMetrics,
  padding: number,
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width - padding * 2) / metrics.width)),
    rows: Math.max(1, Math.floor((height - padding * 2) / metrics.height)),
  };
}

export interface GhosttyRenderOptions {
  readonly context: CanvasRenderingContext2D;
  readonly snapshot: GhosttySnapshot;
  readonly metrics: GhosttyCellMetrics;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly ligatures?: boolean;
  /** Banda: the screen's pixels per CSS pixel, for the edges drawn on them. */
  readonly ratio?: number;
  readonly padding: number;
  /** Banda: every row may differ from what the canvas shows, not just the dirty ones. */
  readonly forceFull: boolean;
  readonly cursorOn: boolean;
  readonly focused?: boolean;
  readonly selectionBackground?: string;
  readonly hoveredLinkRange?: GhosttyCellRange | null;
  readonly originY?: number;
}

/** Banda: a frame's options, worked out once for the rows it draws. */
interface Frame {
  readonly context: CanvasRenderingContext2D;
  readonly snapshot: GhosttySnapshot;
  readonly grid: GhosttyGrid;
  readonly metrics: GhosttyCellMetrics;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly padding: number;
  readonly originY: number;
  readonly ratio: number;
  readonly focused: boolean;
  readonly selectionBackground: string;
  readonly hoveredLinkRange: GhosttyCellRange | null;
  readonly cellX: (column: number) => number;
}

function frameOf(options: GhosttyRenderOptions): Frame {
  const { padding, metrics } = options;
  const ratio = options.ratio ?? 1;
  return {
    context: options.context,
    snapshot: options.snapshot,
    grid: options.snapshot.grid,
    metrics,
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    padding,
    originY: options.originY ?? padding,
    ratio,
    focused: options.focused ?? true,
    selectionBackground: options.selectionBackground ?? DEFAULT_SELECTION_BACKGROUND,
    hoveredLinkRange: options.hoveredLinkRange ?? null,
    // Banda: a cell's edge on a screen pixel's, so two side by side share it.
    cellX: (column) => onDevicePixel(padding + column * metrics.width, ratio),
  };
}

function cellOf(frame: Frame, column: number, top: number) {
  return {
    left: frame.cellX(column),
    top,
    width: frame.cellX(column + 1) - frame.cellX(column),
    height: frame.metrics.height,
    ratio: frame.ratio,
    fontSize: frame.fontSize,
  };
}

/** Whether `row` of the hovered link's range has `column`. */
function inLink(range: GhosttyCellRange | null, row: number, column: number): boolean {
  return (
    range !== null &&
    row >= range.start.y &&
    row <= range.end.y &&
    (row > range.start.y || column >= range.start.x) &&
    (row < range.end.y || column <= range.end.x)
  );
}

// Banda: T3's drawing of one row, cut out of its loop so each way of
// choosing the rows draws them alike; the row's cells by their index in
// the grid (ADR 0088, step P4).
function drawRow(frame: Frame, rowIndex: number): void {
  const { context, snapshot, grid, metrics, fontSize, fontFamily, padding, cellX } = frame;
  const { cols, foregrounds, backgrounds, styles } = grid;
  const top = frame.originY + rowIndex * metrics.height;
  const rowStart = rowIndex * cols;
  const rowEnd = rowStart + cols;

  // Banda: the whole width, padding too, so no half pixel at either edge
  // keeps what a cursor left there.
  context.clearRect(0, top, context.canvas.width, metrics.height);

  let backgroundStart = rowStart;
  while (backgroundStart < rowEnd) {
    const background = backgrounds[backgroundStart]!;
    const selected = styles[backgroundStart]! & GHOSTTY_CELL.selected;
    let backgroundEnd = backgroundStart + 1;
    while (
      backgroundEnd < rowEnd &&
      (styles[backgroundEnd]! & GHOSTTY_CELL.selected) === selected &&
      backgrounds[backgroundEnd] === background
    ) {
      backgroundEnd += 1;
    }
    if (selected || background !== snapshot.background) {
      const left = cellX(backgroundStart - rowStart);
      const width = cellX(backgroundEnd - rowStart) - left;
      if (background !== snapshot.background) {
        context.fillStyle = cssColor(background);
        context.fillRect(left, top, width, metrics.height);
      }
      if (selected) {
        context.fillStyle = frame.selectionBackground;
        context.fillRect(left, top, width, metrics.height);
      }
    }
    backgroundStart = backgroundEnd;
  }

  let runStart = rowStart;
  while (runStart < rowEnd) {
    const firstText = ghosttyCellTextAt(grid, runStart);
    if (firstText.length === 0) {
      runStart += 1;
      continue;
    }
    const style = styles[runStart]!;
    const invisible = (style & GHOSTTY_CELL.invisible) !== 0;
    if (drawsItself(firstText)) {
      if (!invisible) {
        context.fillStyle = cssColor(foregrounds[runStart]!);
        drawGlyph(context, firstText, cellOf(frame, runStart - rowStart, top));
      }
      runStart += 1;
      continue;
    }
    const runEnd = ghosttyTextRunEnd(grid, runStart, rowEnd);
    let text = firstText;
    for (let cell = runStart + 1; cell < runEnd; cell += 1) text += ghosttyCellTextAt(grid, cell);
    if (!invisible && text.trim().length > 0) {
      const left = padding + (runStart - rowStart) * metrics.width;
      context.save();
      context.beginPath();
      context.rect(left, top, (runEnd - runStart) * metrics.width, metrics.height);
      context.clip();
      context.font = fontForCell(style, fontSize, fontFamily);
      context.fillStyle = cssColor(foregrounds[runStart]!);
      context.fillText(text, left, top + metrics.baseline, (runEnd - runStart) * metrics.width);
      context.restore();
    }
    runStart = runEnd;
  }

  for (let column = 0; column < cols; column += 1) {
    const style = styles[rowStart + column]!;
    const hoveredLink = inLink(frame.hoveredLinkRange, rowIndex, column);
    if ((style & DECORATIONS) === 0 && !hoveredLink) continue;
    context.fillStyle = cssColor(foregrounds[rowStart + column]!);
    const { left, width } = cellOf(frame, column, top);
    if ((style & GHOSTTY_CELL.underline) !== 0 || hoveredLink) {
      context.fillRect(left, top + metrics.height - 2, width, 1);
    }
    if ((style & GHOSTTY_CELL.strikethrough) !== 0) {
      context.fillRect(left, top + Math.floor(metrics.height * 0.55), width, 1);
    }
    if ((style & GHOSTTY_CELL.overline) !== 0) context.fillRect(left, top + 1, width, 1);
  }
}

/** Whether the cursor draws its cell's glyph, which is not clipped to its row. */
function cursorDrawsGlyph(frame: Frame, cursor: number | null): boolean {
  const { snapshot, grid } = frame;
  return (
    cursor !== null &&
    frame.focused &&
    snapshot.cursorStyle !== 0 &&
    snapshot.cursorStyle !== 2 &&
    snapshot.cursorStyle !== 3 &&
    snapshot.cursorX < grid.cols &&
    ghosttyCellTextAt(grid, cursor * grid.cols + snapshot.cursorX).length > 0
  );
}

function drawCursor(frame: Frame): void {
  const { context, snapshot, grid, metrics } = frame;
  const top = frame.originY + snapshot.cursorY * metrics.height;
  // Banda: on the cell's edges, as its background and glyph are.
  const under = cellOf(frame, snapshot.cursorX, top);
  const { left, width } = under;
  context.fillStyle = cssColor(snapshot.cursor);
  if (!frame.focused) {
    context.strokeStyle = cssColor(snapshot.cursor);
    context.strokeRect(left + 0.5, top + 0.5, width - 1, metrics.height - 1);
  } else if (snapshot.cursorStyle === 0) {
    context.fillRect(left, top, 2, metrics.height);
  } else if (snapshot.cursorStyle === 2) {
    context.fillRect(left, top + metrics.height - 2, width, 2);
  } else if (snapshot.cursorStyle === 3) {
    context.strokeStyle = cssColor(snapshot.cursor);
    context.strokeRect(left + 0.5, top + 0.5, width - 1, metrics.height - 1);
  } else {
    context.fillRect(left, top, width, metrics.height);
    const index = snapshot.cursorY * grid.cols + snapshot.cursorX;
    const text =
      snapshot.cursorY < grid.rows && snapshot.cursorX < grid.cols
        ? ghosttyCellTextAt(grid, index)
        : "";
    if (text) {
      context.fillStyle = cssColor(snapshot.background);
      if (drawsItself(text)) {
        drawGlyph(context, text, under);
      } else {
        context.font = fontForCell(grid.styles[index]!, frame.fontSize, frame.fontFamily);
        context.fillText(text, left, top + metrics.baseline, width);
      }
    }
  }
}

/** Banda: what a row of the canvas shows, besides its cells. */
const NONE = -1;

/** Banda: what the canvas shows, row by row, as the renderer drew it. */
interface Drawn {
  /** What every row's pixels depend on, but its own cells and marks. */
  readonly key: string;
  readonly cols: number;
  readonly rows: number;
  readonly codes: Uint32Array;
  readonly foregrounds: Uint32Array;
  readonly backgrounds: Uint32Array;
  readonly styles: Uint16Array;
  readonly graphemes: (string | undefined)[];
  readonly hashes: Uint32Array;
  /** The cursor drawn on each row, as `cursorKey` has it, or NONE. */
  readonly cursors: Float64Array;
  /** The hovered link's columns underlined on each row, as `linkKey`, or NONE. */
  readonly links: Float64Array;
}

function drawnOf(key: string, cols: number, rows: number): Drawn {
  const cells = cols * rows;
  return {
    key,
    cols,
    rows,
    codes: new Uint32Array(cells),
    foregrounds: new Uint32Array(cells),
    backgrounds: new Uint32Array(cells),
    styles: new Uint16Array(cells),
    graphemes: new Array<string | undefined>(cells),
    hashes: new Uint32Array(rows),
    cursors: new Float64Array(rows).fill(NONE),
    links: new Float64Array(rows).fill(NONE),
  };
}

/** Whether `row` of the grid has the cells `drawnRow` of the canvas shows. */
function sameCells(grid: GhosttyGrid, row: number, drawn: Drawn, drawnRow: number): boolean {
  if (grid.hashes[row] !== drawn.hashes[drawnRow]) return false;
  const cols = grid.cols;
  const from = row * cols;
  const at = drawnRow * cols;
  for (let column = 0; column < cols; column += 1) {
    const cell = from + column;
    const shown = at + column;
    if (
      grid.codes[cell] !== drawn.codes[shown] ||
      grid.styles[cell] !== drawn.styles[shown] ||
      grid.foregrounds[cell] !== drawn.foregrounds[shown] ||
      grid.backgrounds[cell] !== drawn.backgrounds[shown] ||
      ((grid.styles[cell]! & GHOSTTY_CELL.grapheme) !== 0 &&
        grid.graphemes[cell] !== drawn.graphemes[shown])
    ) {
      return false;
    }
  }
  return true;
}

/** Moves the rows `drawn` holds by `rows`, as the canvas's pixels moved. */
function moveDrawn(drawn: Drawn, rows: number): void {
  const { cols } = drawn;
  const [to, from, end] = rows > 0 ? [0, rows, drawn.rows] : [-rows, 0, drawn.rows + rows];
  for (const cells of [drawn.codes, drawn.foregrounds, drawn.backgrounds, drawn.styles]) {
    cells.copyWithin(to * cols, from * cols, end * cols);
  }
  drawn.graphemes.copyWithin(to * cols, from * cols, end * cols);
  for (const marks of [drawn.hashes, drawn.cursors, drawn.links]) marks.copyWithin(to, from, end);
}

/**
 * Banda: whether T3's drawing of a row is the same pixels on every row, so a
 * row's pixels are its own and move with it (ADR 0088, step P4). The
 * drawing is in CSS pixels and rounds its edges onto screen pixels. That
 * rounds alike on every row only where every edge it rounds is exact: where
 * the screen's scale is a power of two, 1 or 2, and the rows' height and
 * origin are whole screen pixels. Anywhere else, 1.25, 1.5 or the 1.6 that
 * Chromium reports as 1.600000023841858, a screen pixel is no binary
 * fraction of a CSS pixel: an edge half way between two screen pixels
 * rounds up on one row and down on the next, a strike or a block's edge a
 * pixel lower there, and an edge on a screen pixel's lands a hair past it,
 * so a cursor's outline or a clear leaves 1 in 255 on the row beside it
 * until that row is drawn again. The pixel fuzz finds both
 * (`tools/pixel-fuzz`).
 */
export function rowsDrawAlike(ratio: number, height: number, originY: number): boolean {
  return (
    ratio > 0 &&
    2 ** Math.round(Math.log2(ratio)) === ratio &&
    Number.isInteger(height * ratio) &&
    Number.isInteger(originY * ratio)
  );
}

/**
 * Banda: draws a terminal's snapshots on its canvas, and keeps what each of
 * the canvas's rows shows, so a frame draws only the rows that differ from
 * it, and a screen that scrolled moves its pixels by the rows it scrolled
 * and draws only the rows that came in (ADR 0088, step P4).
 *
 * That holds where a row's pixels are those of its cells, its cursor and
 * its part of a hovered link, alone, and the same on every row
 * (`rowsDrawAlike`): its text is clipped to it, every other glyph and line
 * stays in its cell, and a row starts on a screen pixel's edge and is whole
 * ones tall. So a row equal to the one drawn, or to one drawn some rows
 * away and moved here, needs no drawing. A diagonal's ends stand a little
 * past its row (`drawsPastRow`), and so may the glyph a block cursor draws:
 * while the canvas may show one, it draws as T3's renderer did, the rows
 * libghostty-vt marks dirty and the cursor's, until a frame draws every row
 * and none is left. At a scale where rows do not draw alike it always
 * draws as T3's did, so its pixels are T3's there too.
 */
export class GhosttyRenderer {
  private drawn: Drawn | null = null;
  /** The row the last frame drew the cursor on, as T3's renderer kept it. */
  private cursorRow: number | null = null;
  /** The canvas may show a glyph drawn past its row. */
  private bleeding = false;
  /** The padding above and below the rows may show one; only a full frame clears it. */
  private stained = false;
  /** Rows draw alike at this scale, row height and origin (`rowsDrawAlike`). */
  private alike = false;

  /** The canvas was cleared, or shows what this did not draw. */
  forget(): void {
    this.drawn = null;
  }

  render(options: GhosttyRenderOptions): void {
    const frame = frameOf(options);
    const { context, snapshot, grid } = frame;
    const key = [
      grid.cols,
      grid.rows,
      frame.metrics.width,
      frame.metrics.height,
      frame.metrics.baseline,
      frame.fontSize,
      frame.fontFamily,
      options.ligatures !== false,
      frame.ratio,
      frame.padding,
      frame.originY,
      snapshot.background,
      frame.selectionBackground,
      context.canvas.width,
      context.canvas.height,
    ].join(" ");
    context.textBaseline = "alphabetic";
    // Banda: with ligatures off, Chromium draws each letter on its own (ADR 0047).
    context.textRendering = options.ligatures === false ? "optimizeSpeed" : "auto";
    const cursor =
      options.cursorOn &&
      snapshot.cursorVisible &&
      snapshot.cursorX >= 0 &&
      snapshot.cursorY >= 0 &&
      snapshot.cursorY < grid.rows
        ? snapshot.cursorY
        : null;
    let bleeds = cursorDrawsGlyph(frame, cursor);
    for (let row = 0; row < grid.rows; row += 1) {
      if ((grid.lines[row]! & GHOSTTY_LINE.bleeds) !== 0) bleeds = true;
    }
    let drawn = this.drawn;
    if (drawn === null || drawn.key !== key) {
      drawn = this.drawn = drawnOf(key, grid.cols, grid.rows);
      this.alike = rowsDrawAlike(frame.ratio, frame.metrics.height, frame.originY);
      this.drawEvery(frame, drawn, cursor, bleeds);
    } else if (!this.alike || this.bleeding || bleeds) {
      if (options.forceFull) this.drawEvery(frame, drawn, cursor, bleeds);
      else this.drawAsT3(frame, drawn, cursor, bleeds);
    } else {
      // T3's full frame clears the padding too, which nothing else draws on.
      if (options.forceFull && this.stained) this.clearPadding(frame);
      this.drawWhatDiffers(frame, drawn, cursor, options.forceFull);
    }
    if (bleeds) this.stained = true;
    this.cursorRow =
      options.cursorOn && snapshot.cursorVisible && snapshot.cursorY >= 0 ? snapshot.cursorY : null;
  }

  /** The canvas cleared, then every row drawn, as T3's full frame. */
  private drawEvery(frame: Frame, drawn: Drawn, cursor: number | null, bleeds: boolean): void {
    // Banda: the default background is left clear, so the Pane's tile shows
    // through it, glass or solid (ADR 0023); only cells of another colour fill.
    const { context } = frame;
    context.save();
    context.resetTransform();
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.restore();
    for (let row = 0; row < frame.grid.rows; row += 1) this.draw(frame, drawn, row, cursor);
    if (cursor !== null) drawCursor(frame);
    this.bleeding = bleeds;
    this.stained = false;
  }

  private clearPadding(frame: Frame): void {
    const { context, grid, metrics, ratio } = frame;
    const canvas = context.canvas;
    const top = Math.round(frame.originY * ratio);
    const bottom = top + grid.rows * Math.round(metrics.height * ratio);
    context.save();
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, top);
    context.clearRect(0, bottom, canvas.width, canvas.height - bottom);
    context.restore();
    this.stained = false;
  }

  /** The rows libghostty-vt marks dirty, the one the cursor left and the
   * cursor's, in T3's order. */
  private drawAsT3(frame: Frame, drawn: Drawn, cursor: number | null, bleeds: boolean): void {
    const { snapshot } = frame;
    const rows = [...snapshot.dirtyRows];
    if (this.cursorRow !== null && !rows.includes(this.cursorRow)) rows.push(this.cursorRow);
    if (snapshot.cursorVisible && snapshot.cursorY >= 0 && !rows.includes(snapshot.cursorY)) {
      rows.push(snapshot.cursorY);
    }
    let every = 0;
    for (const row of rows) {
      if (row < 0 || row >= frame.grid.rows) continue;
      this.draw(frame, drawn, row, cursor);
      every += 1;
    }
    if (cursor !== null) drawCursor(frame);
    // Every row drawn again, and none past its row: the canvas is as a whole
    // frame would draw it, but its padding.
    this.bleeding = bleeds || every < frame.grid.rows;
  }

  /** The rows whose cells or marks differ from what the canvas shows; a
   * scroll moved first. Every row is looked at after a scroll, or when the
   * surface asks for a full frame; else those that may have changed. */
  private drawWhatDiffers(frame: Frame, drawn: Drawn, cursor: number | null, every: boolean): void {
    const { snapshot, grid } = frame;
    const moved = snapshot.dirtyRows.size > 2 ? this.scroll(frame, drawn) : 0;
    const rows =
      moved !== 0 || every
        ? null
        : new Set([
            ...snapshot.dirtyRows,
            ...(this.cursorRow === null ? [] : [this.cursorRow]),
            ...(cursor === null ? [] : [cursor]),
            ...this.linkRows(frame, drawn),
          ]);
    let cursorDrawn = false;
    for (let row = 0; row < grid.rows; row += 1) {
      if (rows !== null && !rows.has(row)) continue;
      if (
        sameCells(grid, row, drawn, row) &&
        drawn.cursors[row] === this.cursorKey(frame, cursor, row) &&
        drawn.links[row] === linkKey(frame.hoveredLinkRange, row)
      ) {
        continue;
      }
      this.draw(frame, drawn, row, cursor);
      if (row === cursor) cursorDrawn = true;
    }
    if (cursorDrawn) drawCursor(frame);
  }

  /** Draws `row`, and keeps what it drew. */
  private draw(frame: Frame, drawn: Drawn, row: number, cursor: number | null): void {
    drawRow(frame, row);
    const { grid } = frame;
    const from = row * grid.cols;
    const end = from + grid.cols;
    drawn.codes.set(grid.codes.subarray(from, end), from);
    drawn.foregrounds.set(grid.foregrounds.subarray(from, end), from);
    drawn.backgrounds.set(grid.backgrounds.subarray(from, end), from);
    drawn.styles.set(grid.styles.subarray(from, end), from);
    for (let cell = from; cell < end; cell += 1) {
      if ((grid.styles[cell]! & GHOSTTY_CELL.grapheme) !== 0) {
        drawn.graphemes[cell] = grid.graphemes[cell];
      }
    }
    drawn.hashes[row] = grid.hashes[row]!;
    drawn.cursors[row] = this.cursorKey(frame, cursor, row);
    drawn.links[row] = linkKey(frame.hoveredLinkRange, row);
  }

  /** The cursor as it is drawn on `row`, as one number; NONE off it. */
  private cursorKey(frame: Frame, cursor: number | null, row: number): number {
    if (cursor !== row) return NONE;
    const { snapshot } = frame;
    // Its column, style and focus in the low 21 bits, its colour above.
    return (
      snapshot.cursorX +
      ((snapshot.cursorStyle & 0xf) << 16) +
      (frame.focused ? 1 << 20 : 0) +
      snapshot.cursor * 2 ** 21
    );
  }

  /** The rows a hovered link is drawn on, or was. */
  private linkRows(frame: Frame, drawn: Drawn): number[] {
    const rows: number[] = [];
    for (let row = 0; row < drawn.rows; row += 1) {
      if (drawn.links[row] !== NONE || linkKey(frame.hoveredLinkRange, row) !== NONE) {
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * Works out by how many rows the screen scrolled, from the rows' hashes:
   * each row that changed votes for the distance to a drawn row that hashed
   * the same, but rows as common as blank ones. Moves the canvas's pixels
   * by it where that leaves more rows as they should be than staying does;
   * how far it moved them, up for more than 0.
   */
  private scroll(frame: Frame, drawn: Drawn): number {
    const { grid } = frame;
    const rowsOf = new Map<number, number[]>();
    for (let row = 0; row < drawn.rows; row += 1) {
      const hash = drawn.hashes[row]!;
      const found = rowsOf.get(hash);
      if (found) found.push(row);
      else rowsOf.set(hash, [row]);
    }
    const votes = new Map<number, number>();
    for (let row = 0; row < grid.rows; row += 1) {
      if (grid.hashes[row] === drawn.hashes[row]) continue;
      const found = rowsOf.get(grid.hashes[row]!);
      if (!found || found.length > 3) continue;
      for (const from of found) votes.set(from - row, (votes.get(from - row) ?? 0) + 1);
    }
    let by = 0;
    let most = 0;
    for (const [distance, count] of votes) {
      if (count > most) [by, most] = [distance, count];
    }
    if (by === 0) return 0;
    let staying = 0;
    let moving = 0;
    for (let row = 0; row < grid.rows; row += 1) {
      if (sameCells(grid, row, drawn, row)) staying += 1;
      const from = row + by;
      if (from >= 0 && from < drawn.rows && sameCells(grid, row, drawn, from)) moving += 1;
    }
    if (moving < staying + 2) return 0;
    this.blit(frame, by);
    moveDrawn(drawn, by);
    return by;
  }

  /** Moves the rows' pixels by `rows`, up for more than 0, on screen pixels. */
  private blit(frame: Frame, rows: number): void {
    const { context, grid, metrics, ratio } = frame;
    const canvas = context.canvas;
    const row = Math.round(metrics.height * ratio);
    const top = Math.round(frame.originY * ratio);
    const height = (grid.rows - Math.abs(rows)) * row;
    const from = rows > 0 ? top + rows * row : top;
    const to = rows > 0 ? top : top - rows * row;
    context.save();
    context.resetTransform();
    context.beginPath();
    context.rect(0, to, canvas.width, height);
    context.clip();
    // The rows' own pixels, alpha too, in place of those below them.
    context.globalCompositeOperation = "copy";
    context.drawImage(canvas, 0, from, canvas.width, height, 0, to, canvas.width, height);
    context.restore();
  }
}

/** The columns of `row` a hovered link underlines, as one number; NONE if none. */
function linkKey(range: GhosttyCellRange | null, row: number): number {
  if (range === null || row < range.start.y || row > range.end.y) return NONE;
  const from = row > range.start.y ? 0 : range.start.x;
  const to = row < range.end.y ? 0xffff : range.end.x;
  return from * 0x10000 + to;
}
