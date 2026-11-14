/**
 * A section of Settings (ADR 0016, decision 8), as the Window declares its
 * own and an App its one (`Module.settings`; the window's rule 4). Sections
 * follow what a Person looks for, not the files: a section names its files
 * and the tables of each that it shows, and its rows come from the file's
 * schema, so a new key in Rust shows with no list kept beside it; a row
 * the schema cannot draw well, the section draws itself (decision 4).
 */
import type { ComponentType, ReactNode } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { Row, Setting } from "@banda/contract/settings"
import type { LucideIcon } from "lucide-react"
import type { Args, WindowApi } from "./module"
import type { PaneProps, PaneState } from "./pane"

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
  /** Its part of a link: `appearance` in `appearance/radius`. An App's
   * is the App's id. */
  id: string
  title: string
  icon: LucideIcon
  /** The files its rows are in, its own first: the one it opens, and
   * the one its Body draws. None for Settings files, which lists them. */
  files?: SectionFile[]
  /** What it holds, under its title. */
  about: string
  /** Whether it shows one machine's part, the one picked under "Settings
   * for": said where its files do not say it. General, Projects and
   * Problems show what a machine's engine keeps, in no file (ADR 0124,
   * principle 9); Machines shows every machine itself. */
  machine?: boolean
  /** Its own rows, by key. */
  custom?: { [key: string]: CustomRow }
  /** What it shows instead of its first file's rows; `lit` is the part a
   * link names. */
  Body?: ComponentType<SectionProps>
  /** What it shows under its rows. */
  Foot?: ComponentType<SectionProps>
}

/** How a row writes a settings file: the words of what was wrong, none
 * when it was written. */
export type SettingsWriter = {
  set: (file: string, key: string, value: string) => Promise<string[]>
  reset: (file: string, key: string) => Promise<string[]>
}

/** What a section's own Body and Foot are drawn with. */
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
  runs?: PaneProps<Args>["runs"]
  /** Writes the files of the machine it shows, through that machine's
   * engine as the Person (ADR 0108, decision 1): a machine away refuses
   * at once, in its words. */
  writer: SettingsWriter
  /** Writes this device's files, as the look reads them; none where the
   * window does not write them, as in a browser. */
  device?: SettingsWriter
  /** Shows a file of this computer's in its folder, for the Person to
   * open; none for another machine's, which this computer cannot open
   * (ADR 0106, decision 7). */
  reveal?: (file: string) => void
  /** Shows a Pane of `project` over the settings, in a dialog, as the
   * terminal a sign-in runs in: of the window's actions it runs only a
   * link's, which opens in this device's browser. */
  open: (pane: PaneState, project: ProjectId) => void
}
