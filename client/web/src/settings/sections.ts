/**
 * The settings Pane's sections (ADR 0016, decision 8): the Window's own,
 * which are here, and each App's, which the App declares
 * (`Module.settings`; the window's rule 4), in the modules' order. What a
 * section is, `@banda/ui/settings` says.
 */
import type { Section, SectionFile } from "@banda/ui/settings"
import { aboutOf, type Row, rowsOf, titleOf } from "@banda/contract/settings"
import {
  BellIcon,
  BugIcon,
  Columns3Icon,
  FileCogIcon,
  FoldersIcon,
  KeyboardIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  PanelLeftIcon,
  SettingsIcon,
  Share2Icon,
} from "lucide-react"
import { modules } from "../modules"
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
import { RULES_ROW, Shares, TilingRules, Width } from "./Tiling"

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
    // The rules' row opens the file, where a rule is written.
    openFile: false,
    custom: {
      "columns.default": Width,
      "columns.alone": Width,
      "columns.presets": Shares,
      "columns.heights": Shares,
    },
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
  // Each App's own, as it declares it.
  ...modules.flatMap((module) => module.settings ?? []),
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
