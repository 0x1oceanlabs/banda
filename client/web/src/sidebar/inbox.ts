/**
 * The sidebar as the Person's inbox of their Agents' work (ADR 0098,
 * decisions 1–5, 12 and 24): the rows in, each where `status.ts` says it
 * stands (`rowsOf`), and this machine's Projects that wait for the Person
 * (decision 16); out, each tab's count, the blocks the list draws for the
 * tab in view, what inbox zero or the first run says (decision 25), and
 * the one order of what calls, which `Alt+U` and the counts go by. A
 * Thread another Agent started is its child: at work, it sits under its
 * parent. It never works out where a Thread stands, only where it goes in
 * its place. Pure, with no DOM and no React, so plain tests cover it.
 */
import type { ProjectSummary } from "@banda/contract"
import type { GroupBy } from "@banda/contract/sidebar"
import { loudest, type MarkState } from "@banda/ui/lib/mark-state"
import { lookOf, STAND_WORDS, type Stand } from "@banda/ui/status"
import { itemKey, keyOf, type Row, rowKey } from "./rows"
import { dayAt } from "../calls/later-time"

/** The tabs at the sidebar's top, in their order, as `1`–`4` pick them. */
export type Tab = "inbox" | "working" | "later" | "archive"
export const TABS: readonly Tab[] = ["inbox", "working", "later", "archive"]

/** A place with nothing in it, which says what goes there (decision 25):
 * a tab but the Inbox, whose is inbox zero. */
export type EmptyAt = Exclude<Tab, "inbox">

/** How the Person has the list in view. */
export type InboxView = {
  tab: Tab
  /** Whether the list is grouped by Project (`group` in `sidebar.toml`):
   * not by default. */
  group?: GroupBy
  /** Your turn's order (`[inbox] order`): oldest first by default, so no
   * one waits forever. */
  order?: "oldest" | "newest"
  /** Whether the Inbox shows Open (`[inbox] open`); it does by default. */
  open?: boolean
  /** Whether the Inbox shows the Working shelf (`[inbox] working`); it
   * does by default. */
  working?: boolean
  /** The rest of a cut list shows: the shelf's "+ N more", the Archive's
   * "Show older". */
  more?: boolean
  /** What the Person turned from how it first shows, by its key: the
   * groups they folded, and the parents whose children at work they
   * unfolded past three, by their cards' keys. */
  folded?: ReadonlySet<string>
  /** When inbox zero last said how many sleep until Someday, as this
   * device keeps it; it says so once a week (decision 12). */
  someday?: number
}

/** A row as its place draws it, with the moment its time counts from:
 * the call's, or when it woke; the start of the turn at work; the last
 * change; the wake time, or when it was put off with none; when it was
 * archived. A child also names its parent. */
export type Entry = { row: Row; at: number; child?: Child }

/** A Thread another Agent started through Banda (decision 24): its
 * parent's title, which line 3 says, and whether it sits under its parent
 * with ↳, as at work. */
export type Child = { parent: string; under?: true }

/** What inbox zero says (decision 4): how many work, when the next one
 * wakes by its time, and, once a week, how many sleep until Someday; or,
 * on the first run, that a Project starts it all (decision 25). */
export type Zero = {
  working: number
  next?: number
  someday?: number
  first?: true
}

/** What a Project waits for the Person to do (decision 16): trust it, or
 * find the folder it was in. */
export type ProjectAsks = "trust" | "missing"

/** A Project of this machine that waits for the Person: a card of its
 * own in Your turn, with what it asks. */
export type ProjectCall = { project: ProjectSummary; asks: ProjectAsks }

/** The look a Project's card shows: one to trust asks, as a question
 * does; one whose folder is gone stops all its work, as a failure does. */
export const PROJECT_LOOK: Readonly<Record<ProjectAsks, MarkState>> = {
  trust: "asking",
  missing: "failed",
}

