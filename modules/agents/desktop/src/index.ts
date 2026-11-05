/**
 * The agents module's part in the window's main process (ADR 0028): it
 * serves the Visuals Agents show in their Threads at `app://visuals`, and
 * lays a page out for the check before one shows (ADR 0037). It answers
 * the local media channel of the bridge, and where a reply's paths lead
 * (ADR 0063).
 */
import { AGENTS_BRIDGE } from "@banda/agents-pane/desktop"
import { Files } from "./files"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { Engine } from "@banda/desktop-kit"
import { VISUALS } from "@banda/agents-pane/visual"
import type { DesktopModule, Look } from "@banda/desktop-kit"
import { Effect, Schema } from "effect"
import { findFiles } from "./paths"
import { heights, lay_out } from "./preview"
import { served } from "./visuals"

export const agentsDesktop: DesktopModule<
  typeof AGENTS_BRIDGE,
  Files,
  Engine | Look
> = {
  layer: Files.layer,
  answers: {
    media: [
      Schema.Tuple([Schema.String, Schema.String]),
      ([space, path]) =>
        Effect.gen(function* () {
          // Refuse network, home-relative and URI paths before resolving.
          if (!path || /^(?:~|[a-z][a-z0-9+.-]*:|[/\\]{2})/i.test(path))
            return null
          const folder = yield* folderOf(space)
          if (!folder) return null
          return yield* Files.use((files) => files.issue(resolve(folder, path)))
        }),
    ],
    paths: [
      Schema.Tuple([
        Schema.String,
        Schema.Array(Schema.String),
        Schema.Array(Schema.String),
      ]),
      ([space, paths, worked]) =>
        Effect.gen(function* () {
          const folder = yield* folderOf(space)
          return yield* Effect.promise(() =>
            findFiles(folder, paths, worked, homedir())
          )
        }),
    ],
  },
  asked: { lay_out, heights },
  served: {
    [VISUALS]: served,
    files: (request) => Files.use((files) => files.serve(request)),
  },
  opened: () => Effect.void,
}

/** The folder of the Space, as the engine has it; none for one it does
 * not know. */
const folderOf = (space: string) =>
  Effect.gen(function* () {
    const client = yield* Engine.use((engine) => engine.client)
    const spaces = yield* Effect.promise(() => client.call("spaces.list", {}))
    return spaces.find((one) => one.id === space)?.folder ?? null
  })
