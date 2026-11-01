/**
 * The desktop's side of `sidebar.toml` (ADR 0008, decision 6): the view
 * menu writes the preset into the file, and "Edit sidebar.toml" opens it.
 * `bandaso look --follow` sees the change and hands the page the new
 * arrangement, so the page never reads or writes files itself.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { withPreset } from "@bandaso/contract/sidebar"
import TEMPLATE from "../../../look/sidebar.toml"

/** Names the preset `name` in `file`, keeping every other line; a file
 * that is not there yet starts from Banda's template. */
export function writePreset(file: string, name: string): void {
  const text = existsSync(file) ? readFileSync(file, "utf8") : TEMPLATE
  write(file, withPreset(text, name))
}

/** `file`, there for the Person to edit: the template when it was not. */
export function ensure(file: string): void {
  if (!existsSync(file)) write(file, TEMPLATE)
}

/** Writes whole or not at all, so the follower never reads half a file;
 * a file that is a link stays one, and its target changes. */
function write(file: string, text: string): void {
  const target = existsSync(file) ? realpathSync(file) : file
  mkdirSync(dirname(target), { recursive: true })
  const next = `${target}.${process.pid}.new`
  writeFileSync(next, text)
  renameSync(next, target)
}
