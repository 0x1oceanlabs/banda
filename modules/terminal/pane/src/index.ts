/** The terminal module's window part: its Pane (ADR 0022). */
import { defineModule } from "@banda/ui/module"
import { terminalPane } from "./TerminalPane"

export { terminalPane }
export type { Done, TerminalArgs } from "./TerminalPane"

export const terminal = defineModule({
  id: "terminal",
  engine: true,
  panes: [terminalPane],
})
