/**
 * The agents module's part in the window's main process (ADR 0028): it
 * serves the Visuals Agents show in their Threads at `app://visuals`
 * (ADR 0037), read from the engine. It answers no channel of the bridge,
 * and its engine part asks nothing yet.
 */
import { VISUALS } from "@banda/agents-pane/visual"
import type { DesktopModule, Engine } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import { served } from "./visuals"

export const agentsDesktop: DesktopModule<object, never, Engine> = {
  layer: Layer.empty,
  answers: {},
  asked: {},
  served: { [VISUALS]: served },
  opened: () => Effect.void,
}
