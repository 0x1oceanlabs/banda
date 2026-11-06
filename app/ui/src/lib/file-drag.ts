/**
 * Files dragged from Banda (ADR 0073, decision 10): Files' rows go into a
 * Thread's composer as `@` chips, and out to other apps as the files.
 *
 * In Banda's desktop window main runs the drag (`files.drag`), so another
 * app gets the files themselves; the page notes which they are, and a
 * composer they come back to names them rather than copying them in, as
 * it does files from another app. Elsewhere the page runs it: it carries
 * Banda's own type, the whole paths as JSON, and the paths as plain text,
 * a line each, for anything else it lands on.
 */
import { filesHost } from "../desktop"
import { nameAndFolder } from "./paths"

/** Banda's own type: the whole paths, as JSON. */
export const PATHS = "application/x-banda-paths"

/** The files main drags out now, by their whole paths. */
let out: readonly string[] | null = null

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

/** Whether a drag over the page may be Banda's files: while it is over
 * the page, only its types can be read. Main's drag shows as files. */
export function carries(data: DataTransfer): boolean {
  return data.types.includes(PATHS)
}

/** Whether a drag may bring Banda's files: its own type, or files, which
 * main's drag brings back. */
export function bringsFiles(data: DataTransfer | null): boolean {
  return data !== null && (carries(data) || data.types.includes("Files"))
}

/** The whole paths of Banda's files dropped: those a drag the page ran
 * carries, or the files main drags out, come back; none for any other. */
export function droppedPaths(data: DataTransfer): readonly string[] | null {
  return carried(data) ?? droppedBack(data.files)
}

/** The whole paths a drag the page ran carries; none for any other. */
function carried(data: DataTransfer): string[] | null {
  try {
    const paths: unknown = JSON.parse(data.getData(PATHS))
    return Array.isArray(paths) &&
      paths.length > 0 &&
      paths.every((path) => typeof path === "string" && path.startsWith("/"))
      ? paths
      : null
  } catch {
    return null
  }
}

/** Notes that main now drags the files at the whole `paths` out: until
 * they are dropped back, or the pointer moves with no button held, as it
 * does once the drag ended elsewhere. */
function draggingOut(paths: readonly string[]): void {
  out = paths
  const done = (event: PointerEvent) => {
    if (event.buttons !== 0) return
    window.removeEventListener("pointermove", done, true)
    if (out === paths) out = null
  }
  window.addEventListener("pointermove", done, true)
}

/** A path's name, a folder's without its `/`. */
const nameOf = (path: string) => nameAndFolder(path.replace(/\/$/, "")).name

/** The whole paths of `files` dropped on the page, when they are the ones
 * main drags out, by their names; none for any other. */
function droppedBack(files: ArrayLike<File>): readonly string[] | null {
  if (!out) return null
  const names = Array.from(files, (file) => file.name).sort()
  const ours = out.map(nameOf).sort()
  if (names.length !== ours.length || names.some((name, n) => name !== ours[n]))
    return null
  const back = out
  out = null
  return back
}
