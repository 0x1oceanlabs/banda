/**
 * How the sidebar arranges what it lists (ADR 0008). `bandaso look`
 * resolves it from `sidebar.toml`, over the preset it names, over Banda's
 * defaults; the window takes it as it comes (../look.ts) and only draws.
 */
import type { Sidebar, State } from "@bandaso/contract/sidebar"

export type { Part, State } from "@bandaso/contract/sidebar"

/** What arranging needs of the sidebar: its keys, not where they came from. */
export type Settings = Pick<Sidebar, "group" | "sort" | "spaces" | "row">

export const STATES: readonly State[] = ["needs", "done", "working", "idle"]

/** What Banda's presets are, in a few words, for the view menu. */
export const PRESET_WORDS: Readonly<Record<string, string>> = {
  inbox: "What needs you first",
  spaces: "Threads under their Spaces",
  places: "Spaces above, Threads by need",
}
