/**
 * Each built-in theme in all four, light and dark, solid and over glass,
 * shot and compared with the shots kept in `shots/` (ADR 0100, decision 4).
 * The glass is made of a fixed backdrop, white, mid grey and black side
 * by side, the worst a wallpaper can be (decision 8), so a shot changes
 * only when Banda draws otherwise. Omarchy's theme is two of its own,
 * tokyo-night and catppuccin-latte, from the theme's test fixtures.
 *
 * The shots are CI's: fonts and their rendering differ machine to
 * machine, so elsewhere each look is shot into `test-results/themes/` for
 * eyes and not compared. For a change that means to show,
 * `scripts/bless-shots.sh <run>` keeps the shots a failed CI run made.
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Omarchy's own themes, as platform/theme keeps them. */
const OMARCHY = resolve(
  import.meta.dirname,
  "../../../platform/theme/tests/fixtures/omarchy"
)

/** Each theme, and the Omarchy theme it shows for `omarchy`. */
const THEMES = [
  { theme: "banda", mode: "light" },
  { theme: "banda", mode: "dark" },
  { theme: "macos", mode: "light" },
  { theme: "macos", mode: "dark" },
  { theme: "omarchy", mode: "light", omarchy: "catppuccin-latte" },
  { theme: "omarchy", mode: "dark", omarchy: "tokyo-night" },
] as const

/** What a shot is compared with: CI's own, on CI's machine. */
const COMPARED = Boolean(process.env.CI)

/** The tokens the page shows once it shows a look: the ground, the desk,
 * the quiet text and the accent. */
const SHOWN = ["--background", "--desk", "--muted-foreground", "--primary"]

test("each built-in theme draws as it did, light and dark, solid and over glass", async () => {
  test.setTimeout(180_000)
  const dir = mkdtempSync(join(tmpdir(), "banda-window-"))
  const current = join(dir, "omarchy/current/theme")
  mkdirSync(current, { recursive: true })
  copyFileSync(join(OMARCHY, "tokyo-night.toml"), join(current, "colors.toml"))
  mkdirSync(join(dir, "config"), { recursive: true })
  copyFileSync(
    join(import.meta.dirname, "backdrop.png"),
    join(dir, "config/wall.png")
  )
  window = await startWindow({
    dir,
    look: lookToml("banda", "light", false),
    env: { BANDA_OMARCHY: current },
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  // Text, quiet text, a link, inline code, a list and a table, in the
  // Person's bubble and the reply.
  await composer.fill(
    [
      "A **theme** with `inline code` and [a link](https://example.com).",
      "- one\n- two",
      "| A | B |\n|---|---|\n| 1 | 2 |",
    ].join("\n\n")
  )
  await composer.press("Enter")
  await expect(thread.locator("[data-quotable] table")).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.mouse.move(640, 799)
  await page.evaluate(() => document.fonts.ready)

  for (const { theme, mode, ...rest } of THEMES) {
    if ("omarchy" in rest)
      copyFileSync(
        join(OMARCHY, `${rest.omarchy}.toml`),
        join(current, "colors.toml")
      )
    for (const glass of [true, false]) {
      writeFileSync(join(dir, "config/look.toml"), lookToml(theme, mode, glass))
      await shows(page, window, mode, glass)
      const name = `${theme}-${mode}-${glass ? "glass" : "solid"}`
      const options = {
        animations: "disabled" as const,
        caret: "hide" as const,
        // The card's "now", which turns to "1m".
        mask: [page.locator("[data-row] .tabular-nums")],
      }
      // A pixel differs at about 5 levels, not Playwright's 37: a denser
      // desk's tint moves it by 10 or so. A shot may differ in 100 pixels.
      if (COMPARED)
        await expect.soft(page).toHaveScreenshot(`${name}.png`, {
          ...options,
          threshold: 0.02,
          maxDiffPixels: 100,
        })
      else
        await page.screenshot({
          ...options,
          path: `test-results/themes/${name}.png`,
        })
    }
  }
})

/** The bar's right as Banda's, but the clock, whose day and time change
 * how wide the bar's right is as they pass. */
const RIGHT = `["workspaces.aside", "terminal.ports", "harnesses.limits", "notifications.recent"]`

/** look.toml of a theme in a mode, glass or solid, still. */
function lookToml(theme: string, mode: string, glass: boolean): string {
  return `theme = "${theme}"\nmode = "${mode}"\n[motion]\noff = true\n[desk]\nglass = ${glass}\nwallpaper = "wall.png"\n[bar]\nright = ${RIGHT}\n`
}

/** Waits until the page shows the look `banda look` resolves now: its
 * glass, and the scheme of `mode` over it. */
async function shows(page: Page, window: Window, mode: string, glass: boolean) {
  const look = JSON.parse(window.banda("look")) as {
    desk: { glass: boolean }
    schemes: Record<string, Record<string, string>>
  }
  expect(look.desk.glass).toBe(glass)
  const scheme = look.schemes[glass ? `${mode}_glass` : mode]!
  const wanted = SHOWN.map((name) => scheme[name])
  const html = page.locator("html")
  if (glass) await expect(html).toHaveAttribute("data-glass", "")
  else await expect(html).not.toHaveAttribute("data-glass")
  await expect
    .poll(() =>
      page.evaluate(
        (names) =>
          names.map((name) =>
            document.documentElement.style.getPropertyValue(name)
          ),
        SHOWN
      )
    )
    .toEqual(wanted)
}
