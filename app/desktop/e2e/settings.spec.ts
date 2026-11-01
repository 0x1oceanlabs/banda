import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("Alt+, opens the settings window, which writes the files and follows them (ADR 0016)", async () => {
  window = await startWindow({ look: "# Mine.\nradius = 6\n" })
  const { app, page, dir } = window
  const file = join(dir, "config/look.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()

  await page.keyboard.press("Alt+Comma")
  const settingsPage = () =>
    app.windows().find((shown) => shown.url().includes("#settings"))
  await expect.poll(settingsPage).toBeTruthy()
  const settings = settingsPage()!
  await expect(settings).toHaveTitle("Banda Settings")
  await expect(
    settings.getByRole("heading", { name: "Appearance" })
  ).toBeVisible()

  // Each value says where it comes from; the Person's has a ↶.
  const radius = settings.locator('[data-key="radius"]')
  await expect(radius).toContainText("look.toml:2")
  await expect(radius.getByRole("spinbutton", { name: "Radius" })).toHaveValue(
    "6"
  )

  // A change applies at once, and keeps the file's comment.
  const border = settings.locator('[data-key="tile.border"]')
  const field = border.getByRole("spinbutton", { name: "Border" })
  await field.fill("3")
  await field.press("Enter")
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toBe("# Mine.\nradius = 6\n\n[tile]\nborder = 3\n")
  await expect(page.locator("html")).toHaveCSS("--tile-border", "3px")
  await expect(border).toContainText("look.toml:5")
  await settings.screenshot({ path: "test-results/settings-appearance.png" })

  // A value the file would not take is refused, said at the row.
  await field.fill("-1")
  await field.press("Enter")
  await expect(border.getByRole("alert")).toBeVisible()
  expect(readFileSync(file, "utf8")).toContain("border = 3")

  // ↶ takes the line out, and Banda's own shows again.
  await border.getByRole("button", { name: "Reset tile.border" }).click()
  await expect.poll(() => readFileSync(file, "utf8")).not.toContain("border")

  // A hand edit shows as soon as it is saved.
  writeFileSync(file, "radius = 9\n")
  await expect(radius.getByRole("spinbutton", { name: "Radius" })).toHaveValue(
    "9"
  )

  // The search finds a row in any section, and goes to it.
  await settings.keyboard.press("/")
  await settings.keyboard.type("volume")
  await settings.getByRole("button", { name: /Volume/ }).click()
  await expect(
    settings.getByRole("heading", { name: "Sounds & calls" })
  ).toBeVisible()

  // One window: the sidebar's gear brings it forward, Esc closes it.
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: "Settings" })
    .click()
  await expect.poll(() => app.windows().length).toBe(2)
  // The window goes as the key goes down, so the press may not finish.
  await settings.keyboard.down("Escape").catch(() => undefined)
  await expect.poll(() => app.windows().length).toBe(1)
})