/**
 * This machine's Projects that wait for the Person, in their order: one
 * whose folder is missing, or else one not trusted whose trust the Person
 * did not put off (`putOff`, ADR 0083, decision 5). A Thread's own No
 * Project asks nothing.
 */
export function projectCallsOf(
  projects: readonly ProjectSummary[],
  putOff: ReadonlySet<string> = new Set()
): ProjectCall[] {
  return projects.flatMap((project): ProjectCall[] => {
    if (project.scratch || project.archived) return []
    if (project.missing) return [{ project, asks: "missing" }]
    return project.trusted || putOff.has(project.id)
      ? []
      : [{ project, asks: "trust" }]
  })
}

/** What the Inbox hears of this machine's Projects: those that wait for
 * the Person, and whether none of its own is there yet, the first run. */
export type ProjectsHeard = {
  calls?: readonly ProjectCall[]
  none?: boolean
}

/** One block of the list, top down. Each has a key that stays its own. */
export type Block =
  /** A part's or a bucket's heading, with how many it holds. */
  | { kind: "head"; key: string; label: string; count?: number }
  /** A group's header (decision 7): its Project (none for the group of
   * no Project) and the other machine it is on, whether it is folded,
   * and its rollup: the loudest look of what calls in it, how many wait
   * for the Person and how many work. */
  | {
      kind: "group"
      key: string
      project?: ProjectSummary
      host?: string
      folded: boolean
      mark: MarkState
      waiting: number
      working: number
    }
  /** The hairline above Open (decision 3). */
  | { kind: "divider"; key: string }
  /** A Project that waits for the Person, first in Your turn (decision
   * 16). */
  | ({ kind: "project"; key: string } & ProjectCall)
  /** Cards of one place, in their order. */
  | { kind: "rows"; key: string; stand: Stand; rows: Entry[] }
  /** What a cut list leaves out: the shelf's "+ N more", the Archive's
   * "Show older". */
  | { kind: "more"; key: string; of: "working" | "archived"; count: number }
  /** A parent's children at work past the first three: "↳ + 4 more at
   * work", by its card's key. */
  | { kind: "more"; key: string; of: "children"; parent: string; count: number }
  /** Inbox zero, in words. */
  | ({ kind: "zero"; key: string } & Zero)
  /** A place with nothing in it, which says what goes there (decision
   * 25). */
  | { kind: "empty"; key: string; tab: EmptyAt }

/** A tab's count, and whether it is the Person's turn there. */
export type TabCount = { count: number; calls: boolean }

export type Inbox = {
  /** Each tab's count. */
  tabs: Record<Tab, TabCount>
  blocks: Block[]
  /** Set while nothing in the Inbox is the Person's. */
  zero?: Zero
  /** The `project:thing` key of each row Alt+U and the counts walk, in
   * their one order: Your turn oldest first, whatever `[inbox] order`
   * says, then Open, then Working by when it began; across groups,
   * folds and machines (decision 7). */
  keys: string[]
}

/** How many of Working the Inbox's shelf shows before "+ N more": its
 * Threads that are no child at work, each with its children. */
export const SHELF = 6

/** How many children at work a parent shows before "+ N more at work". */
export const CHILDREN = 3

/** How many archived Threads the Archive draws before "Show older": a
 * list over about 200 rows is not drawn whole (ADR 0088, decision 7). */
export const ARCHIVE_SHOWN = 200

/** The Inbox's parts, in their order (decision 3). */
const PARTS = ["turn", "open", "working"] as const
type Part = (typeof PARTS)[number]
type Parts = Partial<Record<Part, Entry[]>>

/** A Thread at work and its children at work under it, theirs too, each
 * by when it began. */
type Family = { entry: Entry; children: Entry[] }

/** Later's buckets, in their order (decision 5), by their keys. */
const LATER = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["later", "Later"],
  ["someday", "Someday"],
  ["done", "When done"],
] as const
type Bucket = (typeof LATER)[number][0]

