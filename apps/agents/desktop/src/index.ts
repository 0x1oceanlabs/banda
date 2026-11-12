/**
 * The agents module's part in the window's main process (ADR 0028): it
 * serves the Visuals Agents show in their Threads at `app://visuals`, and
 * lays a page out for the check before one shows (ADR 0037). It has no
 * channel of the bridge: a reply's paths and media go through the Pane's
 * session, as any file's (ADR 0106, steps 3c and 4c).
 */
import { Engine } from "@banda/desktop-kit"
import { VISUALS } from "@banda/agents-pane/visual"
import type { DesktopModule, Look } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import { heights, lay_out } from "./preview"
import { served } from "./visuals"

export const agentsDesktop: DesktopModule<
  Record<never, never>,
  never,
  Engine | Look
> = {
  layer: Layer.empty,
  answers: {},
  asked: { lay_out, heights },
  served: { [VISUALS]: served },
  opened: () => Effect.void,
}
