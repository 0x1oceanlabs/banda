/**
 * Files dragged out of Banda (ADR 0073, decision 10): Files' rows, to a
 * Thread's composer as `@` chips and to other apps as the files.
 *
 * In Banda's desktop window main runs the drag (`files.drag`), and the
 * page notes which files they are, for the drop that brings them back
 * (`file-drag.ts`). Elsewhere the page runs it: it carries Banda's own
 * type, the whole paths as JSON, and the paths as plain text, a line
 * each, for anything else it lands on.
 *
 * It reaches the desktop, as the readers of a drop do not (ADR 0106, step
 * 2a), so what a Pane of another machine draws never imports it.
 */
import { filesHost } from "../desktop"
import { draggingOut, PATHS } from "./file-drag"

/** Starts a drag of the files at the whole `paths`, as `event` starts:
 * main's, in Banda's desktop window, else the page's. */
export function dragFiles(event: DragEvent, paths: readonly string[]): void {
  const host = filesHost()
  if (host) {
    event.preventDefault()
    draggingOut(paths)
    host.drag(paths)
  } else if (event.dataTransfer) carry(event.dataTransfer, paths)
}

/** Puts the whole `paths` on a drag the page runs. */
function carry(data: DataTransfer, paths: readonly string[]): void {
  data.effectAllowed = "copy"
  data.setData(PATHS, JSON.stringify(paths))
  data.setData("text/plain", paths.join("\n"))
}
