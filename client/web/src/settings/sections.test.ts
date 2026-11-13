import { rowsOf } from "@banda/contract/settings"
import { expect, test } from "vitest"
import { groupsOf, parseLink, search, SECTIONS, switches } from "./sections"

test("each section has an id of its own, so a link can open any of them", () => {
  const ids = SECTIONS.map((section) => section.id)
  expect(ids).toEqual([...new Set(ids)])
  for (const section of SECTIONS) {
    expect(parseLink(section.id).section).toBe(section)
    expect(parseLink(`${section.id}/some.key`)).toEqual({
      section,
      key: "some.key",
    })
  }
})

test("the Files App's section keeps the link files, and the settings files have their own", () => {
  expect(parseLink("files").section.title).toBe("Files")
  expect(parseLink("settings-files").section.title).toBe("Settings files")
})

const sectionOf = (id: string) => SECTIONS.find((s) => s.id === id)!
const keysOf = (id: string) =>
  groupsOf(sectionOf(id)).flatMap((g) => g.rows.map((r) => r.key))

test("sidebar.toml's two machine keys show only in Machines, not in Sidebar, while Sidebar keeps its others", () => {
  expect(keysOf("sidebar")).not.toContain("machines.rows")
  expect(keysOf("sidebar")).not.toContain("machines.this-too")
  expect(keysOf("sidebar")).toContain("group")
  // Drawn by the Machines section's Show card, not as rows of its own.
  expect(keysOf("machines")).toEqual([])
  expect(sectionOf("machines").files?.at(-1)).toMatchObject({
    name: "sidebar.toml",
    tables: ["machines"],
    drawn: true,
  })
})

test("a search finds the two machine keys, in the card's words, and lands on Machines", () => {
  const first = search("machine on rows")[0]
  expect(first).toMatchObject({
    section: { id: "machines" },
    row: { key: "machines.rows", title: "Machine on rows" },
  })
  expect(parseLink(`${first.section.id}/${first.row.key}`)).toMatchObject({
    section: { id: "machines" },
    key: "machines.rows",
  })
  expect(search("name this machine")[0]).toMatchObject({
    section: { id: "machines" },
    row: { key: "machines.this-too", title: "Name this machine too" },
  })
  expect(search("machines.this-too")).toHaveLength(1)
})

test("with one machine, a search finds neither key, as the section draws neither", () => {
  expect(search("machine on rows", false)).toEqual([])
  expect(search("name this machine", false)).toEqual([])
  // Other rows are found as before.
  expect(search("inbox.order", false).map((f) => f.row.key)).toContain(
    "inbox.order"
  )
})

test("the Flow's row stays in Agents, and is the Tiling's file's (ADR 0127, decision 4)", () => {
  const rows = groupsOf(sectionOf("agents")).flatMap((group) =>
    group.rows.map((row) => ({ ...row, group: group.title }))
  )
  expect(rows.filter((row) => row.key === "flow")).toMatchObject([
    { file: "tiling.toml", title: "Flow", group: "Writing to an Agent" },
  ])
  // The Tiling's rules have no row yet: its section draws them (part b).
  expect(rows.filter((row) => row.file === "tiling.toml")).toHaveLength(1)
  expect(search("flow").map((found) => found.row.file)).toContain("tiling.toml")
})

test("another drawn table stays out of the search", () => {
  const drawn = rowsOf("agents.toml").filter(({ key }) => /^start\b/.test(key))
  expect(drawn.length).toBeGreaterThan(0)
  for (const { key } of drawn)
    expect(search(key).map((found) => found.row.key)).not.toContain(key)
})

test("a section switches with Settings for where it shows one machine's part: a file's, or what its engine keeps; Machines shows every machine itself", () => {
  const switching = SECTIONS.filter(switches).map((section) => section.id)
  // What an engine keeps, in no file.
  expect(switching).toEqual(
    expect.arrayContaining(["general", "projects", "problems"])
  )
  // A file with a part of the machine's.
  expect(switching).toEqual(expect.arrayContaining(["agents", "sharing"]))
  // This device's alone, and every machine's.
  expect(switching).not.toContain("appearance")
  expect(switching).not.toContain("machines")
})
