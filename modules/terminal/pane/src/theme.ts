import type { Color, Theme } from "@bandaso/ghostty"

/**
 * The window's colours as Ghostty takes them, read from the CSS tokens
 * where `element` sits, so a terminal looks like the Pane around it in
 * light and dark. A token may be any CSS colour, `oklch()` included: a
 * canvas turns it into red, green and blue.
 *
 * The look (ADR 0007) also brings the theme's sixteen terminal colours as
 * `--ansi-0` to `--ansi-15`, its cursor and its selection; without them
 * Ghostty keeps its own sixteen and the rest comes from the foreground.
 */
export function themeOf(element: HTMLElement): Theme {
  const style = getComputedStyle(element)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const color = (name: string) => rgb(token(name))
  const foreground = color("--foreground")
  const ansi = Array.from({ length: 16 }, (_, n) => token(`--ansi-${n}`))
  const selection = token("--selection")
  return {
    foreground,
    background: color("--background"),
    cursor: token("--cursor") ? color("--cursor") : foreground,
    selectionBackground:
      selection ||
      `rgba(${foreground.r}, ${foreground.g}, ${foreground.b}, 0.25)`,
    ...(ansi.every(Boolean) && { palette: ansi.map(rgb) }),
  }
}

let probe: CanvasRenderingContext2D | null = null

function rgb(css: string): Color {
  probe ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true })
  if (!probe) return { r: 0, g: 0, b: 0 }
  probe.fillStyle = "#000"
  probe.fillStyle = css.trim()
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return { r, g, b }
}

/** Calls `onChange` when the window turns light or dark, or its look
 * sets new colours on the root (ADR 0007). */
export function onThemeChange(onChange: () => void): () => void {
  const watching = new MutationObserver(onChange)
  watching.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  })
  return () => watching.disconnect()
}
