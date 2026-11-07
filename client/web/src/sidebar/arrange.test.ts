import type { ProjectSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { arrange, type Arranged } from "./arrange"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { type Settings, STATES } from "./settings"

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

const ids = (arranged: Arranged, where: "sections" | "shelves" = "sections") =>
  arranged[where].map((s) => [s.key, s.rows.map((r) => r.listed.id)])

/** Keys over others, as `banda look` lays them (platform/look/src/sidebar.rs). */
type Keys = { [Group in keyof Settings]?: Partial<Settings[Group]> }
const over = (base: Settings, keys: Keys = {}): Settings => ({
  group: { ...base.group, ...keys.group },
  sort: { ...base.sort, ...keys.sort },
  projects: { ...base.projects, ...keys.projects },
  row: { ...base.row, ...keys.row },
})

/** Banda's presets, as platform/look/sidebars/*.toml set them. */
const PRESETS = {
  inbox: {},
  projects: {
    group: { by: "project", states: [...STATES], bottom: [] },
    row: { lines: 1 },
  },
  places: {
    group: { states: [...STATES], bottom: [] },
    projects: { list: true },
    row: { lines: 2 },
  },
} satisfies Record<string, Keys>
type Preset = keyof typeof PRESETS
const resolve = (preset: Preset, keys?: Keys) =>
  over(over(DEFAULT_SIDEBAR, PRESETS[preset]), keys)

const of = (
  preset: Preset,
  keys?: Keys,
  only?: string,
  toggled?: Set<string>,
  archived: readonly string[] = []
) =>
  arrange(lists, projects, resolve(preset, keys), only, toggled, {
    archived: (listed) => archived.includes(listed.id),
  })

test("inbox: one list, what waits first; the working and the archived on shelves", () => {
  const inbox = of("inbox")
  expect(ids(inbox)).toEqual([
    ["active", ["letters", "migration", "form", "logo"]],
  ])
  expect(inbox.sections[0]?.label).toBe("")
  expect(ids(inbox, "shelves")).toEqual([["working", ["headers", "release"]]])
  expect(inbox.projects).toBeUndefined()

  const archived = of("inbox", {}, undefined, undefined, ["logo", "letters"])
  expect(ids(archived)).toEqual([["active", ["migration", "form"]]])
  expect(ids(archived, "shelves")).toEqual([
    ["working", ["headers", "release"]],
    ["archived", ["letters", "logo"]],
  ])
  expect(archived.shelves.map((s) => [s.label, s.folded])).toEqual([
    ["Working", false],
    ["Archive", true],
  ])
})

test("a Thread at work is never archived", () => {
  const working = of("inbox", {}, undefined, undefined, ["headers"])
  expect(ids(working, "shelves")).toEqual([["working", ["headers", "release"]]])
})

test("projects: each Project a section, what waits first, with its roll-up", () => {
  const byProject = of("projects")
  expect(ids(byProject)).toEqual([
    ["s2", ["letters", "migration", "release"]],
    ["s1", ["form", "headers", "logo"]],
  ])
  expect(byProject.sections[0]).toMatchObject({
    label: "API",
    mark: "failed",
    waiting: 2,
  })
  expect(byProject.shelves).toEqual([])
  // A archived Thread goes last, and waits for no one.
  const archived = of("projects", {}, undefined, undefined, ["letters"])
  expect(ids(archived)[0]).toEqual(["s2", ["migration", "release", "letters"]])
  expect(archived.sections[0]?.waiting).toBe(1)
})

test("places: the Projects listed above, and a click on one shows its rows", () => {
  const places = of("places", {}, undefined, undefined, ["logo"])
  expect(
    places.projects?.map((s) => [s.project.name, s.mark, s.waiting, s.count])
  ).toEqual([
    ["API", "failed", 2, 3],
    ["Landing", "asking", 1, 3],
    ["Quiet", "rest", 0, 0],
  ])
  expect(places.sections.find((s) => s.key === "archived")?.folded).toBe(true)
  expect(ids(of("places", {}, "s1"))).toEqual([
    ["active", ["form", "logo"]],
    ["working", ["headers"]],
  ])
})

test("a state the settings name nowhere goes to the last section", () => {
  const keys: Keys = { group: { states: ["active"], bottom: [] } }
  expect(ids(of("inbox", keys))).toEqual([
    ["active", ["letters", "migration", "form", "headers", "release", "logo"]],
  ])
})

test("the Person's keys win over the preset", () => {
  const flat = of("projects", { group: { by: "none" }, sort: { by: "title" } })
  expect(ids(flat)).toEqual([
    ["all", ["form", "headers", "letters", "logo", "migration", "release"]],
  ])
})

test("empty sections hide unless the settings show them", () => {
  const none = arrange({}, projects, resolve("inbox"))
  expect(none.sections).toEqual([])
  expect(none.shelves).toEqual([])
  const shown = arrange(
    {},
    projects,
    resolve("inbox", { group: { empty: "show" } })
  )
  expect(shown.sections.map((s) => s.key)).toEqual(["active"])
  expect(shown.shelves.map((s) => s.key)).toEqual([
    "working",
    "snoozed",
    "archived",
  ])
})

test("folded comes from the settings, and the Person's toggle turns it over", () => {
  const keys: Keys = { group: { folded: ["API", "working"] } }
  const byProject = of("projects", keys)
  expect(byProject.sections.find((s) => s.key === "s2")?.folded).toBe(true)
  const opened = of("projects", keys, undefined, new Set(["s2", "s1"]))
  expect(opened.sections.map((s) => [s.key, s.folded])).toEqual([
    ["s2", false],
    ["s1", true],
  ])
  expect(
    of("inbox", keys).shelves.find((s) => s.key === "working")?.folded
  ).toBe(true)
})

test("scratch Threads follow grouping, sorting, shelves and filtering like other Threads", () => {
  const scratch = { ...project("scratch", "", "/scratch"), scratch: true }
  const allProjects = [...projects, scratch]
  const allLists = {
    ...lists,
    scratch: [
      listed("loose", "rest", 7),
      listed("busy", "running", 8),
      listed("old", "rest", 0),
    ],
  }
  for (const by of ["project", "state", "none"] as const) {
    const settings = over(resolve("inbox"), {
      group: { by, bottom: ["archived"] },
      projects: { list: true },
    })
    const result = arrange(
      allLists,
      allProjects,
      settings,
      undefined,
      new Set(),
      { archived: (row) => row.id === "old" }
    )
    expect(result.projects?.some((line) => line.project.scratch)).toBe(false)
    if (by === "project") {
      expect(result.sections.at(-1)?.label).toBe("No Project")
      expect(result.sections.at(-1)?.rows.map((row) => row.listed.id)).toEqual([
        "busy",
        "loose",
        "old",
      ])
    } else {
      expect(result.sections.some((s) => s.key === "no-project")).toBe(false)
      const mixed = result.sections.flatMap((s) => s.rows)
      expect(mixed.some((row) => row.project.scratch)).toBe(true)
      if (by === "state")
        expect(
          result.shelves
            .find((s) => s.key === "archived")
            ?.rows.map((r) => r.listed.id)
        ).toContain("old")
      if (by === "none")
        expect(
          result.sections[0].rows.findIndex((r) => r.listed.id === "busy")
        ).toBeLessThan(
          result.sections[0].rows.findIndex((r) => r.listed.id === "loose")
        )
    }
    const filtered = arrange(allLists, allProjects, settings, landing.id)
    expect(
      [...filtered.sections, ...filtered.shelves]
        .flatMap((s) => s.rows)
        .every((r) => r.project.id === landing.id)
    ).toBe(true)
  }
})

test("a snoozed Thread waits on its shelf above Archive, by when it wakes", () => {
  const sleeping = (listed: Listed) =>
    ["logo", "headers", "letters"].includes(listed.id)
  const wakes: Record<string, number | undefined> = {
    logo: 900,
    headers: undefined,
    letters: 300,
  }
  const asleep = {
    ...lists,
    s1: lists.s1.map((one) =>
      sleeping(one)
        ? {
            ...one,
            snooze: {
              at: 0,
              ...(wakes[one.id] ? { until: wakes[one.id] } : {}),
            },
          }
        : one
    ),
    s2: lists.s2.map((one) =>
      sleeping(one) ? { ...one, snooze: { at: 0, until: wakes[one.id] } } : one
    ),
  }
  const shown = arrange(
    asleep,
    projects,
    resolve("inbox"),
    undefined,
    new Set(),
    {
      asleep: sleeping,
      // Archived too, it is snoozed: a snooze outranks the archive.
      archived: (listed) => listed.id === "logo",
    }
  )
  expect(ids(shown)).toEqual([["active", ["migration", "form"]]])
  expect(ids(shown, "shelves")).toEqual([
    ["working", ["release"]],
    ["snoozed", ["letters", "logo", "headers"]],
  ])
  const shelf = shown.shelves[1]
  expect([shelf.label, shelf.folded, shelf.next, shelf.waiting]).toEqual([
    "Snoozed",
    true,
    300,
    0,
  ])
})

test("a Thread that woke stands with what calls, as of when it woke", () => {
  const woke = arrange(
    lists,
    projects,
    resolve("inbox"),
    undefined,
    new Set(),
    {
      woke: (listed) => (listed.id === "logo" ? 10 : undefined),
    }
  )
  expect(ids(woke)).toEqual([
    ["active", ["logo", "letters", "migration", "form"]],
  ])
  expect(woke.sections[0].rows[0].woke).toBe(10)
})
