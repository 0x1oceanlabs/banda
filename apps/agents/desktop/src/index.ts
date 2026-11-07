/**
 * The agents module's part in the window's main process (ADR 0028): it
 * serves the Visuals Agents show in their Threads at `app://visuals`, and
 * lays a page out for the check before one shows (ADR 0037). It answers
 * the local media channel of the bridge, through the byte host, and
 * where a reply's paths lead (ADR 0063).
 */
import { AGENTS_BRIDGE } from "@banda/agents-pane/desktop"
import { homedir } from "node:os"
import { Engine, FileHost } from "@banda/desktop-kit"
import { VISUALS } from "@banda/agents-pane/visual"
import type { DesktopModule, Look } from "@banda/desktop-kit"
import { Effect, Layer, Schema } from "effect"
import { findFiles } from "./paths"
import { heights, lay_out } from "./preview"
import { served } from "./visuals"

export const agentsDesktop: DesktopModule<
  typeof AGENTS_BRIDGE,
  never,
  Engine | Look | FileHost
> = {
  layer: Layer.empty,
  answers: {
    // Its paths come from an Agent's text: images, video and sound alone.
    media: [
      Schema.Tuple([Schema.String, Schema.String]),
      ([project, path]) => FileHost.url(project, path, "media"),
    ],
    paths: [
      Schema.Tuple([
        Schema.String,
        Schema.Array(Schema.String),
        Schema.Array(Schema.String),
      ]),
      ([project, paths, worked]) =>
        Effect.gen(function* () {
          const folder = yield* Engine.folderOf(project)
          return yield* Effect.promise(() =>
            findFiles(folder, paths, worked, homedir())
          )
        }),
    ],
  },
  asked: { lay_out, heights },
  served: { [VISUALS]: served },
  opened: () => Effect.void,
}