/** Whether the Thread of `entry` wakes by its time. */
const timed = ({ row }: Entry) => row.listed.later?.until !== undefined
/** Whether the Thread of `entry` sleeps until Someday. */
const someday = ({ row }: Entry) => row.listed.later?.someday === true

/** Which of Later's buckets holds `entry`: by its time, against the local
 * midnights of tomorrow and the day after; else Someday, or When done. */
function bucketOf(entry: Entry, tomorrow: number, after: number): Bucket {
  if (!timed(entry)) return someday(entry) ? "someday" : "done"
  if (entry.at < tomorrow) return "today"
  return entry.at < after ? "tomorrow" : "later"
}

/** When `row`'s time counts from, where it stands (decision 8). */
export function atOf({
  listed,
  stand,
  woke,
}: Pick<Row, "listed" | "stand" | "woke">): number {
  switch (stand) {
    case "turn":
      // Whichever came last: one put off while at work may finish, ask or
      // fail after its time came, and that call is what it waits with.
      return Math.max(listed.changed, woke ?? -Infinity)
    case "working":
      return listed.began ?? listed.changed
    case "open":
      // One its Person woke by hand changed as it woke.
      return Math.max(listed.changed, listed.later?.woke?.at ?? -Infinity)
    case "later":
      return listed.later?.until ?? listed.later?.at ?? listed.changed
    case "archived":
      // A list that does not say when counts from the last change, the
      // nearest before it: one stays archived only while nothing changes.
      return listed.archivedAt ?? listed.changed
  }
}

const oldest = (a: Entry, b: Entry) => a.at - b.at
const newest = (a: Entry, b: Entry) => b.at - a.at

/**
 * The Inbox of `rows` as `view` has it, at `now`, the Later clock by
 * which each row stands where it does, and of what it `heard` of this
 * machine's Projects: those that wait for the Person go first in Your
 * turn, and with no Project and no Thread at all, inbox zero is the first
 * run.
 */
export function inboxOf(
  rows: readonly Row[],
  view: InboxView,
  now: number,
  heard: ProjectsHeard = {}
): Inbox {
  const by: Record<Stand, Row[]> = {
    turn: [],
    open: [],
    working: [],
    later: [],
    archived: [],
  }
  for (const row of rows) by[row.stand].push(row)
  const keyed = new Map(rows.map((row) => [itemKey(row), row]))
  const parentOf = (row: Row) => keyed.get(parentKey(row) ?? "")
  const entries = (stand: Stand, order: typeof oldest) =>
    by[stand]
      .map((row): Entry => {
        const parent = parentOf(row)
        return {
          row,
          at: atOf(row),
          ...(parent ? { child: { parent: parent.listed.title } } : {}),
        }
      })
      .sort(order)
  const calling = entries("turn", oldest)
  const open = entries("open", newest)
  const working = entries("working", oldest)
  const turn = view.order === "newest" ? [...calling].reverse() : calling
  const shown = view.open === false ? [] : open
  const asks = heard.calls ?? []
  const yours = turn.length + asks.length
  const zeroed = yours + shown.length === 0
  // Later and the Archive are put in order only where they are read: the
  // Archive has no bound (ADR 0088, decision 7), and the tabs count them
  // by how many each holds.
  const later = zeroed || view.tab === "later" ? entries("later", oldest) : []
  const archived = view.tab === "archive" ? entries("archived", newest) : []
  const zero = zeroed
    ? {
        ...zeroOf(working.length, later, view, now),
        ...(heard.none && rows.length === 0 ? { first: true as const } : {}),
      }
    : undefined
  const parts: Parts = {
    turn,
    open: shown,
    working: view.working === false ? [] : working,
  }
  const byProject = view.group === "project"
  const folded = view.folded ?? new Set<string>()
  // A child goes in its parent's group (decision 24).
  const rootOf = (row: Row) => {
    let root = row
    const seen = new Set([row])
    for (let up = parentOf(root); up && !seen.has(up); up = parentOf(up)) {
      seen.add(up)
      root = up
    }
    return root
  }
  const blocks = ((): Block[] => {
    switch (view.tab) {
      case "inbox":
        return [
          ...(zero ? [{ kind: "zero" as const, key: "zero", ...zero }] : []),
          ...(byProject
            ? grouped(parts, folded, now, rootOf, asks)
            : inbox(parts, view.more === true, folded, asks)),
        ]
      case "working":
        if (working.length === 0) return [empty("working")]
        return byProject
          ? grouped({ working }, folded, now, rootOf)
          : workingOf("working", familiesOf(working), folded)
      case "later":
        return later.length === 0 ? [empty("later")] : laterOf(later, now)
      case "archive":
        return archived.length === 0
          ? [empty("archive")]
          : archiveOf(archived, view.more === true, now)
    }
  })()
  return {
    tabs: {
      inbox: { count: yours + shown.length, calls: yours > 0 },
      working: { count: working.length, calls: false },
      later: { count: by.later.length, calls: false },
      archive: { count: by.archived.length, calls: false },
    },
    blocks,
    ...(zero ? { zero } : {}),
    // At work, each child under its parent, not by when it began.
    keys: [
      ...calling,
      ...open,
      ...familiesOf(working).flatMap(({ entry, children }) => [
        entry,
        ...children,
      ]),
    ].map(({ row }) => rowKey(row)),
  }
}

