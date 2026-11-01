/** Writing the Person's files so that no reader ever sees half of one. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"

/** Writes whole or not at all, so the look's follower never reads half a
 * file; a file that is a link stays one, and its target changes. */
export function writeWhole(file: string, text: string): void {
  const target = existsSync(file) ? realpathSync(file) : file
  mkdirSync(dirname(target), { recursive: true })
  const next = `${target}.${process.pid}.new`
  writeFileSync(next, text)
  renameSync(next, target)
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
