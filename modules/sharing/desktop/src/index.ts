/**
 * The sharing module's part in the window's main process (ADR 0028): it
 * posts what the engine part asks it to (post.ts). It answers no channel
 * of the bridge, and serves nothing.
 */
import type { DesktopModule } from "@banda/desktop-kit"
import { Effect, Layer } from "effect"
import { session } from "electron"
import { posting } from "./post"

/** A session that keeps nothing past Banda's run: no `persist:`. */
let made: Electron.Session | undefined
const fetch = () => {
  made ??= session.fromPartition("banda-sharing")
  return made.fetch.bind(made)
}

export const sharingDesktop: DesktopModule<object, never, never> = {
  layer: Layer.empty,
  answers: {},
  asked: { post: posting(fetch) },
  served: {},
  opened: () => Effect.void,
}
