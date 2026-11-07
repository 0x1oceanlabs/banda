/**
 * The settings' files (ADR 0016), which main changes through `banda
 * settings` (client/desktop/src/settings.ts).
 */
import type { Listed } from "@banda/contract/look"
import { Context, type Effect } from "effect"
import type { Broke, Refused } from "./errors"

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
    /** Opens `file`, in the config folder `config`, in the Person's
     * editor; the folder when it is not there yet, or for "". */
    reveal(config: string, file: string): Effect.Effect<void, Refused>
  }
>()("banda/Settings") {}
