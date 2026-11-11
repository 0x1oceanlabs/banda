import { expect, test } from "vitest"
import { rowsOf, SCHEMAS, tomlOf } from "../src/settings"

test("each key of a file is a row, from its schema", () => {
  const rows = rowsOf("look.toml")
  const row = (key: string) => rows.find((r) => r.key === key)!
  expect(row("radius").control).toEqual({
    kind: "number",
    min: 0,
    max: undefined,
    integer: false,
  })
  expect(row("tile.dim-inactive")).toMatchObject({
    group: "tile",
    title: "Dim inactive",
    control: { kind: "number", min: 0, max: 1 },
  })
  expect(row("mode").control).toEqual({
    kind: "choice",
    options: [{ value: "system" }, { value: "light" }, { value: "dark" }],
  })
  expect(row("hyprland").control).toEqual({ kind: "switch" })
  expect(row("sound.volume").about).toBe("0 to 1, for every sound.")
  // A sound is on, off, or another family's.
  const done = row("sound.done").control
  expect(done.kind === "choice" && done.options.map((o) => o.value)).toEqual(
    expect.arrayContaining([true, false, "glass"])
  )
  expect(row("tile.radius").control).toEqual({ kind: "free" })
  expect(row("colors").control).toEqual({ kind: "file" })
  expect(rows.some((r) => r.key === "motion.strip.spring.damping-ratio")).toBe(
    true
  )
})

test("a list of counts is some of them, and every file has rows", () => {
  const counts = rowsOf("sidebar.toml").find((r) => r.key === "bar.counts")!
  expect(counts.control.kind).toBe("many")
  for (const file of Object.keys(SCHEMAS)) expect(rowsOf(file)).not.toEqual([])
})

test("the sidebar's view is a choice of groups and of a card's lines, and switches for the Inbox's parts (ADR 0098)", () => {
  const rows = rowsOf("sidebar.toml")
  const control = (key: string) => rows.find((r) => r.key === key)?.control
  const values = (key: string) => {
    const at = control(key)
    return at?.kind === "choice" ? at.options.map((o) => o.value) : at
  }
  expect(values("group")).toEqual(["none", "project", "machine"])
  expect(values("card")).toEqual(["auto", 3, 2, 1])
  expect(values("inbox.order")).toEqual(["oldest", "newest"])
  for (const key of ["inbox.open", "inbox.working", "hold.still"])
    expect(control(key)).toEqual({ kind: "switch" })
  // What ADR 0098 put out of use is no row.
  for (const gone of ["group.by", "row.lines", "projects.list"])
    expect(control(gone)).toBeUndefined()
})

test("how another machine shows on rows is one of three, and naming this one a switch", () => {
  const rows = rowsOf("sidebar.toml")
  const row = (key: string) => rows.find((r) => r.key === key)!
  expect(row("machines.rows")).toMatchObject({
    group: "machines",
    control: {
      kind: "choice",
      options: [{ value: "named" }, { value: "icon" }, { value: "off" }],
    },
  })
  expect(row("machines.this-too")).toMatchObject({
    title: "This too",
    control: { kind: "switch" },
  })
})

test("a value is written as TOML", () => {
  expect(tomlOf('a "b"')).toBe('"a \\"b\\""')
  expect(tomlOf(3)).toBe("3")
  expect(tomlOf(["active", "working"])).toBe('["active", "working"]')
})
