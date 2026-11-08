import {
  GHOSTTY_CELL,
  GHOSTTY_CELL_WIDE,
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

export function renderGhosttySnapshot(options: {
  readonly context: CanvasRenderingContext2D;
  readonly snapshot: GhosttySnapshot;
  readonly metrics: GhosttyCellMetrics;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly ligatures?: boolean;
  /** Banda: the screen's pixels per CSS pixel, for the edges drawn on them. */
  readonly ratio?: number;
  readonly padding: number;
  readonly forceFull: boolean;
  readonly cursorOn: boolean;
  readonly previousCursorY?: number | null;
  readonly focused?: boolean;
  readonly selectionBackground?: string;
  readonly hoveredLinkRange?: GhosttyCellRange | null;
  readonly originY?: number;
}): void {
  const {
    context,
    snapshot,
    metrics,
    fontSize,
    fontFamily,
    padding,
    forceFull,
    cursorOn,
    previousCursorY,
  } = options;
  const grid = snapshot.grid;
  const { cols, foregrounds, backgrounds, styles } = grid;
  const focused = options.focused ?? true;
  const selectionBackground = options.selectionBackground ?? DEFAULT_SELECTION_BACKGROUND;
  const hoveredLinkRange = options.hoveredLinkRange ?? null;
  const originY = options.originY ?? padding;
  const ratio = options.ratio ?? 1;
  // Banda: a cell's edge on a screen pixel's, so two side by side share it.
  const cellX = (column: number) => onDevicePixel(padding + column * metrics.width, ratio);
  const cellOf = (column: number, top: number) => ({
    left: cellX(column),
    top,
    width: cellX(column + 1) - cellX(column),
    height: metrics.height,
    ratio,
    fontSize,
  });
  const rowsToDraw = forceFull
    ? Array.from({ length: snapshot.rows }, (_, index) => index)
    : [...snapshot.dirtyRows];
  if (
    previousCursorY !== null &&
    previousCursorY !== undefined &&
    previousCursorY >= 0 &&
    !rowsToDraw.includes(previousCursorY)
  ) {
    rowsToDraw.push(previousCursorY);
  }
  if (snapshot.cursorVisible && snapshot.cursorY >= 0 && !rowsToDraw.includes(snapshot.cursorY)) {
    rowsToDraw.push(snapshot.cursorY);
  }

  // Banda: the default background is left clear, so the Pane's tile shows
  // through it, glass or solid (ADR 0023); only cells of another colour fill.
  if (forceFull) {
    context.save();
    context.resetTransform();
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.restore();
  }

  context.textBaseline = "alphabetic";
  // Banda: with ligatures off, Chromium draws each letter on its own (ADR 0047).
  context.textRendering = options.ligatures === false ? "optimizeSpeed" : "auto";
  for (const rowIndex of rowsToDraw) {
    if (rowIndex < 0 || rowIndex >= grid.rows) continue;
    const top = originY + rowIndex * metrics.height;
    // Banda: the row's cells by their index in the grid (ADR 0088, step P4).
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
          context.fillStyle = selectionBackground;
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
          drawGlyph(context, firstText, cellOf(runStart - rowStart, top));
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
      const hoveredLink =
        hoveredLinkRange !== null &&
        rowIndex >= hoveredLinkRange.start.y &&
        rowIndex <= hoveredLinkRange.end.y &&
        (rowIndex > hoveredLinkRange.start.y || column >= hoveredLinkRange.start.x) &&
        (rowIndex < hoveredLinkRange.end.y || column <= hoveredLinkRange.end.x);
      if ((style & DECORATIONS) === 0 && !hoveredLink) continue;
      context.fillStyle = cssColor(foregrounds[rowStart + column]!);
      const { left, width } = cellOf(column, top);
      if ((style & GHOSTTY_CELL.underline) !== 0 || hoveredLink) {
        context.fillRect(left, top + metrics.height - 2, width, 1);
      }
      if ((style & GHOSTTY_CELL.strikethrough) !== 0) {
        context.fillRect(left, top + Math.floor(metrics.height * 0.55), width, 1);
      }
      if ((style & GHOSTTY_CELL.overline) !== 0) context.fillRect(left, top + 1, width, 1);
    }
  }

  if (cursorOn && snapshot.cursorVisible && snapshot.cursorX >= 0 && snapshot.cursorY >= 0) {
    const top = originY + snapshot.cursorY * metrics.height;
    // Banda: on the cell's edges, as its background and glyph are.
    const under = cellOf(snapshot.cursorX, top);
    const { left, width } = under;
    context.fillStyle = cssColor(snapshot.cursor);
    if (!focused) {
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
      const index = snapshot.cursorY * cols + snapshot.cursorX;
      const text =
        snapshot.cursorY < grid.rows && snapshot.cursorX < cols ? ghosttyCellTextAt(grid, index) : "";
      if (text) {
        context.fillStyle = cssColor(snapshot.background);
        if (drawsItself(text)) {
          drawGlyph(context, text, under);
        } else {
          context.font = fontForCell(styles[index]!, fontSize, fontFamily);
          context.fillText(text, left, top + metrics.baseline, width);
        }
      }
    }
  }
}
