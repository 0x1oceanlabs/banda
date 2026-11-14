import type { ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR, type GroupBy } from "@banda/contract/sidebar"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { type Drawn, type SidebarInput, sidebarOf } from "./drawn"
import { gapAbove, type Item, REGION_GAP, ROW_GAP } from "./flat"
import type { Elsewhere } from "./rows"
import type { Settings } from "./settings"

const project = (
  id: string,
  name: string,
  folder = `/${id}`
): ProjectSummary => ({
  id,
  name,
  folder,
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "W", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
})
const landing = project("s1", "Landing", "/l")
const api = project("s2", "API", "/a")
const quiet = project("s3", "Quiet", "/q")
const projects = [landing, api, quiet]

const listed = (
  id: string,
  mark: MarkState,
  changed: number,
  more: Partial<Listed> = {}
): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

const lists = {
  s1: [
    listed("form", "asking", 2),
    listed("headers", "working", 5),
    listed("logo", "rest", 1),
  ],
  s2: [
    listed("migration", "failed", 3),
    listed("release", "working", 4),
    listed("letters", "done", 6),
  ],
}

/** The Later clock the tests read by. */
const NOW = 100

/** What the sidebar draws of `held`, with `settings`, in `view`. */
const draw = (
  held: Lists,
  all: readonly ProjectSummary[],
  settings: Settings = DEFAULT_SIDEBAR,
  {
    now = NOW,
    elsewhere = [],
    view = { tab: "inbox" },
  }: {
    now?: number
    elsewhere?: readonly Elsewhere[]
    view?: SidebarInput["view"]
  } = {}
): Drawn =>
  sidebarOf({
    lists: held,
    now,
    projects: all,
    elsewhere,
    settings,
    putOff: new Set(),
    view,
  })

/** `lists` with the Threads of `ids` archived, as their host lists them. */
const archive = (lists: Lists, ids: readonly string[]): Lists =>
  Object.fromEntries(
    Object.entries(lists).map(([key, held]) => [
      key,
      held.map((one) =>
        ids.includes(one.id) ? { ...one, archived: true } : one
      ),
    ])
  )

/** Each row's Thread and where it stands. */
const ids = ({ rows }: Drawn) => rows.map((row) => [row.listed.id, row.stand])

/** What `banda look` gives for `group`, the Person's other `keys` with it
 * (platform/look/src/sidebar.rs, whose tests lay the layers). */
const resolve = (group: GroupBy, keys: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SIDEBAR,
  group,
  ...keys,
})

const of = (
  group: GroupBy,
  keys?: Partial<Settings>,
  archived: readonly string[] = []
) => draw(archive(lists, archived), projects, resolve(group, keys))

/** Each part's cards, a line each: the place and the Threads. */
function shown({ items }: Drawn): string[] {
  const lines: string[] = []
  items.forEach((item, i) => {
    if (item.kind !== "card") return
    const above = items[i - 1]
    const id = item.entry.row.listed.id
    if (above?.kind === "card" && above.block === item.block)
      lines.push(`${lines.pop()} ${id}`)
    else lines.push(`${item.stand}: ${id}`)
  })
  return lines
}

test("every Project's rows, each where it stands, the archived among them", () => {
  expect(ids(of("none", {}, ["logo"]))).toEqual([
    ["form", "turn"],
    ["headers", "working"],
    ["logo", "archived"],
    ["migration", "turn"],
    ["release", "working"],
    ["letters", "turn"],
  ])
  // A Thread at work is never archived.
  expect(ids(of("none", {}, ["headers"]))).toContainEqual([
    "headers",
    "working",
  ])
})

test("the list is grouped as `group` says (ADR 0098, decision 7)", () => {
  const groupedBy = ({ items }: Drawn) =>
    items.some((item) => item.kind === "piece" && item.piece.kind === "group")
      ? "project"
      : "none"
  expect(groupedBy(of("none"))).toBe("none")
  expect(groupedBy(of("project"))).toBe("project")
})

