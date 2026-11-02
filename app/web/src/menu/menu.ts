/**
 * What the Banda menu lists (ADR 0017): empty, the Recent Threads and the
 * Actions run most; typed into, the Threads, Spaces, what the modules'
 * sources find (ADR 0022, decision 4) and the Actions that fit the words,
 * then the sources' rows with no heading, as New Thread with them. A
 * Space and the sidebar's view are branches the menu goes into, as
 * Omarchy's menu does, and `Tab` shows what can be done with a row. Plain
 * data, so the window only draws it. It knows no module.
 */
import type { SpaceId, SpaceSummary } from "@banda/contract"
import { waits } from "@banda/ui/components/banda-mark"
import type { Key } from "@banda/ui/lib/keys"
import type { Listed } from "@banda/ui/pane"
import type { Action, MenuRow } from "@banda/ui/module"
import { keyName } from "../actions/actions"
import type { Lists } from "../bar/Watches"
import type { Shell } from "../shell/actions"
import { settles } from "../sidebar/settled"

/** Where the menu opens: its root, or its Actions, as the key sheet. */
export type At = "root" | "actions"

/** The key that opens the menu, as the sidebar's field shows it. */
export const MENU_KEY: Key = { code: "Space", alt: true }

/** One row, and what choosing it does. */
export type Choice =
  /** Opens the Thread; `beside` brings it to this workspace. */
  | {
      kind: "thread"
      id: string
      space: SpaceId
      listed: Listed
      beside?: true
    }
  /** A branch: the Space's Threads, and a new one there. */
  | { kind: "space"; id: string; space: SpaceSummary }
  /** A branch: the sidebar's presets. */
  | { kind: "views"; id: string }
  | { kind: "action"; id: string; action: Action<Shell> }
  /** A branch: a family of actions, as the key sheet folds them. */
  | {
      kind: "family"
      id: string
      title: string
      actions: readonly Action<Shell>[]
    }
  /** Waits for a key and binds it to the action, in `keys.toml`. */
  | { kind: "bind"; id: string; action: Action<Shell> }
  /** Frees one of the action's keys, in `keys.toml`. */
  | { kind: "free"; id: string; action: Action<Shell>; key: Key }
  /** A new Thread: with `words`, in `space` where given; the menu's own
   * Alt+Enter, and a Space's Tab. */
  | { kind: "ask"; id: string; words: string; space?: SpaceId }
  /** What a module's source found; choosing it runs it. */
  | { kind: "found"; id: string; row: MenuRow }
  /** Arranges the sidebar by a preset (ADR 0008). */
  | { kind: "preset"; id: string; name: string; current: boolean }
  /** Settles a Thread, or brings it back. */
  | { kind: "settle"; id: string; space: SpaceId; listed: Listed }

/** A row the menu goes into rather than runs. */
export type Branch = Extract<Choice, { kind: "space" | "views" | "family" }>

export function isBranch(row: Choice): row is Branch {
  return row.kind === "space" || row.kind === "views" || row.kind === "family"
}

/** A row that changes the keys, which the menu does itself, staying open. */
export type Keying = Extract<Choice, { kind: "bind" | "free" }>

export function isKeying(row: Choice): row is Keying {
  return row.kind === "bind" || row.kind === "free"
}

/** A branch's name, as its chip in the field shows it. */
export function branchName(branch: Branch): string {
  switch (branch.kind) {
    case "space":
      return branch.space.name
    case "family":
      return branch.title
    case "views":
      return VIEWS
  }
}

const VIEWS = "Sidebar view"

/** The sidebar's view, as the branch the menu goes into. */
const VIEWS_BRANCH: Branch = { kind: "views", id: "views" }

/** A Space, as the branch the menu goes into. */
function spaceBranch(space: SpaceSummary): Branch {
  return { kind: "space", id: `space:${space.id}`, space }
}

