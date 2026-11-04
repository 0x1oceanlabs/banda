/**
 * A terminal's zoom (`@banda/ui/lib/zoom`): its own, kept as its Pane
 * moves between workspaces or pops out, until the window starts again;
 * `terminal.toml` keeps its size. The zoom takes Ctrl+− from the program,
 * as Ghostty's and kitty's do, which readline would read as undo.
 */
import type { TerminalId } from "@banda/contract/terminal"

const zooms = new Map<TerminalId, number>()

/** How much larger `terminal` writes than `terminal.toml` says. */
export function zoomOf(terminal: TerminalId): number {
  return zooms.get(terminal) ?? 1
}

/** Keeps `zoom` for `terminal`, till the window starts again. */
export function keepZoom(terminal: TerminalId, zoom: number): void {
  if (zoom === 1) zooms.delete(terminal)
  else zooms.set(terminal, zoom)
}
