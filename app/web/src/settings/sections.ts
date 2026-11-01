/**
 * The settings window's sections (ADR 0016, decision 8). Sections follow
 * what a Person looks for, not the files: Sounds & calls is a section, yet
 * its keys stay in `look.toml`. A section names its file and the tables of
 * it that it shows; one that names none shows the tables no other section
 * takes. Its rows come from the file's schema, so a new key in Rust shows
 * with no list kept here; a row the schema cannot draw well, the section
 * draws itself (decision 4).
 */
import type { ComponentType } from "react"
import type { Engine } from "@banda/contract"
import {
  aboutOf,
  type Row,
  rowsOf,
  type Setting,
  titleOf,
} from "@banda/contract/settings"
import {
  BellIcon,
  BotIcon,
  FileCogIcon,
  GlobeIcon,
  type LucideIcon,
  PaletteIcon,
  PanelLeftIcon,
} from "lucide-react"
import { Agents } from "./Agents"
import { ThemePicker } from "./ThemePicker"

/** A row a section draws itself: the value now, and how to set it. */
export type CustomRow = ComponentType<{
  setting?: Setting
  set: (value: string) => void
}>

export type Section = {
  /** Its part of a link: `appearance` in `appearance/radius`. */
  id: string
  title: string
  icon: LucideIcon
  /** The file its rows are in; none for Files, which lists them. */
  file?: string
  /** What it holds, under its title. */
  about: string
  /** The file's tables it shows. */
  tables?: string[]
  /** Its own rows, by key. */
  custom?: { [key: string]: CustomRow }
  /** What it shows instead of rows, as a module draws it; `lit` is the
   * part a link names. */
  Body?: ComponentType<{ engine: Engine; lit?: string }>
}

export const SECTIONS: Section[] = [
  {
    id: "appearance",
    title: "Appearance",
    icon: PaletteIcon,
    file: "look.toml",
    about:
      "Layers, each over the one before: Banda, the theme, Hyprland, then your look.toml. Reset takes your line out, and the layer below shows again.",
    custom: { theme: ThemePicker },
  },
  {
    id: "sidebar",
    title: "Sidebar",
    icon: PanelLeftIcon,
    file: "sidebar.toml",
    about: aboutOf("sidebar.toml"),
  },
  {
    id: "sounds",
    title: "Sounds & calls",
    icon: BellIcon,
    file: "look.toml",
    about:
      "Banda's sounds, and how it tells you a Thread calls for you. Kept in look.toml.",
    tables: ["sound", "notify"],
  },
  {
    id: "agents",
    title: "Agents",
    icon: BotIcon,
    file: "harnesses.toml",
    about:
      "The Harnesses Banda starts Threads with, and what a message written while an Agent works does.",
    Body: Agents,
  },
  {
    id: "browser",
    title: "Browser",
    icon: GlobeIcon,
    file: "browser.toml",
    about: aboutOf("browser.toml"),
  },
  {
    id: "files",
    title: "Files",
    icon: FileCogIcon,
    about:
      "Every file Banda reads its settings from, and whether it reads. Edit one by hand and this window follows.",
  },
]

/** Each section's rows in their tables, the file's own keys first; the
 * schemas never change, so once. */
const GROUPS = new Map(
  SECTIONS.map((section) => [section, grouped(rowsFor(section))])
)

function rowsFor(section: Section): Row[] {
  if (!section.file || section.Body) return []
  const taken = SECTIONS.filter((s) => s.file === section.file).flatMap(
    (s) => s.tables ?? []
  )
  return rowsOf(section.file).filter((row) => {
    const table = row.key.split(".")[0]!
    return section.tables
      ? section.tables.includes(table)
      : !taken.includes(table)
  })
}

function grouped(rows: Row[]): { title: string; rows: Row[] }[] {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const group = groups.get(row.group)
    if (group) group.push(row)
    else groups.set(row.group, [row])
  }
  return [...groups].map(([group, rows]) => ({
    title: group.split(".").map(titleOf).join(" › "),
    rows,
  }))
}

/** A section's rows in their tables. */
export function groupsOf(section: Section): { title: string; rows: Row[] }[] {
  return GROUPS.get(section) ?? []
}

/** Every row, with the words a search looks in. */
const INDEX = SECTIONS.flatMap((section) =>
  groupsOf(section).flatMap((group) =>
    group.rows.map((row) => ({
      section,
      row,
      words: `${row.title} ${row.key} ${row.about}`.toLowerCase(),
    }))
  )
)

/** The rows in any section that say `words`. */
export function search(words: string): { section: Section; row: Row }[] {
  const wanted = words.trim().toLowerCase()
  return INDEX.filter((entry) => entry.words.includes(wanted))
}

/** A link's section and row: `appearance/tile.border`. */
export function parseLink(link: string): { section: Section; key?: string } {
  const [id, key] = link.split("/")
  const section = SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!
  return { section, key: key || undefined }
}
