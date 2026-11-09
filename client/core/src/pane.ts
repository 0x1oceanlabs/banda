/**
 * What the Window, its popped-out windows and main say of a Pane (ADR
 * 0087): what one tile shows, and where a Pane opens. The Pane contract
 * itself, what a module offers and draws, is `@banda/ui/pane`'s.
 */
import type { JsonValue } from "@banda/contract"

/** What one tile shows: a kind of Pane and its args. */
export type PaneState = { kind: string; args: { [key: string]: JsonValue } }

/**
 * Where a Pane opens, from the Pane that opens it: in a new column to its
 * right, below it in its column, instead of it in its place, or in its
 * Group, in the Deck right of it, as what a Thread opens goes; or last on
 * its Project's workspace, as an Agent's Thread does (ADR 0065). Left out,
 * the window shows the Pane where its workspace shows one of its kind, or
 * to the right. `instead` is the word the engine's `workspaces.open` has
 * (ADR 0087, decision 14).
 */
export type Place = "right" | "below" | "instead" | "group" | "project"