/** Where the menu opens: at its root or its Actions, inside the
 * branches of `path`, with `words` typed. Each opening is new: the menu
 * starts again at it, though it is open. */
export type Opening = { n: number; at: At; path: Branch[]; words: string }

let openings = 0

/** The menu as Alt+Space opens it, or Alt+K at its Actions. */
export function openingAt(at: At, path: Branch[] = [], words = ""): Opening {
  return { n: ++openings, at, path, words }
}

/**
 * Where `banda menu ROUTE` opens the menu (ADR 0017, decision 7): an
 * empty route at its root, `actions` at its Actions, `views` in the
 * sidebar's view, `space.<name>` (or its ID) in a Space. Any other words
 * open it with them typed in. Settings routes are the desktop's: it
 * opens the settings Pane at them.
 */
export function openingOf(
  route: string,
  spaces: readonly SpaceSummary[]
): Opening {
  const words = route.trim()
  if (words === "actions") return openingAt("actions")
  if (words === "views") return openingAt("root", [VIEWS_BRANCH])
  const named = /^space\.(.+)$/.exec(words)?.[1].toLowerCase()
  const space = spaces.find(
    (one) => one.id === named || one.name.toLowerCase() === named
  )
  return space
    ? openingAt("root", [spaceBranch(space)])
    : openingAt("root", [], words)
}

/** A group of rows under its heading; the fallback row has none. */
export type Group = {
  label: string
  rows: Choice[]
}

/** What the menu lists besides the words typed. */
export type Sources = {
  lists: Lists
  spaces: readonly SpaceSummary[]
  actions: readonly Action<Shell>[]
  /** The sidebar's presets, and the one in force. */
  presets: { names: readonly string[]; current: string }
  /** Whether a Thread is settled now. */
  settled: (listed: Listed) => boolean
  /** What the modules' sources found for the words, in the modules'
   * order, each under its source's heading. */
  found: readonly Found[]
  /** How often and lately a row was chosen, by its id: more ranks first
   * among equal matches. */
  weight: (id: string) => number
}

/** The rows one source found, under its heading. */
export type Found = { label: string; rows: readonly MenuRow[] }

/** The Actions an empty menu offers, as T3 Code's palette offers its own. */
export const ROOT_ACTIONS = [
  "thread.new",
  "browser.new",
  "pane.new",
  "calls.answer",
  "overview.toggle",
]

/** The key sheet's sections first, in this order; a module's own section
 * (`Action.section`) after them. */
const SECTIONS = ["Threads", "Panes", "Columns", "Workspaces", "Banda"]

/** How many rows of each group a search shows. */
const SHOWN = { threads: 8, spaces: 5, actions: 8, recent: 6 }

/**
 * The menu's rows for `words`: opened `at` its root or its Actions, or
 * `inside` a branch.
 */
