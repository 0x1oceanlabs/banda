/**
 * The engine as main runs it, its child (app/desktop/src/engine.ts): where
 * it listens, and the doors it named.
 */
import type { Address, Engine as Client } from "@banda/contract"
import { Context, Effect } from "effect"

export class Engine extends Context.Service<
  Engine,
  {
    /** Where the engine listens; waits while it starts. */
    readonly address: Effect.Effect<Address>
    /** Main's one client of the engine's API, made when first asked for:
     * it hears the engine again after a restart, and closes with main. */
    readonly client: Effect.Effect<Client>
    /** Where the window listens for `banda menu`, as the engine named it
     * the first time it started. */
    readonly door: Effect.Effect<string>
    /** Where the window says its CDP endpoint, for `banda browser`. */
    readonly browser: Effect.Effect<string>
  }
>()("banda/Engine") {
  /** The folder of Project `project`, as the engine has it; none for one
   * it does not know. */
  static readonly folderOf = (project: string) =>
    Effect.gen(function* () {
      const client = yield* Engine.use((engine) => engine.client)
      const projects = yield* Effect.promise(() =>
        client.call("projects.list", {})
      )
      return projects.find((one) => one.id === project)?.folder ?? null
    })
}
