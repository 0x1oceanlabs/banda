/**
 * A file the page opens outside Banda, as a path a Person Ctrl-clicks in a
 * terminal: in the app the system has for it. A program is only shown in
 * its folder, so a click never runs it. And files dragged out of the
 * window, as the files themselves (ADR 0073, decision 10).
 */
import { type Stats, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import {
  app,
  nativeImage,
  type NativeImage,
  shell,
  type WebContents,
} from "electron"

/** Opens the file at the full `path`; nothing for any other. */
export function openFile(path: string): void {
  if (!isAbsolute(path)) return
  const found = statSync(path, { throwIfNoEntry: false })
  if (!found) return
  if (runs(found, path)) shell.showItemInFolder(path)
  else void shell.openPath(path)
}

/** Whether a file or a folder is at the full `path`. */
export function exists(path: string): boolean {
  return isAbsolute(path) && !!statSync(path, { throwIfNoEntry: false })
}

/** Shows the file at the full `path` in its folder; nothing for any
 * other. */
export function showFile(path: string): void {
  if (isAbsolute(path) && statSync(path, { throwIfNoEntry: false }))
    shell.showItemInFolder(path)
}

/** Whether opening the file could run it: a program, or a macOS app. */
export function runs(
  found: Pick<Stats, "isDirectory" | "mode">,
  path: string
): boolean {
  if (found.isDirectory()) return path.endsWith(".app")
  return (found.mode & 0o111) !== 0
}

/** The most files one drag carries. */
const DRAGGED = 200

/** Drags the files at the whole `paths` out of `contents`, as the files
 * themselves, under the system's icon for the first: a folder's path may
 * end with `/`. Any not there are left out. */
export async function dragOut(
  contents: WebContents,
  paths: readonly string[]
): Promise<void> {
  const files = paths
    .slice(0, DRAGGED)
    .map((path) => path.replace(/(.)\/+$/, "$1"))
    .filter(exists)
  if (files.length === 0) return
  const icon = await app
    .getFileIcon(files[0], { size: "normal" })
    .catch(() => null)
  contents.startDrag({
    file: files[0],
    files,
    icon: icon && !icon.isEmpty() ? icon : sheet(),
  })
}

/** A plain sheet of paper, 24 px by 32, for a drag where the system has
 * no icon: Electron starts none without one. */
function sheet(): NativeImage {
  const [width, height] = [24, 32]
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 2; y < height - 2; y++)
    for (let x = 3; x < width - 3; x++) {
      const at = (y * width + x) * 4
      const edge = y === 2 || y === height - 3 || x === 3 || x === width - 4
      // BGRA: a light grey sheet with a darker edge.
      pixels.fill(edge ? 0x80 : 0xe8, at, at + 3)
      pixels[at + 3] = 0xff
    }
  return nativeImage.createFromBitmap(pixels, { width, height })
}
