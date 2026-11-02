/**
 * A module's part in the window's main process (ADR 0028, decision 4):
 * its services as one layer over main's, its answers to its channels of
 * the bridge's table, and what it does as Banda's window opens.
 */
import type { Effect, Layer } from "effect"
import type { WebContents } from "electron"
import type { Answers } from "./ipc"

export type DesktopModule<Table, Services, Needs> = {
  readonly layer: Layer.Layer<Services, never, Needs>
  readonly answers: Answers<Table, Services | Needs>
  /** Runs as Banda's window opens, its page in `contents`. */
  readonly opened: (
    contents: WebContents
  ) => Effect.Effect<void, never, Services>
}
