/**
 * Files dropped on Banda (ADR 0073, decision 10): Files' rows go into a
 * Thread's composer as `@` chips, and what drags out comes back here as
 * the same files.
 *
 * In Banda's desktop window main runs the drag (`files.drag`), so another
 * app gets the files themselves; the page notes which they are, and a
 * composer they come back to names them rather than copying them in, as
 * it does files from another app. Elsewhere the page runs it, with
 * Banda's own type: each file with its Project, as JSON.
 *
 * Only the readers are here: a Pane of another machine may draw what
 * reads a drop, as the Diff's tree, and the drag out reaches the desktop
 * (`file-drag-out.ts`; ADR 0106, step 2a).
 */
import { type ProjectFile, readProjectFiles } from "@banda/core"
import { nameAndFolder } from "./paths"

/** Banda's own type: each file with its Project, as JSON. */
export const PATHS = "application/x-banda-paths"

/** The files main drags out now, each with its Project. */
let out: readonly ProjectFile[] | null = null

/** Whether a drag over the page may be Banda's files: while it is over
 * the page, only its types can be read. Main's drag shows as files. */
export function carries(data: DataTransfer): boolean {
  return data.types.includes(PATHS)
}

/** What a drop on a folder does, as a drag over it says: a move, or a
 * copy with a key held or where the drag allows no move, as main's does
 * not. Chromium calls off a drop whose effect its drag did not allow, and
 * a file of another machine would then never hear its refusal. */
export function dropEffectOf(
  data: DataTransfer,
  copy: boolean
): "copy" | "move" {
  const moves = /move|all|uninitialized/i.test(data.effectAllowed)
  return copy || !moves ? "copy" : "move"
}

/** Whether a drag may bring Banda's files: its own type, or files, which
 * main's drag brings back. */
export function bringsFiles(data: DataTransfer | null): boolean {
  return data !== null && (carries(data) || data.types.includes("Files"))
}

/** Banda's files dropped: those a drag the page ran carries, or the
 * files main drags out, come back, each with its Project; none for any
 * other. An old drag of paths alone names no Project, so it is none. */
export function droppedFiles(
  data: DataTransfer
): readonly ProjectFile[] | null {
  return carried(data) ?? droppedBack(data.files)
}

/** The files a drag the page ran carries, parsed; none for any other. */
function carried(data: DataTransfer): ProjectFile[] | null {
  try {
    return readProjectFiles(JSON.parse(data.getData(PATHS)))
  } catch {
    return null
  }
}

/** Notes that main now drags `files` out: until they are dropped back,
 * or the pointer moves with no button held, as it does once the drag
 * ended elsewhere. */
export function draggingOut(files: readonly ProjectFile[]): void {
  out = files
  const done = (event: PointerEvent) => {
    if (event.buttons !== 0) return
    window.removeEventListener("pointermove", done, true)
    if (out === files) out = null
  }
  window.addEventListener("pointermove", done, true)
}

/** A path's name, a folder's without its `/`. */
const nameOf = (path: string) => nameAndFolder(path.replace(/\/$/, "")).name

/** The files main drags out, when they are the ones dropped on the page,
 * by their names; none for any other. */
function droppedBack(files: ArrayLike<File>): readonly ProjectFile[] | null {
  if (!out) return null
  const names = Array.from(files, (file) => file.name).sort()
  const ours = out.map((file) => nameOf(file.path)).sort()
  if (names.length !== ours.length || names.some((name, n) => name !== ours[n]))
    return null
  const back = out
  out = null
  return back
}
