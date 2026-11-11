/**
 * How the sidebar arranges what it lists (ADR 0008, as ADR 0098 amends
 * it). `banda look` resolves it from `sidebar.toml`, over the preset it
 * names, over Banda's defaults; the window takes it as it comes
 * (../look.ts) and only draws.
 */
import type { Sidebar } from "@banda/contract/sidebar"
import type { Density } from "./card"

/** What the list needs of the sidebar: its keys, not where they came from. */
export type Settings = Pick<
  Sidebar,
  | "preset"
  | "group"
  | "card"
  | "inbox"
  | "hold"
  | "sort"
  | "projects"
  | "machines"
>

/** What Banda's presets are, in a few words, for the view menu. */
export const PRESET_WORDS: Readonly<Record<string, string>> = {
  inbox: "What needs you first",
  projects: "Threads under their Projects",
  places: "Projects above, Threads by need",
}

/** Whether the list of Projects shows above the Threads: as the `places`
 * preset showed it, whose `[projects] list` is no longer read, until the
 * list goes (ADR 0098, decision 16). */
export const listsProjects = (settings: Pick<Settings, "preset">) =>
  settings.preset === "places"

/** What the list is grouped by as the window draws it now: each Project
 * under its header, or one list. Under the list of Projects the Threads
 * are one list, and `group = "machine"` waits for the view menu (ADR 0098,
 * step 8). */
export const groupOf = (
  settings: Pick<Settings, "preset" | "group">
): "none" | "project" =>
  settings.group === "project" && !listsProjects(settings) ? "project" : "none"

/** How many lines a card draws (ADR 0098, decision 9): auto, by where it
 * is, until the view menu comes and the list reads `card` (step 8). */
export const DENSITY: Density = "auto"
