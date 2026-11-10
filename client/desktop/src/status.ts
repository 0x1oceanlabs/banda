/**
 * Who works and who waits on this machine, as the menu bar shows it (ADR
 * 0086, decision 4): `banda status --follow --with-parent` as the
 * window's child, run on the window's `banda` (program.ts), one line on
 * each change, kept here as the last `EngineStatus`. It starts no engine:
 * with none it says so, and waits for one. It is started again when it
 * dies, as the window's other children are (child.ts), and says nothing
 * meanwhile. Only where Banda lives in the menu bar (`hasMenuBar`):
 * elsewhere it never runs, and there is no status.
 */
import type { EngineStatus } from "@banda/contract"
import {
  Console,
  Context,
  Effect,
  Layer,
  Stream,
  SubscriptionRef,
} from "effect"
import { command, keepRunning, lines } from "./child"
import { statusOf } from "./menubar"
import { Program } from "./program"

/** The last status `banda status --follow` said, and each new one; none
 * while it has said nothing, or since it died. */
export class Status extends Context.Service<
  Status,
  {
    readonly current: Effect.Effect<EngineStatus | null>
    readonly changes: Stream.Stream<EngineStatus | null>
  }
>()("banda/Status") {}

/** The status's layer: it follows the engine only where `follows`. */
export const statusLayer = (follows: boolean) =>
  Layer.effect(Status)(
    Effect.gen(function* () {
      const now = yield* SubscriptionRef.make<EngineStatus | null>(null)
      if (follows) {
        const program = yield* Program
        yield* Effect.forkScoped(
          keepRunning(
            "status",
            Effect.flatMap(program.path, (binary) =>
              command(binary, ["status", "--follow", "--with-parent"])
            ),
            (child) =>
              lines(child).pipe(
                Stream.runForEach((line) => {
                  const status = statusOf(line)
                  return status
                    ? SubscriptionRef.set(now, status)
                    : Console.error(
                        `banda: banda status said something unexpected: ${line}`
                      )
                }),
                Effect.ensuring(SubscriptionRef.set(now, null))
              )
          )
        )
      }
      return {
        current: SubscriptionRef.get(now),
        changes: SubscriptionRef.changes(now),
      }
    })
  )
