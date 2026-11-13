import type { ProjectId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { identityOf } from "../registry"
import { focused, samePane, type Workspaces } from "../tiling/model"

/** Whether a Pane is the focused one of `workspaces`, by all its args.
 * Apart from the Window's actions, so what only asks this, as the small
 * inbox does, takes none of them in. */
export function focusedIn(workspaces: Workspaces) {
  const entry = focused(workspaces)
  return (project: ProjectId, pane: PaneState) =>
    entry !== undefined && samePane(entry, { project, pane }, identityOf)
}
