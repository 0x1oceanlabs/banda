/**
 * The desktop's side of `sidebar.toml` (ADR 0008, decision 6): the view
 * menu writes the preset into the file, and "Edit sidebar.toml" opens it.
 * `banda look --follow` sees the change and hands the page the new
 * arrangement, so the page never reads or writes files itself.
 */
import { existsSync } from "node:fs"
import { withPreset } from "@banda/contract/sidebar"
import TEMPLATE from "../../../look/sidebar.toml"
import { rewrite, writeWhole } from "./whole"

/** Names the preset `name` in `file`, keeping every other line; a file
 * that is not there yet starts from Banda's template. */
export function writePreset(file: string, name: string): void {
  rewrite(file, TEMPLATE, (text) => withPreset(text, name))
}

/** `file`, there for the Person to edit: the template when it was not. */
export function ensure(file: string): void {
  if (!existsSync(file)) writeWhole(file, TEMPLATE)
}
