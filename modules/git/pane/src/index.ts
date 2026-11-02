/** The git module's window part: its Diff Pane (ADR 0034). */
import { defineModule } from "@banda/ui/module"
import { diffPane } from "./DiffPane"

export { diffPane }
export type { DiffArgs } from "./DiffPane"

export const git = defineModule({
  id: "git",
  engine: true,
  panes: [diffPane],
})