test("the Inbox shows what `[inbox]` says, in its order, and the counts and Alt+U keep theirs (ADR 0098, decision 3)", () => {
  const inbox = of("none", {}, ["logo"])
  expect(shown(inbox)).toEqual([
    "turn: form migration letters",
    "working: release headers",
  ])
  const newest = of(
    "none",
    { inbox: { order: "newest", open: true, working: false } },
    ["logo"]
  )
  expect(shown(newest)).toEqual(["turn: letters migration form"])
  expect(newest.keys).toEqual(inbox.keys)
  expect(newest.counts).toEqual(inbox.counts)
})

test("scratch Threads are rows as others are", () => {
  const scratch = { ...project("scratch", "", "/scratch"), scratch: true }
  const allProjects = [...projects, scratch]
  const allLists = { ...lists, scratch: [listed("loose", "rest", 7)] }
  const result = draw(allLists, allProjects, resolve("project"))
  expect(ids(result)).toContainEqual(["loose", "open"])
})

test("a Thread that woke stands with what calls, as of when it woke", () => {
  const wokeAt10 = {
    ...lists,
    s1: lists.s1.map((one) =>
      one.id === "logo" ? { ...one, later: { at: 0, until: 10 } } : one
    ),
  }
  const woke = draw(wokeAt10, projects).rows.find(
    (row) => row.listed.id === "logo"
  )
  expect([woke?.stand, woke?.woke]).toEqual(["turn", 10])
})

/** Another host, "arc", with a Project of its own and a scratch one. */
const banda = project("r1", "banda", "/home/roma/banda")
const arcScratch = { ...project("r2", "No Project", "/s"), scratch: true }
const arc = { name: "arc", projects: [banda, arcScratch] }
const withArc = {
  ...lists,
  r1: [listed("bench", "done", 7), listed("hosts", "working", 8)],
  r2: [listed("idea", "asking", 9)],
}
const elsewhere = (group: GroupBy) =>
  draw(withArc, projects, resolve(group), { elsewhere: [arc] })

test("with no other host, either way to group arranges as it did, and no row names one", () => {
  for (const group of ["none", "project"] as const) {
    const none = draw(lists, projects, resolve(group))
    expect(draw(lists, projects, resolve(group), { elsewhere: [] })).toEqual(
      none
    )
    expect(JSON.stringify(none)).not.toContain('"host"')
  }
})

test("another host's rows join this machine's, each with its name", () => {
  const inbox = elsewhere("none")
  const hostOf = (id: string) =>
    inbox.rows.find((row) => row.listed.id === id)?.host
  expect([hostOf("bench"), hostOf("idea"), hostOf("form")]).toEqual([
    "arc",
    "arc",
    undefined,
  ])
  expect(inbox.rows.at(-1)?.listed.id).toBe("idea")
})

/** Tuesday, 10 November 2026, 15:00 by the local clock. */
const TUESDAY = new Date(2026, 10, 10, 15, 0).getTime()
const one = project("p1", "banda")
const loose = { ...project("p2", "Scratch"), scratch: true }
// arc's Project of the same name.
const far = project("p9", "banda")

/** A Thread of `stand` at `TUESDAY`, in its place by its mark, its
 * Later or its archive. */
const at = (id: string, stand: string, more: Partial<Listed> = {}) =>
  listed(
    id,
    stand === "turn" ? "asking" : stand === "working" ? "working" : "rest",
    TUESDAY - 60_000,
    {
      ...(stand === "archived" ? { archived: true } : {}),
      ...more,
    }
  )
const soon = at("soon", "later", { later: { at: 0, until: TUESDAY + 60_000 } })
const someday = at("one day", "later", { later: { at: 0, someday: true } })
const RUNS = Array.from({ length: 8 }, (_, i) => at(`run${i}`, "working"))

/** What the sidebar draws of banda's `held`, and of arc's `far`, as
 * `view` and `group` have it, at `TUESDAY`. */
