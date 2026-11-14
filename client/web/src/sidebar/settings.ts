/**
 * How the sidebar arranges what it lists (ADR 0008, as ADR 0098 amends
 * it). `banda look` resolves it from `sidebar.toml`, over Banda's
 * defaults; the window takes it as it comes (../look.ts) and only draws.
 */
import type { GroupBy, Sidebar } from "@banda/contract/sidebar"

/** What the list needs of the sidebar: its keys, not where they came from. */
export type Settings = Pick<
  Sidebar,
  "group" | "inbox" | "sort" | "projects" | "machines"
>

/** Each way to group the list, in the view menu's words. */
export const GROUP_WORDS: Readonly<Record<GroupBy, string>> = {
  none: "None",
  project: "Project",
}
