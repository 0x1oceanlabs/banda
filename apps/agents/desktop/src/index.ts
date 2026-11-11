/**
 * The agents module's part in the window's main process (ADR 0028): it
 * serves the Visuals Agents show in their Threads at `app://visuals`, and
 * lays a page out for the check before one shows (ADR 0037). It answers
 * the local media channel of the bridge, with a token this machine's
 * engine gives (ADR 0106, decision 6).
 */
import { AGENTS_BRIDGE } from "@banda/agents-pane/desktop"
import { Engine } from "@banda/desktop-kit"
import { VISUALS } from "@banda/agents-pane/visual"
import type { DesktopModule, Look } from "@banda/desktop-kit"
import { Effect, Layer, Schema } from "effect"
import { heights, lay_out } from "./preview"
import { served } from "./visuals"

export const agentsDesktop: DesktopModule<
  typeof AGENTS_BRIDGE,
  never,
  Engine | Look
> = {
  layer: Layer.empty,
  answers: {
    // Its paths come from an Agent's text: images, video and sound alone,
    // which the engine judges and serves; main finds no file.
    media: [
      Schema.Tuple([Schema.String, Schema.String]),
      ([project, path]) =>
        Effect.gen(function* () {
          const client = yield* Engine.use((engine) => engine.client)
          const issued = yield* Effect.promise(() =>
            client
              .call("bytes.issue", { path, use: "media" }, { project })
              .catch(() => null)
          )
          return issued?.token ?? null
        }),
    ],
  },
  asked: { lay_out, heights },
  served: { [VISUALS]: served },
  opened: () => Effect.void,
}