const tuesday = (
  held: Lists,
  view: SidebarInput["view"],
  group: GroupBy = "none"
) =>
  draw(held, [one, loose], resolve(group), {
    now: TUESDAY,
    elsewhere: [{ name: "arc", projects: [far] }],
    view,
  })

/** Each region, in order: its name, its machine, and what is in it, each
 * piece by its kind and key and each part's cards by its key. */
function regions({ items }: Drawn) {
  const all: [string | undefined, string | undefined, string[]][] = []
  items.forEach((item, i) => {
    const what =
      item.kind === "card"
        ? `rows ${item.block}`
        : `${item.piece.kind} ${item.key}`
    if (items[i - 1]?.region !== item.region)
      all.push([item.place, item.host, []])
    const held = all.at(-1)![2]
    if (held.at(-1) !== what) held.push(what)
  })
  return all
}
const regionKeys = ({ items }: Drawn) => [
  ...new Set(items.map((item) => item.region)),
]

test("the Inbox: Your turn and Open as the Person's Threads, the divider between, then the Working shelf with what it leaves out", () => {
  const held = { p1: [at("ask", "turn"), at("read", "open"), ...RUNS] }
  expect(regions(tuesday(held, { tab: "inbox" }))).toEqual([
    [
      "Threads",
      undefined,
      ["head turn:head", "rows turn", "divider divider", "rows open"],
    ],
    [
      "Working",
      undefined,
      ["head working:head", "rows working", "more working:more"],
    ],
  ])
})

test("a place's region keeps its key as the blocks in it come and go: the Person's Threads as Your turn empties, Later as its first day does", () => {
  const read = at("read", "open")
  expect(
    regionKeys(tuesday({ p1: [at("ask", "turn"), read] }, { tab: "inbox" }))
  ).toEqual(regionKeys(tuesday({ p1: [read] }, { tab: "inbox" })))
  expect(
    regionKeys(tuesday({ p1: [soon, someday] }, { tab: "later" }))
  ).toEqual(regionKeys(tuesday({ p1: [someday] }, { tab: "later" })))
})

test("inbox zero and an empty tab stand alone, with no label, as their words name them", () => {
  const zero = tuesday({ p1: [at("run", "working")] }, { tab: "inbox" })
  expect(regions(zero)).toEqual([
    [undefined, undefined, ["zero zero"]],
    ["Working", undefined, ["head working:head", "rows working"]],
  ])
  expect(regions(tuesday({}, { tab: "later" }))).toEqual([
    [undefined, undefined, ["empty later:empty"]],
  ])
})

test("Later and the Archive: each day's head over its cards, in one region", () => {
  expect(regions(tuesday({ p1: [soon, someday] }, { tab: "later" }))).toEqual([
    [
      "Later",
      undefined,
      [
        "head later:today:head",
        "rows later:today",
        "head later:someday:head",
        "rows later:someday",
      ],
    ],
  ])
  const archived = { p1: [at("old", "archived"), at("older", "archived")] }
  expect(regions(tuesday(archived, { tab: "archive" }))).toEqual([
    ["Archive", undefined, ["head archive:today:head", "rows archive:today"]],
  ])
})

test("grouped by Project, each group is a region under its header, named by its Project, on its machine; No Project's last", () => {
  const held = {
    p1: [at("ask", "turn"), at("read", "open")],
    p2: [at("loose", "open")],
    p9: [at("far", "turn")],
  }
  const drawn = tuesday(held, { tab: "inbox" }, "project")
  expect(regions(drawn)).toEqual([
    [
      "banda",
      undefined,
      [
        "group project:p1",
        "rows project:p1:turn",
        "divider project:p1:divider",
        "rows project:p1:open",
      ],
    ],
    ["banda", "arc", ["group project:arc/p9", "rows project:arc/p9:turn"]],
    ["No Project", undefined, ["group project:none", "rows project:none:open"]],
  ])
  expect(regionKeys(drawn)).toEqual([
    "project:p1",
    "project:arc/p9",
    "project:none",
  ])
  // A folded group keeps its header and draws none of its cards.
  const folded = tuesday(
    held,
    { tab: "inbox", folded: new Set(["project:p1"]) },
    "project"
  )
  expect(regions(folded)[0]).toEqual(["banda", undefined, ["group project:p1"]])
  expect(folded.items[0]).toMatchObject({ piece: { folded: true } })
})

