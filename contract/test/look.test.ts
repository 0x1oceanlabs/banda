import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { DEFAULT_MOTION, type Look, shown } from "../src/look"

const look = (mode: Look["mode"], schemes: Look["schemes"]): Look => ({
  mode,
  schemes,
  vars: {},
  motion: DEFAULT_MOTION,
  sources: [],
  problems: [],
  sound: {
    family: "banda",
    volume: 0.6,
    room: true,
    done: true,
    asking: true,
    failed: true,
  },
})
const light = { "--background": "#fff" }
const dark = { "--background": "#000" }

test("a pair follows the system when the look says so", () => {
  expect(shown(look("system", { light, dark }), true)).toEqual({
    dark: true,
    colors: dark,
  })
  expect(shown(look("system", { light, dark }), false).dark).toBe(false)
  expect(shown(look("light", { light, dark }), true).dark).toBe(false)
})

test("a theme with one scheme shows it whatever the system says", () => {
  expect(shown(look("dark", { dark }), false)).toEqual({
    dark: true,
    colors: dark,
  })
  expect(shown(look("system", { light }), true)).toEqual({
    dark: false,
    colors: light,
  })
})

test("the window's own motion is what bandaso look gives with no files", () => {
  const repository = join(import.meta.dirname, "../..")
  const printed = execFileSync(
    join(repository, "target/debug/bandaso"),
    ["look"],
    {
      env: {
        ...process.env,
        BANDA_CONFIG: mkdtempSync(join(tmpdir(), "banda-look-")),
        BANDA_OMARCHY: "",
        HYPRLAND_INSTANCE_SIGNATURE: "",
      },
      encoding: "utf8",
    }
  )
  expect((JSON.parse(printed) as Look).motion).toEqual(DEFAULT_MOTION)
})