export function menuOf({
  words,
  at,
  inside,
  sources,
}: {
  words: string
  at: At
  inside?: Branch
  sources: Sources
}): Group[] {
  const { lists, spaces, presets, found, weight } = sources
  const query = words.trim()
  const byWeight = (row: Choice) => weight(row.id)
  // The actions, and the branches among them, as one list.
  const actions = sources.actions.filter((action) => !action.unlisted)
  const actionRows: Choice[] = [...actions.map(actionRow), VIEWS_BRANCH]
  // What the sources found: the groups with a heading, by it in the
  // modules' order, and the rows with none.
  const headed = new Map<string, Choice[]>()
  for (const { label, rows } of found)
    if (label)
      headed.set(label, [...(headed.get(label) ?? []), ...rows.map(foundRow)])
  const sourced: Group[] = [...headed].map(([label, rows]) => ({ label, rows }))
  const last: Group = {
    label: "",
    rows: found
      .filter((one) => !one.label)
      .flatMap((one) => one.rows.map(foundRow)),
  }
  const actionTexts = (row: Choice) =>
    row.kind === "action" ? [row.action.title, row.action.id] : [VIEWS]
  const threadsOf = (space: string, listed: readonly Listed[]) =>
    listed.map((one) => ({
      kind: "thread" as const,
      id: `thread:${space}:${one.id}`,
      space: space as SpaceId,
      listed: one,
    }))
  const fitting = <Row extends Choice>(
    rows: readonly Row[],
    texts: (row: Row) => string[]
  ): Row[] => (query ? ranked(rows, query, texts, byWeight) : [...rows])

  if (inside?.kind === "views")
    return nonEmpty([
      {
        label: "",
        rows: fitting(
          presets.names.map((name) => ({
            kind: "preset" as const,
            id: `preset:${name}`,
            name,
            current: name === presets.current,
          })),
          (row) => [row.name]
        ),
      },
    ])
  if (inside?.kind === "space") {
    const here = inside.space.id
    // Its new Thread first, as its sources find it, then its Threads.
    return nonEmpty([
      last,
      {
        label: "Threads",
        rows: fitting(
          threadsOf(here, lists[here] ?? []).toSorted(byRecent),
          threadTexts
        ),
      },
      ...sourced,
    ])
  }

  if (inside?.kind === "family")
    return nonEmpty([
      { label: "", rows: fitting(inside.actions.map(actionRow), actionTexts) },
    ])
  if (at === "actions") {
    if (query)
      return nonEmpty([
        { label: "Actions", rows: fitting(actionRows, actionTexts) },
      ])
    // The key sheet: every action by section, a family as one row, and
    // the sidebar's view with the Threads.
    const sections = new Map<string, Choice[]>(
      SECTIONS.map((label) => [label, []])
    )
    const families = new Map<string, Action<Shell>[]>()
    for (const action of actions) {
      if (!sections.has(action.section)) sections.set(action.section, [])
      const rows = sections.get(action.section) ?? []
      const { family } = action
      if (!family) rows.push(actionRow(action))
      else if (families.has(family)) families.get(family)?.push(action)
      else {
        const members = [action]
        families.set(family, members)
        rows.push({
          kind: "family",
          id: `family:${family}`,
          title: family,
          actions: members,
        })
      }
    }
    sections.get("Threads")?.push(VIEWS_BRANCH)
    return nonEmpty([...sections].map(([label, rows]) => ({ label, rows })))
  }

  const threads = Object.entries(lists).flatMap(([space, listed]) =>
    threadsOf(space, listed)
  )
  if (!query) {
    // The actions run most, then the ones T3 Code's palette offers.
    const usual = (row: Choice) => {
      const place =
        row.kind === "action" ? ROOT_ACTIONS.indexOf(row.action.id) : -1
      return place === -1 ? ROOT_ACTIONS.length : place
    }
    const offered = actionRows
      .filter(
        (row) =>
          byWeight(row) > 0 ||
          (row.kind === "action" && ROOT_ACTIONS.includes(row.action.id))
      )
      .toSorted((a, b) => byWeight(b) - byWeight(a) || usual(a) - usual(b))
      .slice(0, ROOT_ACTIONS.length)
    return nonEmpty([
      {
        label: "Recent Threads",
        rows: threads.toSorted(byRecent).slice(0, SHOWN.recent),
      },
      { label: "Actions", rows: offered },
    ])
  }

  return nonEmpty([
    {
      label: "Threads",
      rows: fitting(threads, threadTexts).slice(0, SHOWN.threads),
    },
    {
      label: "Spaces",
      rows: fitting(spaces.map(spaceBranch), (row) =>
        row.kind === "space" ? [row.space.name] : []
      ).slice(0, SHOWN.spaces),
    },
    ...sourced,
    {
      label: "Actions",
      rows: fitting(actionRows, actionTexts).slice(0, SHOWN.actions),
    },
    last,
  ])
}

/** One thing that can be done with a row, as `Tab` lists them. */
export type Act = { title: string; key?: Key; row: Choice }

