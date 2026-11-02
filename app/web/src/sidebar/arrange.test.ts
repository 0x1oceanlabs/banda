import type { SpaceSummary } from "@banda/contract"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { arrange, type Arranged } from "./arrange"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { type Settings, STATES } from "./settings"

const space = (id: string, name: string, folder: string): SpaceSummary => ({
  id,
  name,
  folder,
  pinned: false,
  archived: false,
  sees_others: false,
})
const landing = space("s1", "Landing", "/l")
const api = space("s2", "API", "/a")
const quiet = space("s3", "Quiet", "/q")
const spaces = [landing, api, quiet]

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

/** Keys over others, as `banda look` lays them (look/src/sidebar.rs). */
type Keys = { [Group in keyof Settings]?: Partial<Settings[Group]> }
const over = (base: Settings, keys: Keys = {}): Settings => ({
  group: { ...base.group, ...keys.group },
  sort: { ...base.sort, ...keys.sort },
  spaces: { ...base.spaces, ...keys.spaces },
  row: { ...base.row, ...keys.row },
})

/** Banda's presets, as look/sidebars/*.toml set them. */
const PRESETS = {
  inbox: {},
  spaces: {
    group: { by: "space", states: [...STATES], bottom: [] },
    row: { lines: 1 },
  },
  places: {
    group: { states: [...STATES], bottom: [] },
    spaces: { list: true },
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
  settled: readonly string[] = []
) =>
  arrange(lists, spaces, resolve(preset, keys), only, toggled, (listed) =>
    settled.includes(listed.id)
  )

test("inbox: one list, what waits first; the working and the settled on shelves", () => {
  const inbox = of("inbox")
  expect(ids(inbox)).toEqual([
    ["active", ["letters", "migration", "form", "logo"]],
  ])
  expect(inbox.sections[0]?.label).toBe("")
  expect(ids(inbox, "shelves")).toEqual([["working", ["headers", "release"]]])
  expect(inbox.spaces).toBeUndefined()

  const settled = of("inbox", {}, undefined, undefined, ["logo", "letters"])
  expect(ids(settled)).toEqual([["active", ["migration", "form"]]])
  expect(ids(settled, "shelves")).toEqual([
    ["working", ["headers", "release"]],
    ["settled", ["letters", "logo"]],
  ])
  expect(settled.shelves.map((s) => [s.label, s.folded])).toEqual([
    ["Working", false],
    ["Settled", true],
  ])
})

test("a Thread at work is never settled", () => {
  const working = of("inbox", {}, undefined, undefined, ["headers"])
  expect(ids(working, "shelves")).toEqual([["working", ["headers", "release"]]])
})

test("spaces: each Space a section, what waits first, with its roll-up", () => {
  const bySpace = of("spaces")
  expect(ids(bySpace)).toEqual([
    ["s2", ["letters", "migration", "release"]],
    ["s1", ["form", "headers", "logo"]],
  ])
  expect(bySpace.sections[0]).toMatchObject({
    label: "API",
    mark: "failed",
    waiting: 2,
  })
  expect(bySpace.shelves).toEqual([])
  // A settled Thread goes last, and waits for no one.
  const settled = of("spaces", {}, undefined, undefined, ["letters"])
  expect(ids(settled)[0]).toEqual(["s2", ["migration", "release", "letters"]])
  expect(settled.sections[0]?.waiting).toBe(1)
})

test("places: the Spaces listed above, and a click on one shows its rows", () => {
  const places = of("places", {}, undefined, undefined, ["logo"])
  expect(
    places.spaces?.map((s) => [s.space.name, s.mark, s.waiting, s.count])
  ).toEqual([
    ["API", "failed", 2, 3],
    ["Landing", "asking", 1, 3],
    ["Quiet", "rest", 0, 0],
  ])
  expect(places.sections.find((s) => s.key === "settled")?.folded).toBe(true)
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
  const flat = of("spaces", { group: { by: "none" }, sort: { by: "title" } })
  expect(ids(flat)).toEqual([
    ["all", ["form", "headers", "letters", "logo", "migration", "release"]],
  ])
})

test("empty sections hide unless the settings show them", () => {
  const none = arrange({}, spaces, resolve("inbox"))
  expect(none.sections).toEqual([])
  expect(none.shelves).toEqual([])
  const shown = arrange(
    {},
    spaces,
    resolve("inbox", { group: { empty: "show" } })
  )
  expect(shown.sections.map((s) => s.key)).toEqual(["active"])
  expect(shown.shelves.map((s) => s.key)).toEqual(["working", "settled"])
})

test("folded comes from the settings, and the Person's toggle turns it over", () => {
  const keys: Keys = { group: { folded: ["API", "working"] } }
  const bySpace = of("spaces", keys)
  expect(bySpace.sections.find((s) => s.key === "s2")?.folded).toBe(true)
  const opened = of("spaces", keys, undefined, new Set(["s2", "s1"]))
  expect(opened.sections.map((s) => [s.key, s.folded])).toEqual([
    ["s2", false],
    ["s1", true],
  ])
  expect(
    of("inbox", keys).shelves.find((s) => s.key === "working")?.folded
  ).toBe(true)
})
