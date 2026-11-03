/**
 * The settings Pane's sections (ADR 0016, decision 8). Sections follow
 * what a Person looks for, not the files: Sounds & calls is a section, yet
 * its keys stay in `look.toml`. A section names its files and the tables of
 * each that it shows; a file that names none shows the tables no other
 * section takes. Its rows come from the file's schema, so a new key in Rust
 * shows with no list kept here; a row the schema cannot draw well, the
 * section draws itself (decision 4).
 */
import type { ComponentType, ReactNode } from "react"
import type { Engine } from "@banda/contract"
import type { WindowApi } from "@banda/ui/module"
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
  BugIcon,
  FileCogIcon,
  FoldersIcon,
  GlobeIcon,
  KeyboardIcon,
  type LucideIcon,
  PaletteIcon,
  PanelLeftIcon,
  SettingsIcon,
  Share2Icon,
} from "lucide-react"
import { Agents } from "./Agents"
import { BrowserSites } from "./BrowserSites"
import { General } from "./General"
import { Keys } from "./Keys"
import { ProblemsSettings } from "./ProblemsSettings"
import { PlaySound, PresetPicker } from "./rows"
import { SharingSettings } from "./SharingSettings"
import { SpacesSettings } from "./SpacesSettings"
import { ThemePicker } from "./ThemePicker"

/** A row a section draws itself: the value now, how to set it, and the
 * control the schema would draw, to wrap. */
export type CustomRow = ComponentType<{
  row: Row
  setting?: Setting
  set: (value: string) => void
  control: ReactNode
}>

/** A file a section shows. */
export type SectionFile = {
  name: string
  /** Its tables the section shows; none, the ones no other section takes. */
  tables?: string[]
  /** One heading over all its rows, instead of one for each table. */
  title?: string
  /** Its tables are the section's Body's or Foot's to draw, not rows:
   * `agents.toml`'s `start`, on each Harness's card. */
  drawn?: boolean
}

export type Section = {
  /** Its part of a link: `appearance` in `appearance/radius`. */
  id: string
  title: string
  icon: LucideIcon
  /** The files its rows are in, its own first: the one it opens, and
   * the one its Body draws. None for Files, which lists them. */
  files?: SectionFile[]
  /** What it holds, under its title. */
  about: string
  /** Its own rows, by key. */
  custom?: { [key: string]: CustomRow }
  /** What it shows instead of its first file's rows, as a module draws
   * it; `lit` is the part a link names. */
  Body?: ComponentType<SectionProps>
  /** What it shows under its rows, as a module draws it. */
  Foot?: ComponentType<SectionProps>
}

/** What a section's own Body is drawn with. */
export type SectionProps = {
  engine: Engine
  /** The part of it a link names. */
  lit?: string
  /** Runs a window's action, as the Pane's `run`; none in a dialog of
   * the settings. */
  run?: WindowApi["run"]
}

export const SECTIONS: Section[] = [
  {
    id: "general",
    title: "General",
    icon: SettingsIcon,
    about: "Banda's engine, and where its settings files are.",
    Body: General,
  },
  {
    id: "spaces",
    title: "Spaces",
    icon: FoldersIcon,
    about:
      "The folders you and your Agents work in. Banda's engine keeps them, not a file.",
    Body: SpacesSettings,
  },
  {
    id: "appearance",
    title: "Appearance",
    icon: PaletteIcon,
    files: [{ name: "look.toml" }],
    about:
      "Layers, each over the one before: Banda, the theme, Hyprland, then your look.toml. Reset takes your line out, and the layer below shows again.",
    custom: { theme: ThemePicker },
  },
  {
    id: "sidebar",
    title: "Sidebar",
    icon: PanelLeftIcon,
    files: [{ name: "sidebar.toml" }],
    about: aboutOf("sidebar.toml"),
    custom: { preset: PresetPicker },
  },
  {
    id: "sounds",
    title: "Sounds & calls",
    icon: BellIcon,
    files: [{ name: "look.toml", tables: ["sound", "notify"] }],
    about:
      "Banda's sounds, and how it tells you a Thread calls for you. Kept in look.toml.",
    custom: {
      "sound.done": PlaySound,
      "sound.asking": PlaySound,
      "sound.failed": PlaySound,
    },
  },
  {
    id: "agents",
    title: "Agents",
    icon: BotIcon,
    files: [
      { name: "harnesses.toml" },
      { name: "agents.toml", tables: ["start"], drawn: true },
      { name: "agents.toml", title: "Writing to an Agent" },
    ],
    about:
      "The Harnesses Banda starts Threads with, and what a message written while an Agent works does.",
    Body: Agents,
  },
  {
    id: "browser",
    title: "Browser",
    icon: GlobeIcon,
    files: [
      { name: "browser.toml" },
      { name: "browser.toml", tables: ["agents"], drawn: true },
    ],
    about: aboutOf("browser.toml"),
    Foot: BrowserSites,
  },
  {
    id: "keys",
    title: "Keys",
    icon: KeyboardIcon,
    files: [{ name: "keys.toml" }],
    about:
      "Your keys over Banda's own, as Hyprland's binds: each line a key and the action it runs, or none, so the key goes to the Pane.",
    Body: Keys,
  },
  {
    id: "problems",
    title: "Problems",
    icon: BugIcon,
    about:
      "What broke in Banda itself, kept on this computer. Sharing sends a report only if you turn it on.",
    Body: ProblemsSettings,
  },
  {
    id: "sharing",
    title: "Sharing",
    icon: Share2Icon,
    files: [{ name: "sharing.toml", title: "What Banda sends" }],
    about:
      "What Banda sends to its makers, and only what you turn on. It goes to PostHog (US) with a random ID that is not you: no IP, no location, no profile.",
    // The ID and what went, under the switches.
    Foot: SharingSettings,
  },
  {
    id: "files",
    title: "Files",
    icon: FileCogIcon,
    about:
      "Every file Banda reads its settings from, and whether it reads. Edit one by hand and this window follows.",
  },
]

/** Each section's rows in their tables, file by file; the schemas never
 * change, so once. */
const GROUPS = new Map(
  SECTIONS.map((section) => [
    section,
    (section.files ?? [])
      // A Body draws its first file, and the tables it says it draws.
      .filter((file, i) => !(section.Body && i === 0) && !file.drawn)
      .flatMap((file) =>
        file.title
          ? [{ title: file.title, rows: rowsFor(file) }]
          : grouped(rowsFor(file))
      ),
  ])
)

function rowsFor(file: SectionFile): Row[] {
  const taken = SECTIONS.flatMap((s) => s.files ?? [])
    .filter((f) => f.name === file.name)
    .flatMap((f) => f.tables ?? [])
  return rowsOf(file.name).filter((row) => {
    const table = row.key.split(".")[0]!
    return file.tables ? file.tables.includes(table) : !taken.includes(table)
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

/** The file a section opens: its first. */
export function ownFile(section: Section): string | undefined {
  return section.files?.[0]?.name
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
