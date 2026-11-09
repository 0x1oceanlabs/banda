/**
 * What the Banda menu lists (ADR 0017): empty, the Recent Threads and the
 * Actions run most; typed into, the Threads, Projects, what the modules'
 * sources find (ADR 0022, decision 4) and the Actions that fit the words,
 * then the sources' rows with no heading, as New Thread with them. A
 * Project and the sidebar's view are branches the menu goes into, as
 * Omarchy's menu does, and `Tab` shows what can be done with a row. Plain
 * data, so the window only draws it. It knows no module.
 */
import type {
  Browsed,
  Foreign,
  ProjectId,
  ProjectSummary,
} from "@banda/contract"
import { waits } from "@banda/ui/components/banda-mark"
import { type Key, keyLabel, keyText } from "@banda/ui/lib/keys"
import type { Listed, Lists } from "@banda/ui/pane"
import type { Action, ItemAction, MenuRow } from "@banda/ui/module"
import type { Shell } from "../window/actions"
import { type Answer, ANSWERS } from "../trust/trust"

/** Where the menu opens: its root, or its Actions, as the key sheet. */
export type At = "root" | "actions"

/** One row, and what choosing it does. */
export type Choice =
  /** Opens the Thread; `beside` brings it to this workspace. */
  | {
      kind: "thread"
      id: string
      project: ProjectId
      listed: Listed
      beside?: true
    }
  /** A branch: the Project's Threads, and a new one there. */
  | { kind: "project"; id: string; project: ProjectSummary }
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
  /** A new Thread: with `words`, in `project` where given; the menu's own
   * Alt+Enter, and a Project's Tab. */
  | { kind: "ask"; id: string; words: string; project?: ProjectId }
  /** What a module's source found; choosing it runs it. */
  | { kind: "found"; id: string; row: MenuRow }
  /** Arranges the sidebar by a preset (ADR 0008). */
  | { kind: "preset"; id: string; name: string; current: boolean }
  /** Runs one of a Thread's item actions on it, by its id (ADR 0087,
   * decision 12): Later…, Wake now, Archive thread. */
  | {
      kind: "item"
      id: string
      action: string
      project: ProjectId
      listed: Listed
    }
  /** A branch: the ways to add a Project (ADR 0026). */
  | { kind: "add"; id: string }
  /** A branch: one way to add a Project; the field takes its name or path. */
  | { kind: "source"; id: string; source: Source }
  /** Adds a Project: a new one by its name, or a folder on disk. */
  | { kind: "adding"; id: string; how: Adding }
  /** A branch: whether to trust a folder on disk that looks foreign, as
   * it is added (ADR 0083, decision 5; ADR 0084, decision 13). Its folder
   * is as it was typed or picked. */
  | { kind: "trust"; id: string; how: FolderAdding; foreign: Foreign }
  /** An answer to that: adds the folder, trusted as `how` says. */
  | { kind: "answer"; id: string; how: FolderAdding; answer: Answer }
  /** A folder the path field lists, or the one above (`up`): choosing it
   * types `path`, as the Person typed the path, to go on in. */
  | { kind: "folder"; id: string; name: string; path: string; up?: true }
  /** A branch: the path field that finds a missing Project's folder. */
  | { kind: "locate"; id: string; project: ProjectSummary }
  /** A branch: one module's source alone, its rows with no words too,
   * as quick open shows the Project's files (ADR 0073, decision 11). */
  | { kind: "finds"; id: string; source: string; label: string }

/** How a Project is added: a new folder by its name, or a folder on disk,
 * made first when it does not exist, trusted as the Person answered when
 * it looks foreign; or where a missing Project's folder is now (ADR 0026,
 * decision 6). */
export type Adding =
  { name: string } | FolderAdding | { locate: ProjectId; folder: string }

/** A folder on disk to add, made first when `create` says so. */
export type FolderAdding = {
  folder: string
  create: boolean
  trusted?: boolean
}

/** The ways to add a Project, as T3 Code's "Add project" lists them, in
 * their order. */
export const SOURCE_ORDER = ["new", "folder"] as const
export type Source = (typeof SOURCE_ORDER)[number]

const BRANCHES = [
  "project",
  "views",
  "family",
  "add",
  "source",
  "locate",
  "finds",
  "trust",
] as const
const OWN = ["bind", "free", "adding", "answer", "folder"] as const

/** A row the menu goes into rather than runs. */
export type Branch = Extract<Choice, { kind: (typeof BRANCHES)[number] }>

export function isBranch(row: Choice): row is Branch {
  return (BRANCHES as readonly string[]).includes(row.kind)
}

/** A row the menu runs itself: a key to change, a Project to add, a folder
 * to type. */
export type Own = Extract<Choice, { kind: (typeof OWN)[number] }>

