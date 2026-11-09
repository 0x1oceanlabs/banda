/**
 * How the sidebar arranges what it lists (ADR 0008). `banda look`
 * resolves it from `sidebar.toml`, over the preset it names, over Banda's
 * defaults; the window takes it as it comes (../look.ts) and only draws.
 */
import type { Sidebar, State } from "@banda/contract/sidebar"

export type { Part, State } from "@banda/contract/sidebar"

/** What arranging needs of the sidebar: its keys, not where they came from. */
export type Settings = Pick<Sidebar, "group" | "sort" | "projects" | "row">

export const STATES: readonly State[] = [
  "active",
  "working",
  "later",
  "archived",
]

/** What Banda's presets are, in a few words, for the view menu. */
export const PRESET_WORDS: Readonly<Record<string, string>> = {
  inbox: "What needs you first",
  projects: "Threads under their Projects",
  places: "Projects above, Threads by need",
}
