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
import type { Handles } from "../tiling/mount"
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
  Columns3Icon,
  FileCogIcon,
  FolderIcon,
  FoldersIcon,
  GlobeIcon,
  KeyboardIcon,
  type LucideIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  PanelLeftIcon,
  SettingsIcon,
  Share2Icon,
  TerminalIcon,
} from "lucide-react"
import { Agents } from "./Agents"
import { BrowserSites } from "./BrowserSites"
import { General } from "./General"
import { Keys } from "./Keys"
import { MachinesSettings } from "./MachinesSettings"
import { ProblemsSettings } from "./ProblemsSettings"
import { hasMachinePart } from "./machine-settings"
import { showRows } from "./machines"
import { PlaySound, PresetPicker } from "./rows"
import { SharingSettings } from "./SharingSettings"
import { ProjectsSettings } from "./ProjectsSettings"
import { ThemePicker } from "./ThemePicker"
import { RULES_ROW, Shares, TilingRules } from "./Tiling"

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
  /** Individual keys drawn by the section's Body or Foot. Other keys
   * still get their controls from the schema. */
  drawnKeys?: string[]
  /** The rows of a `drawn` file a search still finds, in the words its
   * Body draws them with, and lands on there. */
  found?: Row[]
  /** They matter only with another machine in `hosts.toml`: with none,
   * the section draws them nowhere, so a search finds none of them. */
  others?: boolean
}

export type Section = {
  /** Its part of a link: `appearance` in `appearance/radius`. */
  id: string
  title: string
  icon: LucideIcon
  /** The files its rows are in, its own first: the one it opens, and
   * the one its Body draws. None for Settings files, which lists them. */
  files?: SectionFile[]
  /** What it holds, under its title. */
  about: string
  /** Whether it shows one machine's part, the one picked under "Settings
   * for" (`switches`): said where its files do not say it. General,
   * Projects and Problems show what a machine's engine keeps, in no file
   * (ADR 0124, principle 9); Machines shows every machine itself. */
  machine?: boolean
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
  /** The engine of the machine it shows: this one's, or the machine
   * picked under "Settings for" (ADR 0106, step 5b). */
  engine: Engine
  /** That other machine, by its key in `hosts.toml`; none for this one. */
  on?: string
  /** That other machine's name, as the Window shows it, for the words
   * that say whose a thing is; none for this one. */
  there?: string
  /** The part of it a link names. */
  lit?: string
  /** Runs a window's action for the machine it shows, through the router
   * (ADR 0106, law 3); none in a dialog of the settings. */
  run?: WindowApi["run"]
  /** Whether an action runs for that machine, and why not. */
  runs?: Handles["runs"]
}

export const SECTIONS: Section[] = [
  {
    id: "general",
    title: "General",
    icon: SettingsIcon,
    about: "Banda's engine, its fence, and where its settings files are.",
    machine: true,
    Body: General,
  },
  {
    id: "projects",
    title: "Projects",
    icon: FoldersIcon,
    about:
      "The folders you and your Agents work in. Banda's engine keeps them, not a file.",
    machine: true,
    Body: ProjectsSettings,
  },
  {
    // ADR 0095, decision 9: this machine's machine.toml, which its engine
    // writes, and the other machines of hosts.toml, which main does.
    id: "machines",
    title: "Machines",
    icon: MonitorSmartphoneIcon,
    // sidebar.toml's [machines] shows here alone, in its Show card, and
    // with another machine in hosts.toml.
    files: [
      { name: "machine.toml" },
      {
        name: "sidebar.toml",
        tables: ["machines"],
        drawn: true,
        found: showRows(),
        others: true,
      },
    ],
    about:
      "Where your Projects and Agents run. Each machine names itself, and every window shows that name.",
    machine: false,
    Body: MachinesSettings,
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
    // How the Tiling behaves (ADR 0127, decision 4): the Person's, one
    // for every device. What of the columns is this screen's stays in
    // Appearance, in look.toml.
    id: "tiling",
    title: "Tiling",
    icon: Columns3Icon,
    files: [
      // The Flow, and any key the file gains; the rules are the Foot's.
      { name: "tiling.toml", drawnKeys: ["rule"], found: [RULES_ROW] },
      { name: "tiling.toml", tables: ["columns"], title: "Widths" },
    ],
    about: aboutOf("tiling.toml"),
    custom: { "columns.presets": Shares, "columns.heights": Shares },
    Foot: TilingRules,
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
      {
        name: "browser.toml",
        tables: ["agents"],
        title: "Agent tools",
        drawnKeys: ["agents.sites"],
      },
    ],
    about: aboutOf("browser.toml"),
    Foot: BrowserSites,
  },
  {
    id: "terminal",
    title: "Terminal",
    icon: TerminalIcon,
    files: [{ name: "terminal.toml" }],
    about: aboutOf("terminal.toml"),
  },
  {
    id: "files",
    title: "Files",
    icon: FolderIcon,
    files: [{ name: "files.toml" }],
    about: aboutOf("files.toml"),
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
      "What broke in Banda itself, kept on the machine it broke on. Sharing sends a report only if you turn it on.",
    machine: true,
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
    // Not `files`: that is the Files App's section above, and a link
    // opens the first section with its id.
    id: "settings-files",
    title: "Settings files",
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
    if (file.drawnKeys?.includes(row.key)) return false
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

/** Whether a section shows the part of the machine picked under "Settings
 * for" (ADR 0106, step 5b): as it says, else as one of its files has a
 * part of the machine's. */
export function switches(section: Section): boolean {
  return (
    section.machine ??
    (section.files ?? []).some((file) => hasMachinePart(file.name))
  )
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
const INDEX = SECTIONS.flatMap((section) => {
  const entry = (row: Row, others?: boolean) => ({
    section,
    row,
    others,
    words: `${row.title} ${row.key} ${row.about}`.toLowerCase(),
  })
  return [
    ...groupsOf(section).flatMap((group) =>
      group.rows.map((row) => entry(row))
    ),
    ...(section.files ?? []).flatMap((file) =>
      (file.found ?? []).map((row) => entry(row, file.others))
    ),
  ]
})

/** The rows in any section that say `words`, as the window's machines
 * stand: `others`, another machine in `hosts.toml`. */
export function search(
  words: string,
  others = true
): { section: Section; row: Row }[] {
  const wanted = words.trim().toLowerCase()
  return INDEX.filter(
    (entry) => entry.words.includes(wanted) && (others || !entry.others)
  )
}

/** A link's section and row: `appearance/tile.border`. */
export function parseLink(link: string): { section: Section; key?: string } {
  const [id, key] = link.split("/")
  const section = SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!
  return { section, key: key || undefined }
}
