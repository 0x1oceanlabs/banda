import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { Look } from "../src/look"
import { DEFAULT_SIDEBAR, withPreset } from "../src/sidebar"

test("the line that names the preset changes, and nothing else", () => {
  const file = [
    "# mine",
    'preset = "inbox"  # the default',
    "",
    "[row]",
    'preset = "not this one"',
  ].join("\n")
  expect(withPreset(file, "places")).toBe(
    [
      "# mine",
      'preset = "places"  # the default',
      "",
      "[row]",
      'preset = "not this one"',
    ].join("\n")
  )
})

test("a file that names none gets the line at the top", () => {
  expect(withPreset("", "spaces")).toBe('preset = "spaces"\n')
  expect(withPreset("[row]\nlines = 1\n", "spaces")).toBe(
    'preset = "spaces"\n[row]\nlines = 1\n'
  )
  expect(withPreset("preset = 'inbox'\n", "my-own")).toBe('preset = "my-own"\n')
})

test("the window's own arrangement is what bandaso look gives with no files", () => {
  const repository = join(import.meta.dirname, "../..")
  const config = mkdtempSync(join(tmpdir(), "banda-sidebar-"))
  const printed = execFileSync(
    join(repository, "target/debug/bandaso"),
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
  expect((JSON.parse(printed) as Look).sidebar).toEqual({
    ...DEFAULT_SIDEBAR,
    file: join(config, "sidebar.toml"),
  })
})
