/**
 * The window's end of the kernel's road (ADR 0029, decision 2): main
 * holds `window.requests` as one of the engine's clients, from when it
 * starts, and answers each request with the handler of the module it
 * names (modules.ts), by `window.answer`. The page has no part in it: a
 * module's engine part asks main, which holds the module's pages.
 */
import type { JsonValue, Refusal, WindowRequest } from "@banda/contract"
import { type Asked, Engine, type Refused } from "@banda/desktop-kit"
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect"

/** Why a handler gave no answer: what it refused, that it took too
 * long, or that it broke. */
const refusalOf = (cause: Cause.Cause<Refused | Cause.TimeoutError>): Refusal =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (error) =>
      Cause.isTimeoutError(error)
        ? { code: "conflict", message: "Banda's window took too long." }
        : { code: error.code ?? "conflict", message: error.message },
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
      const client = yield* Engine.use((engine) => engine.client)
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
                // Past the engine's time no one hears the answer: the
                // handler stops, and what it holds goes.
                Effect.timeout(request.within),
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
