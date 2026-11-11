/**
 * How the sidebar arranges what it lists (ADR 0008, as ADR 0098 amends
 * it). `banda look` resolves it from `sidebar.toml`, over the preset it
 * names, over Banda's defaults; the window takes it as it comes
 * (../look.ts) and only draws.
 */
import type { GroupBy, Sidebar } from "@banda/contract/sidebar"

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

/** What Banda's presets are, in a few words, for Settings' preset row. */
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

/** What the list is grouped by as the window draws it (ADR 0098, decision
 * 7): `group`, but under the list of Projects, where the Threads are one
 * list. */
export const groupOf = (
  settings: Pick<Settings, "preset" | "group">
): GroupBy => (listsProjects(settings) ? "none" : settings.group)

/** Each way to group the list, in the view menu's words. */
export const GROUP_WORDS: Readonly<Record<GroupBy, string>> = {
  none: "None",
  project: "Project",
  machine: "Machine",
}
