/**
 * The page's channels into main (ADR 0020, decision 3), by the bridge's
 * table (ADR 0028). Each answers Banda's page alone, decodes what it was
 * sent with a `Schema`, and runs one effect on main's runtime. A channel
 * the page invokes gives back the effect's value, or its error's message;
 * one it only sends to drops a message from elsewhere, or one that does
 * not decode, and says why on stderr.
 */
import {
  type Leaf,
  mapTable,
  type Push,
  type Table,
} from "@banda/contract/bridge"
import { Console, Effect, type ManagedRuntime, Schema } from "effect"
import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron"
import { NotFromPage } from "./errors"

/** The types a leaf carries. */
type Types<L> = L extends { types?: infer F }
  ? NonNullable<F> extends (...args: infer A) => infer R
    ? { args: A; reply: R }
    : never
  : never

/**
 * How main answers one channel: the `Schema` its arguments decode with,
 * and the effect it runs on them.
 */
export type Answer<L, R> = readonly [
  args: Schema.Codec<Readonly<Types<L>["args"]>, unknown>,
  answer: (
    args: Readonly<Types<L>["args"]>,
    event: IpcMainEvent | IpcMainInvokeEvent
  ) => Effect.Effect<Types<L>["reply"], unknown, R>,
]

/** One answer for each channel of `T` the page invokes or sends to, nested
 * as the table: the compiler says which is missing. */
export type Answers<T, R> = {
  readonly [
    K in keyof T as T[K] extends { dir: "push" } ? never : K
  ]: T[K] extends {
    dir: "invoke" | "send"
  }
    ? Answer<T[K], R>
    : Answers<T[K], R>
}

/** The arguments of a channel that is sent none. */
export const none = Schema.Tuple([])
/** The arguments of a channel that is sent one string. */
export const text = Schema.Tuple([Schema.String])

type Run<R> = readonly [
  args: Schema.Codec<ReadonlyArray<unknown>, unknown>,
  answer: (
    args: unknown,
    event: IpcMainEvent | IpcMainInvokeEvent
  ) => Effect.Effect<unknown, unknown, R>,
]

/** Answers every channel of `table` the page invokes or sends to. */
export function serve<T extends Table, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  fromPage: (url: string) => boolean,
  table: T,
  answers: Answers<T, R>
) {
  mapTable(table, ({ dir, name }: Leaf, path) => {
    if (dir === "push") return
    const [args, answer] = path
      .split(".")
      .reduce<unknown>(
        (part, key) => (part as Record<string, unknown>)[key],
        answers
      ) as Run<R>
    const decode = Schema.decodeUnknownEffect(args)
    const heard = (event: IpcMainEvent | IpcMainInvokeEvent, sent: unknown[]) =>
      Effect.gen(function* () {
        if (!fromPage(event.senderFrame?.url ?? ""))
          return yield* new NotFromPage({
            message: `Only Banda's page may use ${name}.`,
          })
        return yield* decode(sent)
      })
    if (dir === "invoke")
      ipcMain.handle(name, (event, ...sent: unknown[]) =>
        runtime.runPromise(
          Effect.flatMap(heard(event, sent), (each) => answer(each, event))
        )
      )
    else
      ipcMain.on(name, (event, ...sent: unknown[]) => {
        runtime.runFork(
          heard(event, sent).pipe(
            Effect.flatMap((each) => answer(each, event)),
            Effect.catch((error) =>
              Console.error(`banda: ${name}: ${String(error)}`)
            )
          )
        )
      })
  })
}

/** Tells the page in `contents`, if it is there, a `value` on one of the
 * table's `push` channels. */
export function tellPage<V>(
  contents: WebContents | null | undefined,
  channel: Push<V>,
  value: NoInfer<V>
) {
  contents?.send(channel.name, value)
}
