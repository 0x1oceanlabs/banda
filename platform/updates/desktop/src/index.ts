/**
 * The updates module's part in the window's main process (ADR 0119,
 * decision 2): the swap of the window's own app (app.ts), for the release
 * the engine's updates module says is newest (releases.ts).
 */
export {
  type App,
  type Engine,
  followEngine,
  type Updates,
  updates,
} from "./app"
