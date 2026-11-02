/**
 * The page's channels into main (ADR 0020, decision 3). Each answers
 * Banda's page alone, decodes what it was sent with a `Schema`, and runs
 * one effect on main's runtime. A channel the page invokes gives back the
 * effect's value, or its error's message; one it only sends to drops a
 * message from elsewhere, or one that does not decode, and says why on
 * stderr.
 */
import { Console, Effect, type ManagedRuntime, Schema } from "effect"
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron"
import { NotFromPage } from "./errors"

/** A channel's arguments, as a tuple. */
type Args = Schema.Codec<ReadonlyArray<unknown>, unknown>

export function channels<R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  fromPage: (url: string) => boolean
) {
  /** What a message on `channel` was sent, decoded, if the page sent it. */
  const heard = <S extends Args>(channel: string, args: S) => {
    const decode = Schema.decodeUnknownEffect(args)
    return (event: IpcMainEvent | IpcMainInvokeEvent, sent: unknown[]) =>
      Effect.gen(function* () {
        if (!fromPage(event.senderFrame?.url ?? ""))
          return yield* new NotFromPage({
            message: `Only Banda's page may use ${channel}.`,
          })
        return yield* decode(sent)
      })
  }

  return {
    /** A channel the page invokes and waits on. */
    handle<S extends Args, A, E>(
      channel: string,
      args: S,
      answer: (
        args: S["Type"],
        event: IpcMainInvokeEvent
      ) => Effect.Effect<A, E, R>
    ) {
      const decoded = heard(channel, args)
      ipcMain.handle(channel, (event, ...sent: unknown[]) =>
        runtime.runPromise(
          Effect.flatMap(decoded(event, sent), (each) => answer(each, event))
        )
      )
    },
    /** A channel the page sends to, and does not wait on. */
    on<S extends Args, E>(
      channel: string,
      args: S,
      answer: (
        args: S["Type"],
        event: IpcMainEvent
      ) => Effect.Effect<void, E, R>
    ) {
      const decoded = heard(channel, args)
      ipcMain.on(channel, (event, ...sent: unknown[]) => {
        runtime.runFork(
          decoded(event, sent).pipe(
            Effect.flatMap((each) => answer(each, event)),
            Effect.catch((error) =>
              Console.error(`banda: ${channel}: ${String(error)}`)
            )
          )
        )
      })
    },
  }
}
