/**
 * The sidebar's words for TypeScript (ADR 0008, ADR 0098): the arrangement
 * `banda look` resolves from `sidebar.toml`, and Banda's defaults for
 * before it comes. The view menu writes its keys with `banda settings
 * set` (ADR 0016).
 */
import type { Sidebar } from "./generated/sidebar/Sidebar"

export type { Sidebar } from "./generated/sidebar/Sidebar"
export type { GroupBy } from "./generated/sidebar/GroupBy"
export type { Card } from "./generated/sidebar/Card"
export type { Inbox } from "./generated/sidebar/Inbox"
export type { InboxOrder } from "./generated/sidebar/InboxOrder"
export type { Hold } from "./generated/sidebar/Hold"
export type { Sort } from "./generated/sidebar/Sort"
export type { SortBy } from "./generated/sidebar/SortBy"
export type { Projects } from "./generated/sidebar/Projects"
export type { ProjectOrder } from "./generated/sidebar/ProjectOrder"
export type { Preset } from "./generated/sidebar/Preset"
export type { PresetOrigin } from "./generated/sidebar/PresetOrigin"
export type { BarCounts } from "./generated/sidebar/BarCounts"
export type { BarShow } from "./generated/sidebar/BarShow"
export type { BarEmpty } from "./generated/sidebar/BarEmpty"
export type { Count } from "./generated/sidebar/Count"
export type { Machines } from "./generated/sidebar/Machines"
export type { MachineRows } from "./generated/sidebar/MachineRows"

/** Banda's arrangement, the `inbox` preset: what `banda look` gives with
 * no files, for before the first look and outside the desktop. */
export const DEFAULT_SIDEBAR: Sidebar = {
  file: "",
  preset: "inbox",
  presets: [
    { name: "inbox", origin: "banda" },
    { name: "projects", origin: "banda" },
    { name: "places", origin: "banda" },
  ],
  group: "none",
  card: "auto",
  inbox: { order: "oldest", open: true, working: true },
  hold: { still: true },
  sort: { by: "attention" },
  projects: { order: "changed", rollup: true, newThread: true },
  bar: {
    show: "closed",
    counts: ["asking", "done", "working"],
    color: true,
    words: false,
    empty: "mark",
  },
  later: {
    presets: ["1h", "3h", "18:00", "tomorrow 9:00", "mon 9:00"],
  },
  machines: { rows: "named", thisToo: false },
}
