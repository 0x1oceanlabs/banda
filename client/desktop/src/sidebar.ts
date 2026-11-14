/**
 * The desktop's side of `sidebar.toml` (ADR 0008, decision 6): "Edit
 * sidebar.toml" opens it, from the template when it is new. The view menu's
 * keys go through `banda settings set` (settings.ts, ADR 0016).
 */
import { existsSync } from "node:fs"
import TEMPLATE from "../../../platform/look/sidebar.toml"
import { type Answers, Look, none, writeWhole } from "@banda/desktop-kit"
import { Effect } from "effect"
import type { BRIDGE } from "./bridge"
import { Editors } from "./editors"

/** `file`, there for the Person to edit: the template when it was not. */
export function ensure(file: string): void {
  if (!existsSync(file)) writeWhole(file, TEMPLATE)
}

/** Main's answers to the page's channels of `sidebar`. */
export const sidebarAnswers: Answers<typeof BRIDGE.sidebar, Look | Editors> = {
  edit: [
    none,
    () =>
      Effect.gen(function* () {
        const { file } = yield* Look.part("sidebar", "The sidebar's file")
        ensure(file)
        yield* Editors.use((editors) => editors.edit(file))
      }),
  ],
}
