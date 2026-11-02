import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import type { Look } from "../src/look"
import { DEFAULT_SIDEBAR } from "../src/sidebar"

test("the window's own arrangement is what banda look gives with no files", () => {
  const repository = join(import.meta.dirname, "../..")
  const config = mkdtempSync(join(tmpdir(), "banda-sidebar-"))
  const printed = execFileSync(
    join(repository, "target/debug/banda"),
    ["look"],
    {
      env: {
        ...process.env,
        BANDA_CONFIG: config,
        BANDA_OMARCHY: "",
        XDG_CURRENT_DESKTOP: "",
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
