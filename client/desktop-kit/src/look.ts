/**
 * The look as main keeps it (ADR 0007, ADR 0020): the last one, and each
 * new one. Main runs `banda look --follow --with-parent` for it
 * (client/desktop/src/look.ts).
 */
import type { Look as LookValue } from "@banda/contract/look"
import { Context, Effect, type Stream } from "effect"
import { Refused } from "./errors"

export class Look extends Context.Service<
  Look,
  {
    /** The last look; none before the first. */
    readonly current: Effect.Effect<LookValue | null>
    /** The last look and each one after it. */
    readonly changes: Stream.Stream<LookValue>
  }
>()("banda/Look") {
  /** The look's `part`, or a refusal naming `what` before the first look. */
  static readonly part = <K extends keyof LookValue>(part: K, what: string) =>
    Effect.flatMap(
      Look.use((look) => look.current),
      (now) =>
        now
          ? Effect.succeed(now[part])
          : Effect.fail(new Refused({ message: `${what} is not known yet.` }))
    )
}
