/**
 * The engine as main runs it, its child (app/desktop/src/engine.ts): where
 * it listens, and the doors it named.
 */
import type { Address } from "@banda/contract"
import { Context, type Effect } from "effect"

export class Engine extends Context.Service<
  Engine,
  {
    /** Where the engine listens; waits while it starts. */
    readonly address: Effect.Effect<Address>
    /** Where the window listens for `banda menu`, as the engine named it
     * the first time it started. */
    readonly door: Effect.Effect<string>
    /** Where the window says its CDP endpoint, for `banda browser`. */
    readonly browser: Effect.Effect<string>
  }
>()("banda/Engine") {}