export function isOwn(row: Choice): row is Own {
  return (OWN as readonly string[]).includes(row.kind)
}

/** A branch's name, as its chip in the field shows it. */
export function branchName(branch: Branch): string {
  switch (branch.kind) {
    case "project":
      return branch.project.name
    case "family":
      return branch.title
    case "views":
      return VIEWS
    case "add":
      return ADD_PROJECT
    case "source":
      return SOURCES[branch.source].title
    case "locate":
      return LOCATE
    case "finds":
      return branch.label
    case "trust":
      return folderName(branch.how.folder)
  }
}

const VIEWS = "Sidebar view"
const ADD_PROJECT = "Add Project"
/** T3 Code's words for finding a missing folder. */
export const LOCATE = "Locate folder"

/** Each way to add a Project: its row's words. */
export const SOURCES: Record<Source, { title: string; about: string }> = {
  new: { title: "New Project", about: "Start a new Project from a name" },
  folder: { title: "Local folder", about: "Browse a folder on disk" },
}

/** "Add Project", as the branch the menu goes into. */
const ADD_BRANCH: Branch = { kind: "add", id: "project.add" }

function sourceBranch(source: Source): Branch {
  return { kind: "source", id: `project.add.${source}`, source }
}

/** Whether the field is a path, as in "Local folder" and "Locate
 * folder". */
export function isPathField(inside: Branch | undefined): boolean {
  return (
    inside?.kind === "locate" ||
    (inside?.kind === "source" && inside.source === "folder")
  )
}

/** What the field holds as the menu goes into `path`: the path field
 * starts at the home folder, or where the missing folder was. */
export function wordsIn(path: readonly Branch[]): string {
  const inside = path.at(-1)
  if (inside?.kind === "locate")
    return inside.project.folder.replace(/[^/]*$/, "")
  return isPathField(inside) ? "~/" : ""
}

/** A path field's text after a new path is typed over the old one: the
 * new one wins, as in GTK's location bar. `~/~/code` is `~/code`,
 * `~//etc` is `/etc`. */
export function restarted(words: string): string {
  const again = Math.max(words.lastIndexOf("/~/"), words.lastIndexOf("//"))
  return again < 0 ? words : words.slice(again + 1)
}

/** What a folder in a path field does: added, made first when `create`,
 * or found as the missing Project's, which only a folder that is there
 * can be. */
export function pathAdding(
  inside: Branch | undefined,
  folder: string,
  create = false
): Adding | undefined {
  if (inside?.kind !== "locate") return { folder, create }
  return create ? undefined : { locate: inside.project.id, folder }
}

/** The folder on disk adding `how` looks at first, there or to be made,
 * as the Person has not said whether to trust it yet. A new Project from
 * a name, under Banda's root, asks nothing, and a located one keeps its
 * trust. */
export function lookedAt(how: Adding): FolderAdding | undefined {
  return "create" in how && how.trusted === undefined ? how : undefined
}

/** The question a folder that looks foreign asks, as the branch the menu
 * goes into from its path. */
export function trustBranch(how: FolderAdding, foreign: Foreign): Branch {
  return { kind: "trust", id: "project.add.trust", how, foreign }
}

type AnswerRow = Extract<Choice, { kind: "answer" }>

/** The answers to the question: Not yet first, which Enter takes. */
function trustRows(how: FolderAdding): AnswerRow[] {
  const row = (answer: Answer, trusted: boolean): AnswerRow => ({
    kind: "answer",
    id: trusted ? "answer.trust" : "answer.not-yet",
    how: { ...how, trusted },
    answer,
  })
  return [row(ANSWERS.notYet, false), row(ANSWERS.trust, true)]
}

/** Where ⌫ on an empty field goes: the branch above, its field as it is
 * there; back from the question, the path as it was typed. */
export function back(path: readonly Branch[]): {
  path: Branch[]
  words: string
} {
  const left = path.slice(0, -1)
  const from = path.at(-1)
  return {
    path: left,
    words: from?.kind === "trust" ? from.how.folder : wordsIn(left),
  }
}

/** A folder's own name, the last of its path. */
function folderName(folder: string): string {
  return folder.replace(/\/+$/, "").split("/").at(-1) || folder
}

/** The sidebar's view, as the branch the menu goes into. */
const VIEWS_BRANCH: Branch = { kind: "views", id: "views" }

/** A Project, as the branch the menu goes into: one whose folder is
 * missing goes to find it. */
function projectBranch(project: ProjectSummary): Branch {
  return project.missing
    ? locateBranch(project)
    : { kind: "project", id: `project:${project.id}`, project }
}

function locateBranch(project: ProjectSummary): Branch {
  return { kind: "locate", id: locateRoute(project.id), project }
}

