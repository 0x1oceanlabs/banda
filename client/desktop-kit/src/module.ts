/**
 * A module's part in the window's main process (ADR 0028, decision 4):
 * its services as one layer over main's, its answers to its channels of
 * the bridge's table, its answers to what its engine part asks the window
 * (ADR 0029), and what it does as Banda's window opens.
 */
import type { WindowRequest } from "@banda/contract"
import type { Effect, Layer } from "effect"
import type { WebContents } from "electron"
import type { Refused } from "./errors"
import type { Answers } from "./ipc"

/**
 * What a module's part answers its engine part, which asks through the
 * kernel's road (`Call::ask_window`): by what it asks, without the
 * module's name. A refusal goes back with its code.
 */
export type Asked<R> = Readonly<
  Record<string, (request: WindowRequest) => Effect.Effect<unknown, Refused, R>>
>

/**
 * What a module's part serves at `app://<host>/…`, by host: an origin of
 * its own, apart from Banda's page, which may show it in a frame.
 */
export type Served<R> = Readonly<
  Record<string, (request: Request) => Effect.Effect<Response, never, R>>
>

export type DesktopModule<Table, Services, Needs> = {
  readonly layer: Layer.Layer<Services, never, Needs>
  readonly answers: Answers<Table, Services | Needs>
  readonly asked: Asked<Services | Needs>
  readonly served: Served<Services | Needs>
  /** Runs as Banda's window opens, its page in `contents`. */
  readonly opened: (
    contents: WebContents
  ) => Effect.Effect<void, never, Services>
}
