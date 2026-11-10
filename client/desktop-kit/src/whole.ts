/** Writing the Person's files so that no reader ever sees half of one. */
import { randomBytes } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { rename } from "node:fs/promises"
import { dirname } from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

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

/** As `writeWhole`, from `bytes` as they come, so a file of any size is
 * held by the disk and not in memory. If they break off, or the disk
 * refuses them, nothing is left of them and `file` is as it was. */
export async function writeWholeFrom(
  file: string,
  bytes: Readable
): Promise<void> {
  const target = existsSync(file) ? realpathSync(file) : file
  // Its own, since a save can take long enough for a second to start.
  const next = `${target}.${randomBytes(4).toString("hex")}.new`
  try {
    await pipeline(bytes, createWriteStream(next))
    await rename(next, target)
  } catch (error) {
    rmSync(next, { force: true })
    throw error
  }
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