/** The keys a row's acts take in the menu. */
export const OPEN: Key = { code: "Enter" }
const BESIDE: Key = { code: "Enter", shift: true }

/** What can be done with `row`, the first as `Enter` does it. */
export function actsOf(row: Choice, sources: Sources): Act[] {
  const { settled } = sources
  switch (row.kind) {
    case "thread": {
      const acts: Act[] = [
        { title: "Open", key: OPEN, row },
        { title: "Open beside", key: BESIDE, row: { ...row, beside: true } },
      ]
      const now = settled(row.listed)
      if (now || settles(row.listed))
        acts.push({
          title: now ? "Un-settle thread" : "Settle thread",
          row: {
            kind: "settle",
            id: `settle:${row.listed.id}`,
            space: row.space,
            listed: row.listed,
          },
        })
      return acts
    }
    case "space":
      return [
        { title: "Open", key: OPEN, row },
        {
          title: "New Thread here",
          row: {
            kind: "ask",
            id: `ask:${row.space.id}`,
            words: "",
            space: row.space.id,
          },
        },
      ]
    case "found":
      return (row.row.acts ?? []).map((act) => ({
        title: act.title,
        key: act.key,
        // An act counts as its row, chosen.
        row: foundRow({ ...row.row, run: act.run }),
      }))
    case "action":
      return [
        { title: "Run", key: OPEN, row },
        {
          title: "Add a key…",
          row: {
            kind: "bind",
            id: `bind:${row.action.id}`,
            action: row.action,
          },
        },
        ...(row.action.keys ?? []).map((key) => ({
          title: `Free ${keyName(key)}`,
          row: {
            kind: "free" as const,
            id: `free:${keyName(key)}`,
            action: row.action,
            key,
          },
        })),
      ]
    default:
      return []
  }
}

function actionRow(action: Action<Shell>): Choice {
  return { kind: "action", id: `action:${action.id}`, action }
}

function foundRow(row: MenuRow): Choice {
  return { kind: "found", id: row.id, row }
}

/** What waits first, then what changed last: the sidebar's order. */
function byRecent(a: { listed: Listed }, b: { listed: Listed }): number {
  return (
    Number(waits(b.listed.mark)) - Number(waits(a.listed.mark)) ||
    b.listed.changed - a.listed.changed
  )
}

function threadTexts({ listed }: { listed: Listed }): string[] {
  return [listed.title, listed.said ?? "", listed.calls ?? ""]
}

/**
 * The things that fit every word of `query`, the best first: a text that
 * is the query, then one that starts with it, then one with a word that
 * starts with it, then one that holds every word. The first text counts
 * most; among equals the one that weighs more, then the list's order.
 */
export function ranked<Thing>(
  things: readonly Thing[],
  query: string,
  texts: (thing: Thing) => string[],
  weight: (thing: Thing) => number = () => 0
): Thing[] {
  const lower = query.toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const rank = (thing: Thing) => {
    let best: number | undefined
    texts(thing).forEach((text, place) => {
      const found = rankOf(text.toLowerCase(), lower, words)
      if (found === undefined) return
      const score = found + place * 4
      if (best === undefined || score < best) best = score
    })
    return best
  }
  return things
    .flatMap((thing, order) => {
      const found = rank(thing)
      return found === undefined
        ? []
        : [{ thing, order, rank: found, weight: weight(thing) }]
    })
    .sort((a, b) => a.rank - b.rank || b.weight - a.weight || a.order - b.order)
    .map((found) => found.thing)
}

function rankOf(
  text: string,
  query: string,
  words: string[]
): number | undefined {
  if (text === query) return 0
  if (text.startsWith(query)) return 1
  if (text.includes(` ${query}`) || text.includes(`.${query}`)) return 2
  if (words.every((word) => text.includes(word))) return 3
  return undefined
}

function nonEmpty(groups: Group[]): Group[] {
  return groups.filter((group) => group.rows.length > 0)
}
