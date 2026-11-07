/**
 * An image's zoom and pan: its scale against the size that fits the
 * Pane, and how far its centre moved from the Pane's. Pure, so plain
 * tests cover it.
 */

export type Zoom = { scale: number; x: number; y: number }

/** As it opens: fitting the Pane, in its middle. */
export const FIT: Zoom = { scale: 1, x: 0, y: 0 }

/** The least it zooms out to, against the size that fits. */
export const LEAST = 0.25

/** `zoom` scaled by `factor` around `point`, a place in the Pane from its
 * middle, which stays under the pointer; between `LEAST` and `most`. */
export function zoomAt(
  zoom: Zoom,
  factor: number,
  point: { x: number; y: number },
  most: number
): Zoom {
  const scale = Math.min(Math.max(zoom.scale * factor, LEAST), most)
  const by = scale / zoom.scale
  return {
    scale,
    x: point.x - (point.x - zoom.x) * by,
    y: point.y - (point.y - zoom.y) * by,
  }
}

/** How much a wheel's turn zooms: a mouse's notch (100) about 15%; a
 * pinch, which Chromium sends as the wheel with Ctrl in small steps, as
 * fast as the fingers. */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY / (pinch ? 100 : 600))
}

/** The scale shown, as a share of the image's own pixels: the size that
 * fits, times the zoom. */
export function percentOf(fit: number, zoom: Zoom): string {
  return `${Math.round(fit * zoom.scale * 100)}%`
}
