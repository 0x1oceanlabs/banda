/**
 * The desktop's side of the settings Pane (ADR 0016): the page asks, and
 * `banda settings set|reset` changes the file, keeping the Person's text
 * (decision 5). `banda look --follow` sees the change and hands both
 * windows the new look, so the page never reads or writes a file itself.
 * `banda settings` checks the file and the key; this hands them on.
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Listed } from "@banda/contract/look"
import { Context, Duration, Effect, Exit, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { shell } from "electron"
import { Broke, Refused } from "./errors"

/** A line of `banda look themes`: JSON, taken as the theme it lists. */
const parse = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

export class Settings extends Context.Service<
  Settings,
  {
    /** Sets `key` in `file` to `value`, TOML; what was wrong, if it
     * refused. */
    set(
      file: string,
      key: string,
      value: string
    ): Effect.Effect<string[], Broke>
    /** Sets `key` in `file` to `value`, written as TOML; a refusal fails,
     * saying what was wrong. */
    write(
      file: string,
      key: string,
      value: unknown
    ): Effect.Effect<void, Refused | Broke>
    /** Takes `key` out of `file`, so the layer under it shows again. */
    reset(file: string, key: string): Effect.Effect<string[], Broke>
    /** Names `key` in `file` `to` instead, where it is, comments kept. */
    rename(
      file: string,
      key: string,
      to: string
    ): Effect.Effect<string[], Broke>
    /** The themes there are, as `banda look themes` lists them; read once. */
    readonly themes: Effect.Effect<Listed[], Broke>
    /** Opens `file`, beside `sidebar.toml` in the config folder, in the
     * Person's editor; the folder when it is not there yet, or for "". */
    reveal(sidebarFile: string, file: string): Effect.Effect<void, Refused>
  }
>()("banda/Settings") {
  static readonly layer = (binary: string) =>
    Layer.effect(Settings)(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        /** What `banda settings` said when it refused, a problem a line;
         * nothing when done. 1 is a refusal, said as `check` says it;
         * anything else broke. */
        const settings = (args: string[]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const child = yield* spawner.spawn(
                ChildProcess.make(binary, ["settings", ...args], {
                  stdin: "ignore",
                  stdout: "ignore",
                })
              )
              const [said, code] = yield* Effect.all(
                [
                  child.stderr.pipe(Stream.decodeText, Stream.mkString),
                  child.exitCode,
                ],
                { concurrency: 2 }
              )
              if (code === 0) return []
              if (code === 1 && said) return said.split("\n").filter(Boolean)
              return yield* new Broke({
                message: said.trim() || `banda settings stopped (code ${code})`,
              })
            })
          ).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(new Broke({ message: error.message }))
            )
          )

        const read = spawner
          .lines(ChildProcess.make(binary, ["look", "themes"]))
          .pipe(
            Effect.flatMap((lines) =>
              Effect.forEach(lines.filter(Boolean), (line) => parse(line))
            ),
            Effect.map((themes) => themes as Listed[]),
            Effect.mapError((error) => new Broke({ message: error.message }))
          )
        // Read again after a failure, never after a success.
        const themes = yield* Effect.cachedWithTTL(read, (exit) =>
          Exit.isSuccess(exit) ? Duration.infinity : 0
        )

        return {
          set: (file, key, value) => settings(["set", file, key, value]),
          write: (file, key, value) =>
            settings(["set", file, key, JSON.stringify(value)]).pipe(
              Effect.flatMap((refused) =>
                refused.length
                  ? Effect.fail(new Refused({ message: refused.join("\n") }))
                  : Effect.void
              )
            ),
          reset: (file, key) => settings(["reset", file, key]),
          rename: (file, key, to) => settings(["rename", file, key, to]),
          themes,
          reveal: (sidebarFile, file) =>
            Effect.gen(function* () {
              if (file && !/^[a-z-]+\.toml$/.test(file))
                return yield* new Refused({ message: `${file} is not one.` })
              const path = join(dirname(sidebarFile), file)
              const failed = yield* Effect.promise(() =>
                shell.openPath(existsSync(path) ? path : dirname(path))
              )
              if (failed) return yield* new Refused({ message: failed })
            }),
        }
      })
    )
}
