/**
 * Actions the window runs for who asks from outside its page (ADR 0127,
 * decision 2): the one road by which main asks the page to run an action.
 * The engine's keys module asks for `banda act` and an Agent's `act` tool,
 * through the kernel's road (road.ts, `keys.act`), and main asks for
 * itself, as the menu bar's row that opens a Thread (`runOwn`). Main tells
 * the page the action on `act.asked`, and the page answers on
 * `act.answer`: it ran it, or why not.
 *
 * The engine has checked the id, the args and who asks before it comes
 * here (`platform/keys/engine`): main only carries it.
 */
import type { ActAnswer, Args } from "@banda/core"
import {
  type Answers,
  type Asked,
  Refused,
  tellPage,
  Window,
} from "@banda/desktop-kit"
import { Console, Context, Deferred, Effect, Layer, Schema } from "effect"
import type { WebContents } from "electron"
import { BRIDGE } from "./bridge"

/** As the kernel says it, with no window to hold its road. */
const NOT_OPEN = "Banda's window is not open."

/** How long main waits for the page when it asks for itself: what the
 * engine asks has the engine's own time (road.ts). */
const OWN = "10 seconds"

export class Acts extends Context.Service<
  Acts,
  {
    /** Asks the window's page to run `action` with `args`, as its key
     * does, and waits for its answer: refused with what the page said, or
     * with no window open. Interrupted, as past the asker's time, it
     * forgets the ask, and an answer that comes later is dropped. */
    readonly run: (action: string, args?: Args) => Effect.Effect<void, Refused>
    /** The answer `from` a page to what it was asked: only the window's
     * own page answers, once. */
    readonly answered: (
      answer: ActAnswer,
      from: Pick<WebContents, "id">
    ) => Effect.Effect<void>
  }
>()("banda/Acts") {
  static readonly layer = Layer.effect(Acts)(
    Effect.gen(function* () {
      const window = yield* Window
      /** What the page was asked and has not answered, by the ask's id,
       * with the page that was asked. */
      const waiting = new Map<
        number,
        { page: number; done: Deferred.Deferred<void, Refused> }
      >()
      let next = 0
      return {
        run: (action, args) =>
          Effect.gen(function* () {
            const contents = window.now()?.webContents
            if (!contents || contents.isDestroyed() || contents.isCrashed())
              return yield* new Refused({ message: NOT_OPEN })
            const id = next++
            const done = yield* Deferred.make<void, Refused>()
            waiting.set(id, { page: contents.id, done })
            const tell = () =>
              tellPage(contents, BRIDGE.act.asked, {
                id,
                action,
                ...(args && { args }),
              })
            // A window that opens now hears it once its page has loaded.
            if (contents.isLoadingMainFrame())
              contents.once("did-finish-load", tell)
            else tell()
            return yield* Deferred.await(done).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  waiting.delete(id)
                  // A window closed meanwhile took its listeners with it.
                  if (!contents.isDestroyed())
                    contents.removeListener("did-finish-load", tell)
                })
              )
            )
          }),
        answered: (answer, from) =>
          Effect.suspend(() => {
            const asked = waiting.get(answer.id)
            if (!asked || asked.page !== from.id) return Effect.void
            waiting.delete(answer.id)
            return answer.refused === undefined
              ? Deferred.succeed(asked.done, undefined)
              : Deferred.fail(
                  asked.done,
                  new Refused({ message: answer.refused })
                )
          }).pipe(Effect.asVoid),
      }
    })
  )
}

const Given = Schema.Struct({
  action: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
})

/** What main answers the keys module's engine part: `keys.act`, an action
 * to run, already checked there. */
export const actsAsked: Asked<Acts> = {
  act: (request) =>
    Schema.decodeUnknownEffect(Given)(request.params).pipe(
      Effect.mapError(
        () =>
          new Refused({
            code: "invalid",
            message: "keys.act names no action.",
          })
      ),
      Effect.flatMap(({ action, args }) =>
        Acts.use((acts) => acts.run(action, args))
      )
    ),
}

/** Main's answers to the page's channels of `act`. */
export const actsAnswers: Answers<typeof BRIDGE.act, Acts> = {
  answer: [
    Schema.Tuple([
      Schema.Struct({
        id: Schema.Number,
        refused: Schema.optional(Schema.String),
      }),
    ]),
    ([answer], event) =>
      Acts.use((acts) => acts.answered(answer, event.sender)),
  ],
}

/** Runs `action` in the window for main itself, as the menu bar's row
 * that opens a Thread: nothing waits on it, and what the page refuses, or
 * does not answer in time, is said on stderr. */
export const runOwn = (action: string, args?: Args) =>
  Acts.use((acts) => acts.run(action, args)).pipe(
    Effect.timeout(OWN),
    Effect.catch((error) =>
      Console.error(`banda: ${action} did not run: ${error.message}`)
    )
  )
