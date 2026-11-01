/**
 * The desktop's side of `sidebar.toml` (ADR 0008, decision 6): "Edit
 * sidebar.toml" opens it, from the template when it is new. The view menu's
 * preset goes through `banda settings set` (settings.ts, ADR 0016).
 */
import { existsSync } from "node:fs"
import TEMPLATE from "../../../look/sidebar.toml"
import { writeWhole } from "./whole"

/** `file`, there for the Person to edit: the template when it was not. */
export function ensure(file: string): void {
  if (!existsSync(file)) writeWhole(file, TEMPLATE)
}