/** Inbox zero's words: how many work, the first wake by its time, and,
 * when this week has not been told yet, how many sleep until Someday. */
function zeroOf(
  working: number,
  later: readonly Entry[],
  view: InboxView,
  now: number
): Zero {
  const next = later.find(timed)?.at
  const sleeping = later.filter(someday).length
  // The week starts on Monday, at midnight.
  const monday = dayAt(now, -((new Date(now).getDay() + 6) % 7), 0, 0)
  const told = view.someday !== undefined && view.someday >= monday
  return {
    working,
    ...(next === undefined ? {} : { next }),
    ...(sleeping > 0 && !told ? { someday: sleeping } : {}),
  }
}

/** The Inbox with no groups: Your turn under its heading, the Projects
 * that `asks` first, Open under a divider, and the Working shelf, its
 * first few families unless `whole`, each parent's children past three
 * folded unless `unfolded` has it. */
function inbox(
  parts: Parts,
  whole: boolean,
  unfolded: ReadonlySet<string>,
  asks: readonly ProjectCall[]
): Block[] {
  const { turn = [], working = [] } = parts
  const families = familiesOf(working)
  const shelf = whole ? families : families.slice(0, SHELF)
  const shown = shelf.reduce((n, { children }) => n + 1 + children.length, 0)
  const yours = turn.length + asks.length
  return [
    ...(yours > 0 ? [head("turn", STAND_WORDS.turn, yours)] : []),
    ...partsOf({ turn, open: parts.open }, "", unfolded, asks),
    ...(working.length > 0
      ? [
          head("working", STAND_WORDS.working, working.length),
          ...workingOf("working", shelf, unfolded),
        ]
      : []),
    ...more("working", working.length - shown),
  ]
}

/** The key of `row`'s parent's card, when another Agent started it. */
function parentKey({ host, listed }: Row): string | undefined {
  return listed.parent === undefined ? undefined : keyOf(host, listed.parent)
}

/**
 * `working`, by when each began, in families (decision 24): each Thread
 * whose parent does not work here, its children under it, and theirs
 * under each of them, with ↳. A child whose parent works elsewhere, or
 * not at all, stands by itself.
 */
