/** Writing the Person's files so that no reader ever sees half of one. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"

/** Writes whole or not at all, so the look's follower never reads half a
 * file; a file that is a link stays one, and its target changes. A new
 * file takes `mode`. */
export function writeWhole(
  file: string,
  text: string | Uint8Array,
  mode?: number
): void {
  writeWholeIf(file, text, mode, () => true)
}

/** As `writeWhole`, once `still` says, just before the rename, that the
 * file is as its writer read it; else it leaves the file as it is, and
 * says so (false). */
export function writeWholeIf(
  file: string,
  text: string | Uint8Array,
  mode: number | undefined,
  still: () => boolean
): boolean {
  const target = existsSync(file) ? realpathSync(file) : file
  mkdirSync(dirname(target), { recursive: true })
  const next = `${target}.${process.pid}.new`
  writeFileSync(next, text, { mode })
  if (!still()) {
    rmSync(next, { force: true })
    return false
  }
  renameSync(next, target)
  return true
}

/** `file` with `change` made to its text; `template` when it is not there. */
export function rewrite(
  file: string,
  template: string,
  change: (text: string) => string
): void {
  const text = existsSync(file) ? readFileSync(file, "utf8") : template
  writeWhole(file, change(text))
}
