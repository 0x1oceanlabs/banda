/** The files module's window part (ADR 0073): a file in its Pane, the
 * Banda menu's files, and the action every link to a file opens one by. */
import type { ProjectId } from "@banda/contract"
import { defineModule } from "@banda/ui/module"
import { filePane, openFile } from "./FilePane"
import { filesSource } from "./sources"

export const files = defineModule({
  id: "files",
  engine: true,
  panes: [filePane],
  actions: [
    {
      // A file by its path, at a line: what the window's `file.open`
      // runs for a reply's path or a terminal's (ADR 0063, decision 2),
      // beside the Pane it was opened from.
      id: "files.open",
      title: "Open a file",
      section: "Panes",
      unlisted: true,
      run: (window, args = {}) => {
        const { file, line, project } = args
        if (typeof file !== "string") return
        openFile(
          window,
          file,
          typeof line === "number" ? line : null,
          typeof project === "string" ? (project as ProjectId) : undefined
        )
      },
    },
  ],
  sources: [filesSource],
})