function familiesOf(working: readonly Entry[]): Family[] {
  const keys = new Set(working.map(({ row }) => itemKey(row)))
  const under = new Map<string, Entry[]>()
  const top: Entry[] = []
  for (const entry of working) {
    const parent = parentKey(entry.row)
    if (parent !== undefined && keys.has(parent))
      under.set(parent, [...(under.get(parent) ?? []), entry])
    else top.push(entry)
  }
  const seen = new Set<string>()
  const below = (key: string): Entry[] =>
    (under.get(key) ?? []).flatMap((entry) => {
      const child = itemKey(entry.row)
      if (seen.has(child)) return []
      seen.add(child)
      const parent = entry.child?.parent ?? ""
      return [{ ...entry, child: { parent, under: true } }, ...below(child)]
    })
  const families = (entries: readonly Entry[]) =>
    entries.flatMap((entry): Family[] => {
      const key = itemKey(entry.row)
      if (seen.has(key)) return []
      seen.add(key)
      return [{ entry, children: below(key) }]
    })
  const placed = families(top)
  // Threads that name each other parents in a ring have no top: the first
  // to begin heads them.
  return [...placed, ...families(working)]
}

/** Working's cards in `families`, its blocks keyed after `key`: each
 * parent's first three children under it, then "+ N more at work" unless
 * `unfolded` has the parent. */
function workingOf(
  key: string,
  families: readonly Family[],
  unfolded: ReadonlySet<string>
): Block[] {
  const blocks: Block[] = []
  let part = key
  let rows: Entry[] = []
  for (const { entry, children } of families) {
    const parent = itemKey(entry.row)
    const cut =
      children.length > CHILDREN && !unfolded.has(parent)
        ? children.length - CHILDREN
        : 0
    rows.push(entry, ...children.slice(0, children.length - cut))
    if (cut === 0) continue
    blocks.push(cards(part, "working", rows), {
      kind: "more",
      key: `${parent}:children`,
      of: "children",
      parent,
      count: cut,
    })
    part = `${key}:${parent}`
    rows = []
  }
  return rows.length > 0 ? [...blocks, cards(part, "working", rows)] : blocks
}

/** Where a group is: its Project and the other machine it is on. */
type Place = Pick<Row, "project" | "host">

/** Each Project's group with something to show: its header, then,
 * unless it is folded, the Projects of it that `asks`, and its rows by
 * place, Open under a divider. Projects go by name, with no Project's
 * last. A child goes in its parent's group, the group of the first of its
 * parents that `rootOf` finds. A header's mark is the loudest look of
 * what calls in it, as its cards draw them at `now`. */
function grouped(
  parts: Parts,
  folded: ReadonlySet<string>,
  now: number,
  rootOf: (row: Row) => Row,
  asks: readonly ProjectCall[] = []
): Block[] {
  type Group = { first: Place; parts: Parts; asks: ProjectCall[] }
  const groups = new Map<string, Group>()
  const groupOf = (place: Place) => {
    const key = groupKey(place)
    const group = groups.get(key) ?? { first: place, parts: {}, asks: [] }
    groups.set(key, group)
    return group
  }
  for (const call of asks) groupOf({ project: call.project }).asks.push(call)
  for (const part of PARTS)
    for (const entry of parts[part] ?? []) {
      const group = groupOf(rootOf(entry.row))
      ;(group.parts[part] ??= []).push(entry)
    }
  return [...groups]
    .sort(([, a], [, b]) => groupOrder(a.first, b.first))
    .flatMap(([key, group]): Block[] => {
      const { turn = [], working = [] } = group.parts
      const shut = folded.has(key)
      const looks = [
        ...group.asks.map(({ asks }) => PROJECT_LOOK[asks]),
        ...turn.map(({ row }) => lookOf(row.listed, now).look),
      ]
      return [
        {
          kind: "group",
          key,
          ...placeOf(group.first),
          folded: shut,
          mark: loudest(looks),
          waiting: looks.length,
          working: working.length,
        },
        ...(shut ? [] : partsOf(group.parts, `${key}:`, folded, group.asks)),
      ]
    })
}

/** A group's key: its Project's, another machine's after its name, and
 * one for every Thread with no Project. */
function groupKey({ project, host }: Place): string {
  if (project.scratch) return "project:none"
  return `project:${host === undefined ? "" : `${host}/`}${project.id}`
}

