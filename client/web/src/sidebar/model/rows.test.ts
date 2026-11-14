import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { DEFAULT_SIDEBAR, type GroupBy } from "@banda/contract/sidebar"
import { type Ordered, order } from "./order"
import type { Elsewhere } from "./rows"
import type { Settings } from "./settings"

const project = (id: string, name: string, folder: string): ProjectSummary => ({
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

const listed = (id: string, mark: MarkState, changed: number): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "agents.thread", args: { thread: id } },
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
const ids = (ordered: Ordered) =>
  ordered.rows.map((row) => [row.listed.id, row.stand])

/** What the list is grouped by: by Project with a group's header, else
 * none. */
const groupedBy = ({ blocks }: Ordered) =>
  blocks.some((block) => block.kind === "group") ? "project" : "none"

/** The sidebar's order of `held` with `settings`, as the list draws it. */
const arrange = (
  held: Lists,
  all: readonly ProjectSummary[],
  settings: Settings,
  now: number,
  elsewhere: readonly Elsewhere[] = []
) => order(held, all, now, { settings, elsewhere })

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
) => arrange(archive(lists, archived), projects, resolve(group, keys), NOW)

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
  expect(groupedBy(of("none"))).toBe("none")
  expect(groupedBy(of("project"))).toBe("project")
})

test("the Inbox shows what `[inbox]` says, in its order, and the counts and Alt+U keep theirs (ADR 0098, decision 3)", () => {
  const shown = (ordered: Ordered) =>
    ordered.blocks.flatMap((block) =>
      block.kind === "rows"
        ? [
            `${block.stand}: ${block.rows.map(({ row }) => row.listed.id).join(" ")}`,
          ]
        : []
    )
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
})

test("scratch Threads are rows as others are", () => {
  const scratch = { ...project("scratch", "", "/scratch"), scratch: true }
  const allProjects = [...projects, scratch]
  const allLists = { ...lists, scratch: [listed("loose", "rest", 7)] }
  const result = arrange(allLists, allProjects, resolve("project"), NOW)
  expect(ids(result)).toContainEqual(["loose", "open"])
})

test("a Thread that woke stands with what calls, as of when it woke", () => {
  const wokeAt10 = {
    ...lists,
    s1: lists.s1.map((one) =>
      one.id === "logo" ? { ...one, later: { at: 0, until: 10 } } : one
    ),
  }
  const woke = arrange(wokeAt10, projects, resolve("none"), NOW).rows.find(
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
  arrange(withArc, projects, resolve(group), NOW, [arc])

test("with no other host, either way to group arranges as it did, and no row names one", () => {
  for (const group of ["none", "project"] as const) {
    const none = arrange(lists, projects, resolve(group), NOW)
    expect(arrange(lists, projects, resolve(group), NOW, [])).toEqual(none)
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
