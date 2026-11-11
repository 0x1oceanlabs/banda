/**
 * How the sidebar arranges what it lists (ADR 0008). `banda look`
 * resolves it from `sidebar.toml`, over the preset it names, over Banda's
 * defaults; the window takes it as it comes (../look.ts) and only draws.
 */
import type { Sidebar } from "@banda/contract/sidebar"
import type { Density } from "./card"

/** What the list needs of the sidebar: its keys, not where they came from. */
export type Settings = Pick<Sidebar, "group" | "sort" | "projects" | "machines">

/** What Banda's presets are, in a few words, for the view menu. */
export const PRESET_WORDS: Readonly<Record<string, string>> = {
  inbox: "What needs you first",
  projects: "Threads under their Projects",
  places: "Projects above, Threads by need",
}

/** How many lines a card draws (ADR 0098, decision 9): auto, by where it
 * is, until `sidebar.toml` names it with `card` (S8a). The old `[row]`
 * keys no longer lay the card out. */
export const DENSITY: Density = "auto"
