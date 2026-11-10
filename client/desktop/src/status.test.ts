import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { Program } from "./program"
import { Status, statusLayer } from "./status"
import { script } from "./testing"

/** The status's layer, following where `follows`, on `program`. */
const statusOf = (program: string, follows = true) =>
  statusLayer(follows).pipe(
    Layer.provide(Program.layer({ program })),
    Layer.provide(NodeServices.layer)
  )

it.live(
  "the menu bar follows banda status --follow with its parent, each line the status, one that is not left out (ADR 0086, decision 4)",
  () =>
    Effect.gen(function* () {
      const program = script(
        `echo "$@" > "$(dirname "$0")/args"\n` +
          `echo '{"running":false}'\nsleep 0.3\necho 'banda: not a status'\n` +
          `echo '{"running":true,"version":"0.4.0-dev.458"}'\nexec sleep 60`
      )
      const said = yield* Status.use((status) =>
        status.changes.pipe(
          Stream.filter((now) => now !== null),
          Stream.map((now) => now.running),
          Stream.take(2),
          Stream.runCollect
        )
      ).pipe(Effect.provide(statusOf(program)))
      expect(said).toEqual([false, true])
      expect(readFileSync(join(dirname(program), "args"), "utf8").trim()).toBe(
        "status --follow --with-parent"
      )
    })
)

it.live(
  "once it dies the menu bar has no status, until it is started again",
  () =>
    Effect.gen(function* () {
      const program = script(`echo '{"running":true}'\nsleep 0.3\nexit 1`)
      const said = yield* Status.use((status) =>
        status.changes.pipe(
          Stream.map((now) => now?.running ?? null),
          Stream.changes,
          Stream.take(4),
          Stream.runCollect
        )
      ).pipe(Effect.provide(statusOf(program)))
      expect(said).toEqual([null, true, null, true])
    })
)

it.live("where Banda has no menu bar it follows nothing", () =>
  Effect.gen(function* () {
    const program = script(`touch "$(dirname "$0")/ran"\nexec sleep 60`)
    const now = yield* Status.use((status) =>
      Effect.andThen(Effect.sleep("300 millis"), status.current)
    ).pipe(Effect.provide(statusOf(program, false)))
    expect(now).toBeNull()
    expect(() => readFileSync(join(dirname(program), "ran"))).toThrow()
  })
)
