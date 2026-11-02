/**
 * The agents module's part in the window's main process (ADR 0028): it
 * serves the Visuals Agents show in their Threads at `app://visuals`, and
 * lays a page out for the check before one shows (ADR 0037). It answers
 * no channel of the bridge.
 */
import { VISUALS } from "@banda/agents-pane/visual"
import type { DesktopModule, Engine, Look } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import { lay_out } from "./preview"
import { served } from "./visuals"

export const agentsDesktop: DesktopModule<object, never, Engine | Look> = {
  layer: Layer.empty,
  answers: {},
  asked: { lay_out },
  served: { [VISUALS]: served },
  opened: () => Effect.void,
}
