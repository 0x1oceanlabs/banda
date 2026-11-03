/** The git module's window part: its Diff Pane, and its rows in a
 * Thread's details (ADR 0034). */
import { defineModule } from "@banda/ui/module"
import { gitDetails } from "./Details"
import { diffPane } from "./DiffPane"

export { diffPane }
export type { DiffArgs } from "./DiffPane"

export const git = defineModule({
  id: "git",
  engine: true,
  panes: [diffPane],
  threadDetails: [gitDetails],
})
