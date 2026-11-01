/**
 * How the sidebar arranges what it lists (ADR 0008): built-in defaults, a
 * preset over them, and the Person's own keys over both. The keys are
 * `sidebar.toml`'s; until the engine reads that file, the window keeps the
 * preset picked in the view menu.
 */

/** What a Thread's mark means to the sidebar. */
export type State = "needs" | "done" | "working" | "idle"
export const STATES: readonly State[] = ["needs", "done", "working", "idle"]

/** The parts a row is built from; `~` pushes the rest to the right. */
export type Part =
  "mark" | "title" | "space" | "harness" | "status" | "note" | "~"

export type Settings = {
  group: {
    by: "state" | "space" | "none"
    /** The sections, in this order. */
    states: State[]
    /** Shelves at the bottom, each with its count. */
    bottom: State[]
    /** Sections, shelves or Spaces (by name) that start folded. */
    folded: string[]
    /** Rows a section shows before "Show more"; 0 shows all. */
    limit: number
    empty: "hide" | "show"
  }
  sort: { by: "attention" | "changed" | "title" }
  spaces: {
    /** A list of Spaces above the Threads, as Herdr's. */
    list: boolean
    order: "changed" | "name"
    /** A Space shows its loudest mark and how many need the Person. */
    rollup: boolean
    /** Each Space offers a new Thread in it. */
    newThread: boolean
  }
  row: {
    lines: 1 | 2 | 3
    /** Parts left out of the layout. */
    hide: Part[]
    /** A layout of the Person's own, line by line; it replaces `lines`'. */
    layout?: Part[][]
  }
}

/** The keys a preset or a Person sets: any of them, at any depth. */
export type Keys = {
  [Group in keyof Settings]?: Partial<Settings[Group]>
}

export const DEFAULTS: Settings = {
  group: {
    by: "state",
    states: ["needs", "done", "idle"],
    bottom: ["working"],
    folded: [],
    limit: 10,
    empty: "hide",
  },
  sort: { by: "attention" },
  spaces: { list: false, order: "changed", rollup: true, newThread: true },
  row: { lines: 3, hide: [] },
}

/** The presets Banda ships: T3 Code's inbox, Threads by Space, Herdr's. */
export const PRESETS = {
  inbox: {},
  spaces: {
    group: { by: "space", states: [...STATES], bottom: [] },
    row: { lines: 1 },
  },
  places: {
    group: { states: [...STATES], bottom: [], folded: ["idle"] },
    spaces: { list: true },
    row: { lines: 2 },
  },
} satisfies Record<string, Keys>

export type Preset = keyof typeof PRESETS
export const PRESET_NAMES = Object.keys(PRESETS) as Preset[]

/** What each preset is, in a few words, for the view menu. */
export const PRESET_WORDS: Record<Preset, string> = {
  inbox: "What needs you first",
  spaces: "Threads under their Spaces",
  places: "Spaces above, Threads by need",
}

/** The settings a preset and the Person's keys make, over the defaults. */
export function resolve(preset: Preset, keys: Keys = {}): Settings {
  return over(over(DEFAULTS, PRESETS[preset]), keys)
}

function over(base: Settings, keys: Keys): Settings {
  return {
    group: { ...base.group, ...keys.group },
    sort: { ...base.sort, ...keys.sort },
    spaces: { ...base.spaces, ...keys.spaces },
    row: { ...base.row, ...keys.row },
  }
}
