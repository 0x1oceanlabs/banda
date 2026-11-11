/**
 * The engine as main runs it, its child (client/desktop/src/engine.ts): where
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
  }
>()("banda/Engine") {
}