test("the list is flat: each head, then its part's cards, by their keys; a part's cards stand 1 px apart and regions 4 px", () => {
  const held = {
    p1: [at("a", "turn"), at("b", "turn"), at("c", "working")],
  }
  const list = tuesday(held, { tab: "inbox" }).items
  expect(list.map((item) => item.key)).toEqual([
    "turn:head",
    ":a",
    ":b",
    "working:head",
    ":c",
  ])
  expect(list.map((item, i) => gapAbove(list[i - 1], item))).toEqual([
    0,
    0,
    ROW_GAP,
    REGION_GAP,
    0,
  ])
})

test("a card says the part it is drawn in, and its region's name", () => {
  const [, card] = tuesday({ p1: [at("a", "turn")] }, { tab: "inbox" }).items
  expect(card).toMatchObject({
    kind: "card",
    block: "turn",
    stand: "turn",
    place: "Threads",
  } satisfies Partial<Item>)
})

/** Two Projects with a Thread of every mark, for the bar's counts. */
const counted = {
  a: [
    listed("run", "working", 5),
    listed("ask", "asking", 3),
    listed("old", "done", 1),
  ],
  b: [
    listed("new", "done", 4),
    listed("broke", "failed", 6),
    listed("quiet", "rest", 0),
  ],
}
const bar = (held: Lists, now = 0) =>
  draw(
    held,
    ["a", "b", "c"].map((id) => project(id, id)),
    DEFAULT_SIDEBAR,
    {
      now,
    }
  )

test("each count takes its marks, and the loudest shows (ADR 0035)", () => {
  const { counts } = bar(counted)
  expect(counts).toEqual({
    asking: { count: 2, mark: "failed" },
    done: { count: 2, mark: "done" },
    waiting: { count: 4, mark: "failed" },
    working: { count: 1, mark: "working" },
  })
  const working = bar({ a: [listed("run", "working", 0)] }).counts
  expect([working.asking.count, working.done.count]).toEqual([0, 0])
})

test("a Thread that woke counts only in waiting, and rings there as the bar's Mark does (ADR 0099, decision 9)", () => {
  const woke = {
    a: [{ ...listed("up", "rest", 0), later: { at: 0, until: 5 } }],
  }
  const { counts } = bar(woke, 10)
  expect([
    counts.asking.count,
    counts.done.count,
    counts.working.count,
  ]).toEqual([0, 0, 0])
  expect(counts.waiting).toEqual({ count: 1, mark: "woke" })
})

test("the calm square is for when nothing waits and nothing works, not for when no count takes it", () => {
  const withOne = (more: Partial<Listed>, mark: MarkState = "rest") => ({
    c: [{ ...listed("t", mark, 0), ...more }],
  })
  const calm = (held: Lists) => bar(held, 10).calm
  expect(calm({})).toBe(true)
  expect(calm(withOne({}))).toBe(true)
  expect(calm(withOne({ later: { at: 0, until: 5 } }))).toBe(false)
  expect(calm(withOne({}, "working"))).toBe(false)
  expect(calm(withOne({}, "done"))).toBe(false)
  expect(calm(withOne({ later: { at: 0, until: 50 } }, "done"))).toBe(true)
})

test("waiting takes what asks and what is done, and archived Threads are not counted", () => {
  expect(bar(counted).counts.waiting.count).toBe(4)
  expect(bar(archive(counted, ["old"])).counts.waiting.count).toBe(3)
})
