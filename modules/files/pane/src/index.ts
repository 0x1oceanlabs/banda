/** The files module's window part (ADR 0073): a folder as a tree in
 * `files.tree`, a file in `files.file`, the Banda menu's files, and the
 * actions that open them. */
import type { ProjectId } from "@banda/contract"
import { FILES_FILE } from "@banda/contract/files"
import { tomlOf } from "@banda/contract/settings"
import { fileNow } from "@banda/ui/lib/look"
import { type Action, defineModule } from "@banda/ui/module"
import { filePane, openFile } from "./FilePane"
import type { Does } from "./keys"
import { filesSource } from "./sources"
import { askTree, openTree, treePane } from "./TreePane"

/** A Files Pane's own key as an action of the window, for `keys.toml`:
 * it reaches the focused Files Pane, until ADR 0071's scopes come. */
const paneAction = (does: Does, id: string, title: string): Action => ({
  id,
  title,
  section: "Files",
  unlisted: true,
  run: () => askTree(does),
})

export const files = defineModule({
  id: "files",
  engine: true,
  panes: [treePane, filePane],
  actions: [
    {
      // The focused Project's folder as a tree; the Files Pane shown
      // already gets the focus.
      id: "files.tree",
      title: "Files",
      section: "Panes",
      keys: [{ code: "KeyE", mod: true }],
      run: (window, args = {}) => {
        const at = window.focused()
        const asked = typeof args.project === "string" ? args.project : null
        const project = (asked as ProjectId | null) ?? at?.project
        const dir = typeof args.dir === "string" ? args.dir : ""
        openTree(window, { dir }, project, dir !== "")
      },
    },
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
    {
      // Pins a folder among Files' places, or unpins it, in files.toml
      // (ADR 0073, decision 13).
      id: "files.pin",
      title: "Pin a folder in Files",
      section: "Files",
      unlisted: true,
      run: (window, args = {}) => {
        const { dir, pin } = args
        if (typeof dir !== "string") return
        const was = fileNow(FILES_FILE).pinned
        const next =
          pin === false
            ? was.filter((place) => place !== dir)
            : [...was.filter((place) => place !== dir), dir]
        void window.writeSetting("files.toml", "pinned", tomlOf(next))
      },
    },
    paneAction("up", "files.up", "Go to the folder above"),
    paneAction("path", "files.path", "Type a path"),
    paneAction("hidden", "files.hidden", "Show hidden files, or hide them"),
    paneAction("filter", "files.filter", "Filter the files"),
  ],
  sources: [filesSource],
})
