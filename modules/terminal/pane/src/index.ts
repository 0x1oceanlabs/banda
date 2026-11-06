/** The terminal module's window part: its Pane, its action, and its widget of the
 * servers started in Banda (ADR 0022, ADR 0044). */
import { defineModule, zoomActions } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { ServersWidget } from "./Servers"
import { TERMINAL } from "./scopes"
import { NEW_TERMINAL, terminalPane } from "./TerminalPane"

export { terminalPane }
export type { Done, TerminalArgs } from "./TerminalPane"

export const terminal = defineModule({
  id: "terminal",
  engine: true,
  panes: [terminalPane],
  actions: [
    {
      id: "terminal.new",
      title: "New terminal",
      section: "Panes",
      keys: [{ code: "Enter", mod: true, more: true }],
      run: (window) => window.open(paneOf(terminalPane, NEW_TERMINAL)),
    },
    // Its own zoom, Ctrl with + − 0, as Ghostty's and kitty's.
    ...zoomActions(TERMINAL, "terminal", "the terminal", "Terminal"),
  ],
  scopes: [{ id: TERMINAL, title: "Terminal" }],
  bar: [
    {
      id: "terminal.ports",
      about:
        "The servers started in Banda: the first one's port and how many more; a click lists them.",
      Widget: ServersWidget,
    },
  ],
})