/** The route of "Locate folder" for a missing Project. */
export function locateRoute(project: ProjectId): string {
  return `project.locate.${project}`
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

/** The settings Pane's link a route names, `settings.agents.codex` as
 * `agents/codex`; none for a route of the menu's. */
export function settingsLinkOf(route: string): string | undefined {
  const [first, ...rest] = route.trim().split(".")
  return first === "settings" ? rest.join("/") : undefined
}

/**
 * Where `banda menu ROUTE` opens the menu (ADR 0017, decision 7): an
 * empty route at its root, `actions` at its Actions, `views` in the
 * sidebar's view, `project.add` in "Add Project" (`project.add.new`,
 * `project.add.folder` at one of its ways, ADR 0026), `project.locate.<id>`
 * at "Locate folder" for a missing Project, `project.<name>` (or its ID) in
 * a Project, `find.<source>` in a module's source alone, as `find.files.find`
 * in the Project's files. Any other words open it with them typed in. A
 * settings route opens the settings Pane instead (`settingsLinkOf`).
 * Before ADR 0069 the routes said `space.`, which is read as `project.`
 * for one stable release (grace).
 */
export function openingOf(
  route: string,
  projects: readonly ProjectSummary[],
  sources: readonly { id: string; label: string }[] = []
): Opening {
  const words = route.trim().replace(/^space\./, "project.")
  if (words === "actions") return openingAt("actions")
  if (words === "views") return openingAt("root", [VIEWS_BRANCH])
  const finds = sources.find((one) => words === `find.${one.id}`)
  if (finds)
    return openingAt("root", [
      {
        kind: "finds",
        id: `find.${finds.id}`,
        source: finds.id,
        label: finds.label,
      },
    ])
  const adding = /^project\.add(?:\.(new|folder))?$/.exec(words)
  if (adding) {
    const way = adding[1] as Source | undefined
    const path = way ? [ADD_BRANCH, sourceBranch(way)] : [ADD_BRANCH]
    return openingAt("root", path, wordsIn(path))
  }
  // A Project by its name or ID; one whose folder is missing, at
  // "Locate folder".
  const named = /^project\.(?:locate\.)?(.+)$/.exec(words)?.[1].toLowerCase()
  const project = projects.find(
    (one) => one.id === named || one.name.toLowerCase() === named
  )
  if (!project) return openingAt("root", [], words)
  const path = [projectBranch(project)]
  return openingAt("root", path, wordsIn(path))
}

/** A group of rows under its heading; the fallback row has none. */
export type Group = {
  label: string
  rows: Choice[]
}

/** What the menu lists besides the words typed. */
export type Sources = {
  lists: Lists
  projects: readonly ProjectSummary[]
  actions: readonly Action<Shell>[]
  /** The sidebar's presets, and the one in force. */
  presets: { names: readonly string[]; current: string }
  /** Whether a Thread is archived now. */
  archived: (listed: Listed) => boolean
  /** The clock a Thread's Later is read by (ADR 0074). */
  now: number
  /** A Thread's item actions, its App's and the sidebar list's (ADR
   * 0087, decision 12): Tab lists the rows each offers the menu. */
  items: (listed: Listed) => readonly ItemAction<Shell>[]
  /** What the modules' sources found for the words, in the modules'
   * order, each under its source's heading. */
  found: readonly Found[]
  /** How often and lately a row was chosen, by its id: more ranks first
   * among equal matches. */
  weight: (id: string) => number
  /** The folders that fit the path typed, once the engine said them. */
  browsed?: Browsing
}

/** What the engine said for the path `partial`: while the next path is
 * read, its folders still show, but not whether the path exists. */
export type Browsing = Browsed & { partial: string }

/** The rows one source found, under its heading. */
export type Found = { id: string; label: string; rows: readonly MenuRow[] }

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
const SHOWN = { threads: 8, projects: 5, actions: 8, recent: 6 }

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
  const { lists, projects, presets, found, weight } = sources
  const query = words.trim()
  const byWeight = (row: Choice) => weight(row.id)
  // The actions, and the branches among them, as one list.
  const actions = sources.actions.filter((action) => !action.unlisted)
  const actionRows: Choice[] = [
    ...actions.map(actionRow),
    VIEWS_BRANCH,
    ADD_BRANCH,
  ]
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
    row.kind === "action"
      ? [row.action.title, row.action.id]
      : isBranch(row)
        ? [branchName(row)]
        : []
  const threadsOf = (project: string, listed: readonly Listed[]) =>
    listed.map((one) => ({
      kind: "thread" as const,
      id: `thread:${project}:${one.id}`,
      project: project as ProjectId,
      listed: one,
    }))
  const fitting = <Row extends Choice>(
    rows: readonly Row[],
    texts: (row: Row) => string[]
  ): Row[] => (query ? ranked(rows, query, texts, byWeight) : [...rows])

  if (inside?.kind === "finds")
    return nonEmpty([
      {
        label: "",
        rows: found
          .filter((one) => one.id === inside.source)
          .flatMap((one) => one.rows.map(foundRow)),
      },
    ])
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
  if (inside?.kind === "project") {
    const here = inside.project.id
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

  if (inside?.kind === "add")
    return nonEmpty([
      {
        label: "",
        rows: fitting(SOURCE_ORDER.map(sourceBranch), actionTexts),
      },
    ])
  if (inside?.kind === "source" || inside?.kind === "locate")
    return nonEmpty([
      { label: "", rows: addRows(inside, query, sources.browsed) },
    ])
  if (inside?.kind === "trust")
    return nonEmpty([
      {
        label: "",
        rows: fitting(trustRows(inside.how), (row) => [row.answer.title]),
      },
    ])

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
    sections.get("Banda")?.push(ADD_BRANCH)
    return nonEmpty([...sections].map(([label, rows]) => ({ label, rows })))
  }

  const threads = Object.entries(lists).flatMap(([project, listed]) =>
    threadsOf(project, listed)
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
      label: "Projects",
      rows: fitting(projects.map(projectBranch), (row) =>
        "project" in row ? [row.project.name] : []
      ).slice(0, SHOWN.projects),
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
  switch (row.kind) {
    case "thread": {
      const { project, listed } = row
      const at = {
        project: sources.projects.find((one) => one.id === project),
        now: sources.now,
        archived: sources.archived(listed),
      }
      // Each row an item action offers the menu, and is on now, read as
      // the sidebar list's `offeredOf` reads it: this file loads no module.
      const items = sources.items(listed).flatMap((action): Act[] => {
        const shown = action.offered?.includes("menu") && action.row(listed, at)
        if (!shown || shown.off) return []
        // Counted as chosen by what it does, as before item actions (#862).
        const id = `${action.does ?? action.id}:${listed.id}`
        const act: Choice = {
          kind: "item",
          id,
          action: action.id,
          project,
          listed,
        }
        return [{ title: shown.title, row: act }]
      })
      return [
        { title: "Open", key: OPEN, row },
        { title: "Open beside", key: BESIDE, row: { ...row, beside: true } },
        ...items,
      ]
    }
    case "project":
      return [
        { title: "Open", key: OPEN, row },
        {
          title: "New Thread here",
          row: {
            kind: "ask",
            id: `ask:${row.project.id}`,
            words: "",
            project: row.project.id,
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
          title: `Free ${keyLabel(key)}`,
          row: {
            kind: "free" as const,
            id: `free:${keyText(key)}`,
            action: row.action,
            key,
          },
        })),
      ]
    default:
      return []
  }
}

