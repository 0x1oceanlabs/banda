/**
 * The sidebar's words for TypeScript (ADR 0008): the arrangement
 * `bandaso look` resolves from `sidebar.toml`, Banda's defaults for before
 * it comes, and how the view menu writes a preset into the file.
 */
import type { Sidebar } from "./generated/sidebar/Sidebar"

export type { Sidebar } from "./generated/sidebar/Sidebar"
export type { Group } from "./generated/sidebar/Group"
export type { GroupBy } from "./generated/sidebar/GroupBy"
export type { Sort } from "./generated/sidebar/Sort"
export type { SortBy } from "./generated/sidebar/SortBy"
export type { Spaces } from "./generated/sidebar/Spaces"
export type { SpaceOrder } from "./generated/sidebar/SpaceOrder"
export type { Row } from "./generated/sidebar/Row"
export type { Part } from "./generated/sidebar/Part"
export type { State } from "./generated/sidebar/State"
export type { Empty } from "./generated/sidebar/Empty"
export type { Preset } from "./generated/sidebar/Preset"
export type { PresetOrigin } from "./generated/sidebar/PresetOrigin"

/** Banda's arrangement, the `inbox` preset: what `bandaso look` gives with
 * no files, for before the first look and outside the desktop. */
export const DEFAULT_SIDEBAR: Sidebar = {
  file: "",
  preset: "inbox",
  presets: [
    { name: "inbox", origin: "banda" },
    { name: "spaces", origin: "banda" },
    { name: "places", origin: "banda" },
  ],
  group: {
    by: "state",
    states: ["active"],
    bottom: ["working", "settled"],
    folded: ["settled"],
    limit: 10,
    empty: "hide",
  },
  sort: { by: "attention" },
  spaces: { list: false, order: "changed", rollup: true, newThread: true },
  row: { lines: 3, hide: [] },
}

/** `text`, a `sidebar.toml`, naming the preset `name`: the line that names
 * one now changes, its comment kept, or a line goes in at the top. Nothing
 * else in the file changes. */
export function withPreset(text: string, name: string): string {
  const line = `preset = ${JSON.stringify(name)}`
  const lines = text.split("\n")
  for (const [at, now] of lines.entries()) {
    // `preset` is a key of the file's top, before any table.
    if (/^\s*\[/.test(now)) break
    const named = /^(\s*)preset\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')(.*)$/.exec(
      now
    )
    if (named) {
      lines[at] = `${named[1]}${line}${named[3]}`
      return lines.join("\n")
    }
  }
  return text === "" ? `${line}\n` : `${line}\n${text}`
}
