/**
 * A terminal drawn by Ghostty on a canvas. `t3/` is T3 Code's adapter,
 * vendored as it is (see README.md): this file names what the window uses.
 *
 * A host creates a surface in an element, writes what the program printed
 * into it, and hears what the Person types and the size that fits. A
 * snapshot goes in with `resetAndWrite`, which answers none of the
 * queries it replays, so a screen shown again types nothing.
 */
export {
  GhosttyTerminalSurface as Surface,
  type GhosttyTerminalSurfaceOptions as SurfaceOptions,
  type GhosttyTerminalFont as Font,
} from "./t3/surface"
export type { GhosttyTheme as Theme, GhosttyColor as Color } from "./t3/core"