/** The rows of one way to add a Project, or of "Locate folder", for what
 * is typed: the Project to add or locate first, then for a path the folder
 * above and the folders that fit. */
function addRows(
  inside: Extract<Branch, { kind: "source" | "locate" }>,
  query: string,
  browsed: Browsing | undefined
): Choice[] {
  if (inside.kind === "source" && inside.source === "new")
    return query ? [{ kind: "adding", id: "adding", how: { name: query } }] : []
  const { create, folders } = folderRows(query, browsed)
  const how = query ? pathAdding(inside, query, create) : undefined
  return how ? [{ kind: "adding", id: "adding", how }, ...folders] : folders
}

export type Folder = Extract<Choice, { kind: "folder" }>

/**
 * For the path `query`: whether adding it makes its folder first, as the
 * engine said for that path, and the folders to go into: the one above,
 * then those that fit. Each is written as the path was typed, `~/code/`
 * from `~/co`; the one above a path typed at `~/` is whole.
 */
export function folderRows(
  query: string,
  browsed: Browsing | undefined
): { create: boolean; folders: Folder[] } {
  if (!browsed) return { create: false, folders: [] }
  const cut = query.lastIndexOf("/")
  const typed = cut === -1 ? `${query}/` : query.slice(0, cut + 1)
  const folders: Folder[] = []
  if (browsed.parent !== "/") {
    const above = typed.replace(/[^/]+\/$/, "")
    const whole = `${browsed.parent.replace(/\/[^/]*$/, "")}/`
    const path = above || whole
    folders.push({
      kind: "folder",
      id: "folder:..",
      name: "..",
      path,
      up: true,
    })
  }
  for (const { name } of browsed.entries)
    folders.push({
      kind: "folder",
      id: `folder:${name}`,
      name,
      path: `${typed}${name}/`,
    })
  return { create: browsed.partial === query && !browsed.exists, folders }
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
