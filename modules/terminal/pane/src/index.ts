/** The terminal module's window part: its Pane, its action, and its widget of the
 * servers started in Banda (ADR 0022, ADR 0044). */
import { defineModule } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { ServersWidget } from "./Servers"
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
      keys: [{ code: "Enter", ctrl: true, alt: true }],
      run: (window) => window.open(paneOf(terminalPane, NEW_TERMINAL)),
    },
  ],
  bar: [
    {
      id: "terminal.ports",
      about:
        "The servers started in Banda: the first one's port and how many more; a click lists them.",
      Widget: ServersWidget,
    },
  ],
})
