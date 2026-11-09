/**
 * What an action is run with (ADR 0071): its id and its args, plain data,
 * as `keys.toml`, the CLI and an Agent give them. The Window's run, which
 * acts with its Here, is `@banda/core/react`'s `useRun`.
 */
import type { JsonValue } from "@banda/contract"

/** A Pane's args, and what an action is run with besides the window: the
 * Banda menu's words, a Project. Plain data, as `keys.toml` and the CLI will
 * give it. */
export type Args = { [key: string]: JsonValue }

/** Runs an action by its id, as its key would, with `args`. */
export type Run = (action: string, args?: Args) => void
