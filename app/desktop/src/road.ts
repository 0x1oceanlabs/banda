/**
 * The window's end of the kernel's road (ADR 0029, decision 2): main
 * holds `window.requests` as one of the engine's clients, from when it
 * starts, and answers each request with the handler of the module it
 * names (modules.ts), by `window.answer`. The page has no part in it: a
 * module's engine part asks main, which holds the module's pages.
 */
import {
  Engine as Client,
  type JsonValue,
  type Refusal,
  type WindowRequest,
} from "@banda/contract"
import { type Asked, Engine, type Refused } from "@banda/desktop-kit"
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect"

/** Why a handler gave no answer: what it refused, or that it broke. */
const refusalOf = (cause: Cause.Cause<Refused>): Refusal =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: ({ code = "conflict", message }) => ({ code, message }),
    onNone: () => ({
      code: "internal",
      message: "Banda's window broke while it answered.",
    }),
  })

/** Holds the road while main runs; `asked` is each module's answers,
 * under its name. */
export const roadLayer = <R>(asked: Readonly<Record<string, Asked<R>>>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const engine = yield* Engine
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => new Client(() => Effect.runPromise(engine.address))),
        (client) => Effect.sync(() => client.close())
      )
      // The client hears the stream again after the engine restarts; it
      // ends only when a newer window takes the road.
      const requests = Stream.callback<WindowRequest>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            client.stream(
              undefined,
              "window.requests",
              {},
              (request) => Queue.offerUnsafe(queue, request),
              (refusal) => {
                if (refusal)
                  console.error(`The window's road: ${refusal.message}`)
                Queue.endUnsafe(queue)
              }
            )
          ),
          (stop) => Effect.sync(stop)
        )
      )
      const answer = (request: WindowRequest) =>
        Effect.gen(function* () {
          const dot = request.method.indexOf(".")
          const handler =
            asked[request.method.slice(0, dot)]?.[request.method.slice(dot + 1)]
          const answered = yield* handler
            ? handler(request).pipe(
                Effect.matchCause({
                  onSuccess: (ok) => ({ ok: ok as JsonValue }),
                  onFailure: (cause) => ({ error: refusalOf(cause) }),
                })
              )
            : Effect.succeed({
                error: {
                  code: "not_found",
                  message: `Banda's window answers no "${request.method}".`,
                } satisfies Refusal,
              })
          // The engine may have gone since: the asking call hears that.
          yield* Effect.ignore(
            Effect.tryPromise(() =>
              client.call("window.answer", { request: request.id, ...answered })
            )
          )
        })
      yield* Effect.forkScoped(
        requests.pipe(
          Stream.mapEffect(answer, { concurrency: "unbounded" }),
          Stream.runDrain
        )
      )
    })
  )
