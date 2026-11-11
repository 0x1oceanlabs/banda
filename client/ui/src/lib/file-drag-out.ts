/**
 * Files dragged out of Banda (ADR 0073, decision 10): Files' rows, to a
 * Thread's Message box as `@` chips and to other apps as the files.
 *
 * In Banda's desktop window main runs the drag (`files.drag`), and the
 * page notes which files they are, for the drop that brings them back
 * (`file-drag.ts`). Elsewhere the page runs it: it carries Banda's own
 * type, each file with its Project as JSON (ADR 0106, decision 5), and
 * the paths as plain text, a line each, for anything else it lands on.
 *
 * It reaches the desktop, as the readers of a drop do not (ADR 0106, step
 * 2a), so what a Pane of another machine draws never imports it.
 */
import type { DeviceFile, ProjectFile } from "@banda/core"
import { filesHost } from "../desktop"
import { draggingOut, PATHS } from "./file-drag"

/** Starts a drag of `files`, as `event` starts: main's, in Banda's
 * desktop window, for files this computer holds (`local`), else the
 * page's, which carries them with their Project for what here can take
 * them. */
export function dragFiles(
  event: DragEvent,
  files: readonly ProjectFile[],
  local: readonly DeviceFile[] | undefined
): void {
  const host = filesHost()
  if (host && local) {
    event.preventDefault()
    draggingOut(files)
    host.drag(local)
  } else if (event.dataTransfer) carry(event.dataTransfer, files)
}

/** Puts `files` on a drag the page runs. A drop on a folder moves them
 * and a held key copies, so the drag allows both: Chromium calls off a
 * drop whose effect the drag did not allow. */
function carry(data: DataTransfer, files: readonly ProjectFile[]): void {
  data.effectAllowed = "copyMove"
  data.setData(PATHS, JSON.stringify(files))
  data.setData("text/plain", files.map((file) => file.path).join("\n"))
}
