import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
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
    listed("headers", "running", 5),
    listed("logo", "rest", 1),
  ],
  s2: [
    listed("migration", "failed", 3),
    listed("release", "running", 4),
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

/** What the list is grouped by, as its first header says: none with no
 * header. */
const groupedBy = ({ blocks }: Ordered) =>
  blocks.find((block) => block.kind === "group")?.by ?? "none"

/** The sidebar's order of `held` with `settings`, as the list draws it. */
const arrange = (
  held: Lists,
  all: readonly ProjectSummary[],
  settings: Settings,
  now: number,
  only?: string,
  elsewhere: readonly Elsewhere[] = []
) =>
  order(held, all, now, {
    settings,
    elsewhere,
    ...(only === undefined ? {} : { only }),
  })

/** Banda's presets, as platform/look/sidebars/*.toml group the list. */
const PRESETS = {
  inbox: "none",
  projects: "project",
  places: "project",
} satisfies Record<string, Settings["group"]>
type Preset = keyof typeof PRESETS

/** What `banda look` gives for `preset`, the Person's `keys` over it
 * (platform/look/src/sidebar.rs, whose tests lay the layers). */
const resolve = (preset: Preset, keys: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SIDEBAR,
  preset,
  group: PRESETS[preset],
  ...keys,
})

const of = (
  preset: Preset,
  keys?: Partial<Settings>,
  only?: string,
  archived: readonly string[] = []
) =>
  arrange(archive(lists, archived), projects, resolve(preset, keys), NOW, only)

test("every Project's rows, each where it stands, the archived among them", () => {
  expect(ids(of("inbox", {}, undefined, ["logo"]))).toEqual([
    ["form", "turn"],
    ["headers", "working"],
    ["logo", "archived"],
    ["migration", "turn"],
    ["release", "working"],
    ["letters", "turn"],
  ])
  // A Thread at work is never archived.
  expect(ids(of("inbox", {}, undefined, ["headers"]))).toContainEqual([
    "headers",
    "working",
  ])
})

test("the list is grouped as `group` says, the preset's or the Person's, and one list under the list of Projects (ADR 0098, decision 7)", () => {
  expect(groupedBy(of("inbox"))).toBe("none")
  expect(groupedBy(of("places"))).toBe("none")
  expect(groupedBy(of("projects"))).toBe("project")
  // The Person's key wins over the preset's.
  expect(groupedBy(of("projects", { group: "none" }))).toBe("none")
  expect(groupedBy(of("inbox", { group: "project" }))).toBe("project")
  expect(groupedBy(of("projects", { group: "machine" }))).toBe("machine")
  // Under the list of Projects, the Threads stay one list.
  expect(groupedBy(of("places", { group: "machine" }))).toBe("none")
  expect(of("inbox").projects).toBeUndefined()
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
  const inbox = of("inbox", {}, undefined, ["logo"])
  expect(shown(inbox)).toEqual([
    "turn: form migration letters",
    "working: release headers",
  ])
  const newest = of(
    "inbox",
    { inbox: { order: "newest", open: true, working: false } },
    undefined,
    ["logo"]
  )
  expect(shown(newest)).toEqual(["turn: letters migration form"])
  expect(newest.keys).toEqual(inbox.keys)
})

test("places: the Projects listed above, and a click on one shows its rows alone", () => {
  const places = of("places", {}, undefined, ["logo"])
  expect(
    places.projects?.map((s) => [s.project.name, s.mark, s.waiting, s.count])
  ).toEqual([
    ["API", "failed", 2, 3],
    ["Landing", "asking", 1, 3],
    ["Quiet", "rest", 0, 0],
  ])
  const landingOnly = of("places", {}, "s1", ["logo"])
  expect(landingOnly.rows.map((row) => row.listed.id)).toEqual([
    "form",
    "headers",
    "logo",
  ])
  // The list of Projects still lists them all.
  expect(landingOnly.projects).toEqual(places.projects)
})

test("scratch Threads are rows as others are, and stay out of the list of Projects", () => {
  const scratch = { ...project("scratch", "", "/scratch"), scratch: true }
  const allProjects = [...projects, scratch]
  const allLists = { ...lists, scratch: [listed("loose", "rest", 7)] }
  const settings = resolve("places")
  const result = arrange(allLists, allProjects, settings, NOW)
  expect(result.projects?.some((line) => line.project.scratch)).toBe(false)
  expect(ids(result)).toContainEqual(["loose", "open"])
  const filtered = arrange(allLists, allProjects, settings, NOW, landing.id)
  expect(filtered.rows.every((r) => r.project.id === landing.id)).toBe(true)
})

test("a Thread that woke stands with what calls, as of when it woke", () => {
  const wokeAt10 = {
    ...lists,
    s1: lists.s1.map((one) =>
      one.id === "logo" ? { ...one, later: { at: 0, until: 10 } } : one
    ),
  }
  const woke = arrange(wokeAt10, projects, resolve("inbox"), NOW).rows.find(
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
  r1: [listed("bench", "done", 7), listed("hosts", "running", 8)],
  r2: [listed("idea", "asking", 9)],
}
const elsewhere = (preset: Preset) =>
  arrange(withArc, projects, resolve(preset), NOW, undefined, [arc])

test("with no other host, every preset arranges as it did, and no row names one", () => {
  for (const preset of Object.keys(PRESETS) as Preset[]) {
    const none = arrange(lists, projects, resolve(preset), NOW)
    expect(
      arrange(lists, projects, resolve(preset), NOW, undefined, [])
    ).toEqual(none)
    expect(JSON.stringify(none)).not.toContain('"host"')
  }
})

test("another host's rows join this machine's, each with its name, and its Projects follow in the list of Projects", () => {
  const inbox = elsewhere("inbox")
  const hostOf = (id: string) =>
    inbox.rows.find((row) => row.listed.id === id)?.host
  expect([hostOf("bench"), hostOf("idea"), hostOf("form")]).toEqual([
    "arc",
    "arc",
    undefined,
  ])
  expect(inbox.rows.at(-1)?.listed.id).toBe("idea")
  const places = elsewhere("places")
  expect(
    places.projects?.map((line) => [line.project.name, line.host])
  ).toEqual([
    ["API", undefined],
    ["Landing", undefined],
    ["Quiet", undefined],
    ["banda", "arc"],
  ])
})
