/**
 * The sidebar's one rule (ADR 0008): every Space's list, the Spaces and
 * the settings in; the sections and their rows out. The sidebar only draws
 * what it returns. Pure, so plain tests cover every preset and key.
 */
import type { SpaceId, SpaceSummary } from "@bandaso/contract"
import { loudest, type MarkState } from "@bandaso/ui/components/banda-mark"
import type { Listed } from "@bandaso/ui/pane"
import type { Settings, State } from "./settings"

/** One row: what a module listed, and the Space it is in. */
export type Row = { space: SpaceSummary; listed: Listed }

export type Section = {
  /** A state, or a Space's id. */
  key: string
  /** The state's words, or the Space's name. */
  label: string
  /** The Space a section of `group.by = "space"` holds. */
  space?: SpaceSummary
  rows: Row[]
  folded: boolean
  /** The loudest mark of its rows, and how many need the Person. */
  mark: MarkState
  waiting: number
}

/** One line of the list of Spaces. */
export type SpaceLine = {
  space: SpaceSummary
  mark: MarkState
  waiting: number
  count: number
}

export type Arranged = {
  /** The list of Spaces, when the settings ask for it. */
  spaces?: SpaceLine[]
  sections: Section[]
  shelves: Section[]
}

export const STATE_WORDS: Record<State, string> = {
  needs: "Needs you",
  done: "Done",
  working: "Working",
  idle: "Quiet",
}

/** What a mark means to the sidebar. */
export function stateOf(mark: MarkState): State {
  switch (mark) {
    case "asking":
    case "failed":
    case "offline":
      return "needs"
    case "done":
      return "done"
    case "running":
    case "thinking":
      return "working"
    default:
      return "idle"
  }
}

const RANK: Record<State, number> = { needs: 0, done: 1, working: 2, idle: 3 }

/**
 * @param lists what each Space lists
 * @param only shows only this Space's rows, as a click in the list of
 * Spaces asks
 * @param toggled the sections the Person folded or opened, against what
 * the settings start with
 */
export function arrange(
  lists: Readonly<Record<SpaceId, readonly Listed[]>>,
  spaces: readonly SpaceSummary[],
  settings: Settings,
  only?: SpaceId,
  toggled: ReadonlySet<string> = new Set()
): Arranged {
  const all: Row[] = spaces.flatMap((space) =>
    (lists[space.id] ?? []).map((listed) => ({ space, listed }))
  )
  const rows = all
    .filter((row) => only === undefined || row.space.id === only)
    .sort(order(settings.sort.by))
  const folds = (key: string, name = key) =>
    (settings.group.folded.includes(name) ||
      settings.group.folded.includes(key)) !== toggled.has(key)
  const section = (
    key: string,
    label: string,
    held: Row[],
    space?: SpaceSummary,
    name?: string
  ): Section => ({
    key,
    label,
    ...(space ? { space } : {}),
    rows: held,
    folded: folds(key, name),
    ...rollup(held),
  })
  const kept = (sections: Section[]) =>
    settings.group.empty === "show"
      ? sections
      : sections.filter((section) => section.rows.length > 0)

  const listed = settings.spaces.list
    ? { spaces: spaceLines(all, spaces, settings) }
    : {}

  switch (settings.group.by) {
    case "space":
      return {
        ...listed,
        sections: kept(
          orderSpaces(all, spaces, settings).map((space) =>
            section(
              space.id,
              space.name,
              rows.filter((row) => row.space.id === space.id),
              space,
              space.name
            )
          )
        ),
        shelves: [],
      }
    case "none":
      return {
        ...listed,
        sections: kept([section("all", "", rows)]),
        shelves: [],
      }
    case "state": {
      const { states, bottom } = settings.group
      const of = (state: State) =>
        rows.filter((row) => stateOf(row.listed.mark) === state)
      const sections = states.map((state) =>
        section(state, STATE_WORDS[state], of(state))
      )
      // A state the settings name nowhere goes to the last section, so no
      // row is ever hidden.
      const placed = new Set<State>([...states, ...bottom])
      const rest = rows.filter((row) => !placed.has(stateOf(row.listed.mark)))
      if (rest.length > 0) {
        const last = sections.at(-1)
        if (last) {
          const joined = [...last.rows, ...rest].sort(order(settings.sort.by))
          sections[sections.length - 1] = {
            ...last,
            rows: joined,
            ...rollup(joined),
          }
        } else {
          sections.push(section("all", "", rest))
        }
      }
      return {
        ...listed,
        sections: kept(sections),
        shelves: kept(
          bottom.map((state) => section(state, STATE_WORDS[state], of(state)))
        ),
      }
    }
  }
}

function order(by: Settings["sort"]["by"]): (a: Row, b: Row) => number {
  const latest = (a: Row, b: Row) => b.listed.changed - a.listed.changed
  switch (by) {
    case "attention":
      return (a, b) =>
        RANK[stateOf(a.listed.mark)] - RANK[stateOf(b.listed.mark)] ||
        latest(a, b)
    case "title":
      return (a, b) =>
        a.listed.title.localeCompare(b.listed.title) || latest(a, b)
    case "changed":
      return latest
  }
}

function rollup(rows: readonly Row[]): { mark: MarkState; waiting: number } {
  return {
    mark: loudest(rows.map((row) => row.listed.mark)),
    waiting: rows.filter((row) => stateOf(row.listed.mark) === "needs").length,
  }
}

/** The Spaces in the settings' order; one with nothing listed goes last. */
function orderSpaces(
  rows: readonly Row[],
  spaces: readonly SpaceSummary[],
  settings: Settings
): SpaceSummary[] {
  const changed = (space: SpaceSummary) =>
    Math.max(
      -Infinity,
      ...rows
        .filter((row) => row.space.id === space.id)
        .map((row) => row.listed.changed)
    )
  return [...spaces].sort((a, b) =>
    settings.spaces.order === "name"
      ? a.name.localeCompare(b.name)
      : changed(b) - changed(a) || a.name.localeCompare(b.name)
  )
}

function spaceLines(
  rows: readonly Row[],
  spaces: readonly SpaceSummary[],
  settings: Settings
): SpaceLine[] {
  return orderSpaces(rows, spaces, settings).map((space) => {
    const held = rows.filter((row) => row.space.id === space.id)
    return { space, count: held.length, ...rollup(held) }
  })
}
