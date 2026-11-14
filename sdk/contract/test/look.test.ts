import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { AGENTS_FILE } from "../src/agents"
import { BROWSER_FILE } from "../src/browser"
import {
  DEFAULT_BAR,
  DEFAULT_COLUMNS,
  DEFAULT_DRAWER,
  DEFAULT_OVERVIEW,
  DEFAULT_GROUPS,
  DEFAULT_KEYS,
  DEFAULT_MOTION,
  fileOf,
  type Look,
  shown,
} from "../src/look"
import { DEFAULT_SIDEBAR } from "../src/sidebar"
import { TILING_FILE } from "../src/workspaces"
import { program } from "./built"

const look = (mode: Look["mode"], schemes: Look["schemes"]): Look => ({
  mode,
  schemes,
  vars: {},
  desk: { glass: false, material: "banda", sidebar: "panel" },
  motion: DEFAULT_MOTION,
  columns: DEFAULT_COLUMNS,
  bar: DEFAULT_BAR,
  drawer: DEFAULT_DRAWER,
  overview: DEFAULT_OVERVIEW,
  groups: DEFAULT_GROUPS,
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
  keys: DEFAULT_KEYS,
  notify: {
    system: "away",
    window: "out-of-sight",
    detail: true,
    quiet: "desktop",
    done: true,
    asking: true,
    failed: true,
    problems: true,
  },
  settings: {},
  files: {},
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

test("over glass each scheme shows its glass", () => {
  const glassy = (mode: Look["mode"], schemes: Look["schemes"]): Look => {
    const one = look(mode, schemes)
    return { ...one, desk: { ...one.desk, glass: true } }
  }
  const light_glass = { "--background": "#fff", "--muted": "#0001" }
  const dark_glass = { "--background": "#000", "--muted": "#fff1" }
  const schemes = { light, dark, light_glass, dark_glass }
  expect(shown(glassy("dark", schemes), false).colors).toBe(dark_glass)
  expect(shown(glassy("system", schemes), false).colors).toBe(light_glass)
  // Solid, the glass schemes are not drawn; a glass look that has none
  // shows the solid one.
  expect(shown(look("dark", schemes), false).colors).toBe(dark)
  expect(shown(glassy("dark", { light, dark }), false).colors).toBe(dark)
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

test("the window's own motion, columns and bar are what banda look gives with no files", () => {
  const printed = execFileSync(program("banda"), ["look"], {
    env: {
      ...process.env,
      BANDA_CONFIG: mkdtempSync(join(tmpdir(), "banda-look-")),
      BANDA_OMARCHY: "",
      XDG_CURRENT_DESKTOP: "",
      BANDA_FONTCONFIG: "",
      HYPRLAND_INSTANCE_SIGNATURE: "",
    },
    encoding: "utf8",
  })
  const look = JSON.parse(printed) as Look
  expect(look.motion).toEqual(DEFAULT_MOTION)
  // The columns are the look's with the widths of the Tiling's file (ADR
  // 0127, decision 4).
  const widths = fileOf(look.files, TILING_FILE).columns
  expect({ ...widths, ...look.columns }).toEqual(DEFAULT_COLUMNS)
  expect(look.bar).toEqual(DEFAULT_BAR)
  expect(look.drawer).toEqual(DEFAULT_DRAWER)
  expect(look.overview).toEqual(DEFAULT_OVERVIEW)
})

test("the window's own module files are what banda look gives with none", () => {
  const config = mkdtempSync(join(tmpdir(), "banda-browser-"))
  const printed = execFileSync(program("banda"), ["look"], {
    env: {
      ...process.env,
      BANDA_CONFIG: config,
      BANDA_OMARCHY: "",
      XDG_CURRENT_DESKTOP: "",
      HYPRLAND_INSTANCE_SIGNATURE: "",
    },
    encoding: "utf8",
  })
  const { files } = JSON.parse(printed) as Look
  expect(files[BROWSER_FILE.name]).toEqual(BROWSER_FILE.before)
  expect(files[AGENTS_FILE.name]).toEqual(AGENTS_FILE.before)
  expect(files[TILING_FILE.name]).toEqual(TILING_FILE.before)
})
