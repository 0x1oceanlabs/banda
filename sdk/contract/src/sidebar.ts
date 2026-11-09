/**
 * The sidebar's words for TypeScript (ADR 0008): the arrangement
 * `banda look` resolves from `sidebar.toml`, and Banda's defaults for
 * before it comes. The view menu writes the preset with `banda settings
 * set` (ADR 0016).
 */
import type { Sidebar } from "./generated/sidebar/Sidebar"

export type { Sidebar } from "./generated/sidebar/Sidebar"
export type { Group } from "./generated/sidebar/Group"
export type { GroupBy } from "./generated/sidebar/GroupBy"
export type { Sort } from "./generated/sidebar/Sort"
export type { SortBy } from "./generated/sidebar/SortBy"
export type { Projects } from "./generated/sidebar/Projects"
export type { ProjectOrder } from "./generated/sidebar/ProjectOrder"
export type { Row } from "./generated/sidebar/Row"
export type { Part } from "./generated/sidebar/Part"
export type { State } from "./generated/sidebar/State"
export type { Empty } from "./generated/sidebar/Empty"
export type { Preset } from "./generated/sidebar/Preset"
export type { PresetOrigin } from "./generated/sidebar/PresetOrigin"
export type { BarCounts } from "./generated/sidebar/BarCounts"
export type { BarShow } from "./generated/sidebar/BarShow"
export type { BarEmpty } from "./generated/sidebar/BarEmpty"
export type { Count } from "./generated/sidebar/Count"

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
  group: {
    by: "state",
    states: ["active"],
    bottom: ["working", "later", "archived"],
    folded: ["later", "archived"],
    limit: 10,
    empty: "hide",
  },
  sort: { by: "attention" },
  projects: { list: false, order: "changed", rollup: true, newThread: true },
  row: { lines: 3, hide: [] },
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
}
