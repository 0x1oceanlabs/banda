/**
 * The look as the window's child: `banda look --follow` (ADR 0007,
 * decision 10; ADR 0020). Each line it prints is the whole look; this
 * keeps the last one and hands each new one to whoever listens. The look
 * is this machine's, so it needs no engine.
 */
import { type Look as LookValue, shown } from "@banda/contract/look"
import {
  Console,
  Context,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect"
import { command, keepRunning, known, lines } from "./child"

/** A line the program printed: JSON, taken as the look it is. The look
 * is Banda's own program's, so it is not checked key by key; the page
 * takes it the same way. */
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export class Look extends Context.Service<
  Look,
  {
    /** The last look; none before the first. */
    readonly current: Effect.Effect<LookValue | null>
    /** The last look and each one after it. */
    readonly changes: Stream.Stream<LookValue>
  }
>()("banda/Look") {
  static readonly layer = (binary: string) =>
    Layer.effect(Look)(
      Effect.gen(function* () {
        const look = yield* SubscriptionRef.make(Option.none<LookValue>())
        yield* Effect.forkScoped(
          keepRunning("look", command(binary, ["look", "--follow"]), (child) =>
            lines(child).pipe(
              Stream.runForEach((line) =>
                Option.match(parse(line), {
                  onSome: (parsed) =>
                    SubscriptionRef.set(look, Option.some(parsed as LookValue)),
                  onNone: () =>
                    Console.error(
                      `banda: the look said something unexpected: ${line}`
                    ),
                })
              )
            )
          )
        )
        return {
          current: Effect.map(SubscriptionRef.get(look), Option.getOrNull),
          changes: known(look),
        }
      })
    )

  /** The first look, or none once `within` ms went by without one: the
   * window waits that long to open in its colours. */
  static readonly first = (within: number) =>
    Look.use((look) =>
      look.changes.pipe(
        Stream.runHead,
        Effect.timeoutOption(within),
        Effect.map((first) => Option.getOrNull(Option.flatten(first)))
      )
    )
}

/** The colour the window paints before the page draws, when it is hex. */
export function firstFrame(
  look: LookValue,
  systemDark: boolean
): string | undefined {
  const background = shown(look, systemDark).colors["--background"]
  return background && /^#[0-9a-f]{6}$/i.test(background)
    ? background
    : undefined
}
