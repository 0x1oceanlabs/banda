import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import {
  DEFAULT_BROWSER,
  DEFAULT_COLUMNS,
  DEFAULT_KEYS,
  DEFAULT_MOTION,
  type Look,
  shown,
} from "../src/look"
import { DEFAULT_SIDEBAR } from "../src/sidebar"

const look = (mode: Look["mode"], schemes: Look["schemes"]): Look => ({
  mode,
  schemes,
  vars: {},
  desk: { glass: false, material: "banda", sidebar: "panel" },
  motion: DEFAULT_MOTION,
  columns: DEFAULT_COLUMNS,
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
  sidebar: DEFAULT_SIDEBAR,
  browser: DEFAULT_BROWSER,
  agents: { enter: "steer" },
  keys: DEFAULT_KEYS,
  notify: {
    system: "away",
    window: "out-of-sight",
    detail: true,
    quiet: "desktop",
    done: true,
    asking: true,
    failed: true,
  },
  settings: {},
  config: "",
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

test("the window's own motion and columns are what banda look gives with no files", () => {
  const repository = join(import.meta.dirname, "../..")
  const printed = execFileSync(
    join(repository, "target/debug/banda"),
    ["look"],
    {
      env: {
        ...process.env,
        BANDA_CONFIG: mkdtempSync(join(tmpdir(), "banda-look-")),
        BANDA_OMARCHY: "",
        BANDA_FONTCONFIG: "",
        HYPRLAND_INSTANCE_SIGNATURE: "",
      },
      encoding: "utf8",
    }
  )
  const look = JSON.parse(printed) as Look
  expect(look.motion).toEqual(DEFAULT_MOTION)
  expect(look.columns).toEqual(DEFAULT_COLUMNS)
})

test("the window's own browser is what banda look gives with no files", () => {
  const repository = join(import.meta.dirname, "../..")
  const config = mkdtempSync(join(tmpdir(), "banda-browser-"))
  const printed = execFileSync(
    join(repository, "target/debug/banda"),
    ["look"],
    {
      env: {
        ...process.env,
        BANDA_CONFIG: config,
        BANDA_OMARCHY: "",
        HYPRLAND_INSTANCE_SIGNATURE: "",
      },
      encoding: "utf8",
    }
  )
  expect((JSON.parse(printed) as Look).browser).toEqual(DEFAULT_BROWSER)
})
