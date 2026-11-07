/** The files module's window part (ADR 0073): a folder as a tree, columns
 * or a gallery in `files.tree`, a file in `files.file` drawn by the
 * previewer that claims it, Quick Look over the desk, the Banda menu's
 * files and quick open, and the actions that open them; and the keys of
 * a Files Pane, the actions of its scope (ADR 0071), which do what Files
 * does with files. */
import type { ProjectId } from "@banda/contract"
import { FILES_FILE } from "@banda/contract/files"
import { tomlOf } from "@banda/contract/settings"
import { fileNow } from "@banda/ui/lib/look"
import { actInScope } from "@banda/ui/hooks/use-scope"
import { defineModule, scoped, takes, type WindowApi } from "@banda/ui/module"
import { filePane, openFile, peekFile } from "./FilePane"
import { FILES, KEYS } from "./keys"
import { peeked } from "./peek"
import { PREVIEWERS } from "./previewers"
import { filesSource } from "./sources"
import { openTree, treePane } from "./TreePane"

/** The Thread the focused Pane shows, as the lists name one with its
 * Agent; none for a Pane of no Thread. */
function threadShown(
  window: WindowApi,
  at: NonNullable<ReturnType<WindowApi["focused"]>>
): string | null {
  const listed = window.lists()[at.project] ?? []
  const shown = listed.find((one) => one.id === at.shows)
  return shown?.agent ? shown.id : null
}

/** The id of the Banda menu's source of files, which quick open shows. */
const FIND = filesSource.id

export const files = defineModule({
  id: "files",
  engine: true,
  panes: [treePane, filePane],
  previewers: PREVIEWERS,
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
        // Opened from a Thread, it marks and follows that Thread's turns.
        const thread =
          at && at.project === project ? threadShown(window, at) : null
        openTree(
          window,
          { dir, ...(thread && { thread }) },
          project,
          dir !== ""
        )
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
    {
      // Quick Look (ADR 0073, decision 7): a file by its path, as a
      // reply's path menu asks, over the desk; with none, the focused
      // Files Pane's pick, as Space does there, or Quick Look closes.
      ...scoped(FILES, {
        id: "files.peek",
        title: "Quick Look",
        section: "Files",
        keys: [{ code: "Space" }],
        args: takes({
          file: "the file's whole path, or one from the Project's folder",
          project: "the Project it is in",
        }),
      }),
      run: (window, args = {}) => {
        const { file, project } = args
        if (typeof file === "string")
          peekFile(
            window,
            file,
            typeof project === "string" ? (project as ProjectId) : undefined
          )
        else if (!actInScope(FILES, "files.peek")) peeked()?.()
      },
    },
    {
      // "Open with…": the previewer files of an extension show in, kept
      // in files.toml (ADR 0073, decisions 6 and 13).
      id: "files.previewer",
      title: "Show files of an extension with a previewer",
      section: "Files",
      unlisted: true,
      args: takes(
        {
          extension: "the extension, as md",
          previewer: "the previewer's id, as files.code",
        },
        ["extension", "previewer"]
      ),
      run: (window, args = {}) => {
        const { extension, previewer } = args
        if (typeof extension !== "string" || typeof previewer !== "string")
          return
        void window.writeSetting(
          "files.toml",
          `previewers.${tomlKey(extension.toLowerCase())}`,
          tomlOf(previewer)
        )
      },
    },
    {
      // Quick open (ADR 0073, decision 11): the Banda menu with the focused
      // Project's files alone, what was opened lately first.
      id: "files.quick-open",
      title: "Open a file of the Project",
      section: "Files",
      keys: [{ code: "KeyP", mod: true }],
      run: (window) => window.run("menu.open", { source: FIND }),
    },
    // A Files Pane's own keys, each an action of its scope: F2, Ctrl+⌫,
    // the views' Ctrl+1, 2 and 3, and the rest (`keys.ts`).
    ...KEYS.filter(({ does }) => does !== "peek").map(({ id, title, keys }) =>
      scoped(FILES, { id, title, section: "Files", keys })
    ),
  ],
  scopes: [{ id: FILES, title: "Files" }],
  sources: [filesSource],
})

/** An extension as a key of TOML: bare when it can be. */
function tomlKey(extension: string): string {
  return /^[A-Za-z0-9_-]+$/.test(extension)
    ? extension
    : JSON.stringify(extension)
}