/** What a group's header names: its Project, and the other machine it
 * is on. The group of no Project names neither. */
function placeOf({ project, host }: Place): {
  project?: ProjectSummary
  host?: string
} {
  if (project.scratch) return {}
  return { project, ...(host === undefined ? {} : { host }) }
}

/** The groups' order, by the first row of each: by name, Projects with
 * no Project's last; this machine's first, then the others by name. */
function groupOrder(a: Place, b: Place): number {
  return (
    Number(a.project.scratch) - Number(b.project.scratch) ||
    a.project.name.localeCompare(b.project.name) ||
    Number(a.host !== undefined) - Number(b.host !== undefined) ||
    (a.host ?? "").localeCompare(b.host ?? "")
  )
}

/** The rows of each place in `parts`, the Projects that `asks` first in
 * Your turn, Open under a divider when Your turn is above it, each block
 * keyed after `prefix`; at work, each child under its parent, past three
 * unless `unfolded` has it. */
function partsOf(
  parts: Parts,
  prefix: string,
  unfolded: ReadonlySet<string>,
  asks: readonly ProjectCall[] = []
): Block[] {
  const { turn = [], open = [], working = [] } = parts
  const yours = turn.length + asks.length > 0
  return [
    ...asks.map((call): Block => ({
      kind: "project",
      key: `project-card:${call.project.id}`,
      ...call,
    })),
    ...(turn.length > 0 ? [cards(`${prefix}turn`, "turn", turn)] : []),
    ...(yours && open.length > 0
      ? [{ kind: "divider" as const, key: `${prefix}divider` }]
      : []),
    ...(open.length > 0 ? [cards(`${prefix}open`, "open", open)] : []),
    ...workingOf(`${prefix}working`, familiesOf(working), unfolded),
  ]
}

/** Later by when each wakes, under Today, Tomorrow, Later, Someday and
 * When done, by the local day. */
function laterOf(later: readonly Entry[], now: number): Block[] {
  const [tomorrow, after] = [dayAt(now, 1, 0, 0), dayAt(now, 2, 0, 0)]
  const buckets: Partial<Record<Bucket, Entry[]>> = {}
  for (const entry of later)
    (buckets[bucketOf(entry, tomorrow, after)] ??= []).push(entry)
  return LATER.flatMap(([key, label]): Block[] => {
    const held = buckets[key]
    return held
      ? [head(`later:${key}`, label), cards(`later:${key}`, "later", held)]
      : []
  })
}

/** The Archive, the last archived first, under Today and Earlier; its
 * first few unless `whole`. */
function archiveOf(
  archived: readonly Entry[],
  whole: boolean,
  now: number
): Block[] {
  const shown = whole ? archived : archived.slice(0, ARCHIVE_SHOWN)
  const today = dayAt(now, 0, 0, 0)
  const parts: Array<[string, string, Entry[]]> = [
    ["today", "Today", shown.filter((entry) => entry.at >= today)],
    ["earlier", "Earlier", shown.filter((entry) => entry.at < today)],
  ]
  return [
    ...parts.flatMap(([key, label, held]): Block[] =>
      held.length === 0
        ? []
        : [
            head(`archive:${key}`, label),
            cards(`archive:${key}`, "archived", held),
          ]
    ),
    ...more("archived", archived.length - shown.length),
  ]
}

function head(key: string, label: string, count?: number): Block {
  return {
    kind: "head",
    key: `${key}:head`,
    label,
    ...(count === undefined ? {} : { count }),
  }
}

/** What a cut list of `of` leaves out, when it leaves out any. */
function more(of: "working" | "archived", count: number): Block[] {
  return count > 0 ? [{ kind: "more", key: `${of}:more`, of, count }] : []
}

function cards(key: string, stand: Stand, rows: Entry[]): Block {
  return { kind: "rows", key, stand, rows }
}

function empty(tab: EmptyAt): Block {
  return { kind: "empty", key: `${tab}:empty`, tab }
}
