/** The terminal module's window part: its Pane, and its widget of the
 * servers started in Banda (ADR 0022, ADR 0044). */
import { defineModule } from "@banda/ui/module"
import { ServersWidget } from "./Servers"
import { terminalPane } from "./TerminalPane"

export { terminalPane }
export type { Done, TerminalArgs } from "./TerminalPane"

export const terminal = defineModule({
  id: "terminal",
  engine: true,
  panes: [terminalPane],
  bar: [{ id: "terminal.ports", Widget: ServersWidget }],
})
