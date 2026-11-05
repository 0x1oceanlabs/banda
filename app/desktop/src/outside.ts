/**
 * A file the page opens outside Banda, as a path a Person Ctrl-clicks in a
 * terminal: in the app the system has for it. A program is only shown in
 * its folder, so a click never runs it.
 */
import { type Stats, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import { shell } from "electron"

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
