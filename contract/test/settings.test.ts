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

test("a list of states is some of them, and every file has rows", () => {
  const states = rowsOf("sidebar.toml").find((r) => r.key === "group.states")!
  expect(states.control.kind).toBe("many")
  for (const file of Object.keys(SCHEMAS)) expect(rowsOf(file)).not.toEqual([])
})

test("a value is written as TOML", () => {
  expect(tomlOf('a "b"')).toBe('"a \\"b\\""')
  expect(tomlOf(3)).toBe("3")
  expect(tomlOf(["active", "working"])).toBe('["active", "working"]')
})
