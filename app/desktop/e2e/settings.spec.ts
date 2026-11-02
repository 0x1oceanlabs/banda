import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

/** A file's text, empty until it is written: `expect.poll` stops at a
 * throw, so a file the next click creates is read this way. */
const textOf = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf8") : ""

let window: Window

/** The settings Pane in `page`. */
const settingsIn = (page: Page): Locator =>
  page.getByRole("region", { name: "Settings", exact: true })

/** Alt+, in `page`, and the settings Pane it opens. */
async function openSettings(page: Page): Promise<Locator> {
  await page.keyboard.press("Alt+Comma")
  const settings = settingsIn(page)
  await expect(settings).toBeVisible()
  return settings
}

test.afterEach(async () => {
  await window?.close()
})

test("Alt+, opens the settings Pane, which writes the files and follows them (ADR 0016)", async () => {
  window = await startWindow({ look: "# Mine.\nradius = 6\n" })
  const { app, page, dir } = window
  const file = join(dir, "config/look.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()

  const settings = await openSettings(page)
  await expect(settings.getByRole("heading", { name: "General" })).toBeVisible()
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Appearance/ })
    .click()

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
  await page.screenshot({ path: "test-results/settings-appearance.png" })

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
  await page.keyboard.press("/")
  await page.keyboard.type("volume")
  await settings.getByRole("button", { name: /Volume/ }).click()
  await expect(
    settings.getByRole("heading", { name: "Sounds & calls" })
  ).toBeVisible()

  // One Pane, in the window: the sidebar's gear goes to it, where it is,
  // and its × closes it.
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: "Settings" })
    .click()
  await expect(settings).toHaveCount(1)
  await expect(
    settings.getByRole("heading", { name: "Sounds & calls" })
  ).toBeVisible()
  expect(app.windows()).toHaveLength(1)
  await settings.getByRole("button", { name: "Close settings" }).click()
  await expect(settings).toHaveCount(0)
})

test("Agents show who is signed in to each Harness, and write harnesses.toml", async () => {
  window = await startWindow({ account: true, oldCli: true })
  const { page, dir } = window
  const file = join(dir, "config/harnesses.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const settings = await openSettings(page)
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Agents/ })
    .click()

  const fake = settings.getByRole("group", { name: "Fake AI" })
  await expect(
    fake.getByText(/^fake-cli 1\.0\.0 · banda-fake-agent \d/)
  ).toBeVisible()
  await expect(
    fake
      .getByRole("status")
      .filter({ hasText: /1\.0\.0 is older than 2\.0\.0/ })
  ).toBeVisible()
  await expect(fake.getByText("Not signed in.")).toBeVisible()

  await fake.getByRole("button", { name: "Sign in with Fake browser" }).click()
  await expect(
    fake.getByText("Signed in as person@example.invalid · Fake Pro")
  ).toBeVisible()
  await settings.screenshot({ path: "test-results/settings-agents.png" })

  await fake.getByRole("button", { name: "Sign out" }).click()
  const asking = page.getByRole("dialog", { name: "Sign out of Fake AI?" })
  await asking.getByRole("button", { name: "Sign out" }).click()
  await expect(fake.getByText("Not signed in.")).toBeVisible()

  // Off, the entry stays in the file, and no new Thread starts on it.
  await fake.getByRole("switch", { name: "Fake AI on" }).click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain("enabled = false")
  await expect(fake.getByText("Off: no new Thread starts on it.")).toBeVisible()
  await fake.getByRole("switch", { name: "Fake AI on" }).click()
  await expect.poll(() => readFileSync(file, "utf8")).not.toContain("enabled")

  // A new entry, and taking it out.
  await settings.getByRole("button", { name: /Add a Harness/ }).click()
  const adding = page.getByRole("dialog", { name: "Add a Harness" })
  await adding.getByLabel("Name").fill("Other Agent")
  await expect(adding.getByLabel("ID")).toHaveValue("other-agent")
  await adding.getByLabel("Command").fill("other-acp --stdio 'a b'")
  await adding.getByRole("button", { name: "Add" }).click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain(
      '[[harness]]\nid = "other-agent"\nname = "Other Agent"\ncommand = "other-acp"\nargs = ["--stdio", "a b"]\n'
    )
  const other = settings.getByRole("group", { name: "Other Agent" })
  await expect(
    other.getByRole("textbox", { name: "Other Agent command" })
  ).toHaveValue("other-acp --stdio 'a b'")
  await other.getByRole("button", { name: "Remove" }).click()
  await page
    .getByRole("dialog", { name: "Remove Other Agent?" })
    .getByRole("button", { name: "Remove" })
    .click()
  await expect(other).toHaveCount(0)
  expect(readFileSync(file, "utf8")).not.toContain("other")

  // What Enter does while an Agent works is agents.toml's, under the
  // Harnesses.
  const enter = settings.locator('[data-key="enter"]')
  await expect(enter).toContainText(/while the Agent works/)
  await enter.getByRole("radio", { name: "queue" }).click()
  await expect
    .poll(() => textOf(join(dir, "config/agents.toml")))
    .toContain('\nenter = "queue"\n')
  await expect(enter.getByRole("radio", { name: "queue" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
})

test("General, the sidebar's presets, and hearing a sound", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const settings = await openSettings(page)
  const sections = settings.getByRole("navigation", {
    name: "Settings sections",
  })
  await sections.getByRole("button", { name: /General/ }).click()
  await expect(settings.getByText(/^banda \d/)).toBeVisible()

  await sections.getByRole("button", { name: /Sidebar/ }).click()
  const preset = settings.locator('[data-key="preset"]')
  await expect(preset.getByRole("radio", { name: "inbox" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await preset.getByRole("radio", { name: "spaces" }).click()
  await expect
    .poll(() => textOf(join(dir, "config/sidebar.toml")))
    .toContain('preset = "spaces"')
  // Each key says what it does.
  await expect(settings.locator('[data-key="group.by"]')).toContainText(
    "What makes a section"
  )

  await sections.getByRole("button", { name: /Sounds/ }).click()
  await settings.getByRole("button", { name: "Play done" }).click()
  await expect(settings.locator('[data-key="notify.done"]')).toContainText(
    "finished"
  )
  await expect(
    settings.locator('[data-key="notify.done"]').getByRole("switch")
  ).toHaveAttribute("aria-checked", "true")
})

test("Keys: the lines of keys.toml, a key changed and taken out, and the reset chord (ADR 0005, decision 11)", async () => {
  window = await startWindow({
    files: {
      "config/keys.toml":
        '[binds]\n# mine\n"Alt+J" = "pane.close"\n"Alt+W" = "none"\n',
    },
  })
  const { page, dir } = window
  const file = join(dir, "config/keys.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const settings = await openSettings(page)
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Keys/ })
    .click()

  // Each line: its key, what it runs, and where it is.
  const close = settings.locator('[data-key="Alt+J"]')
  await expect(close).toContainText("pane.close")
  await expect(close).toContainText("keys.toml:3")
  await expect(settings.locator('[data-key="Alt+W"]')).toContainText(
    "goes to the Pane"
  )

  // The next key pressed is the line's; one that would be typed is not.
  await close.getByRole("button", { name: "Change Alt+J" }).click()
  await page.keyboard.press("KeyQ")
  await expect(close.getByRole("alert")).toContainText("would be typed")
  await close.getByRole("button", { name: "Change Alt+J" }).click()
  await page.keyboard.press("Alt+KeyQ")
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toBe('[binds]\n# mine\n"Alt+Q" = "pane.close"\n"Alt+W" = "none"\n')
  // It stays on its line, its comment above it.
  await expect(settings.locator('[data-key="Alt+Q"]')).toContainText(
    "keys.toml:3"
  )

  // The reset chord brings the window's own keys back, and goes to Keys:
  // Alt+Q is nothing again, and Alt+W closes the Pane.
  await composer.click()
  await page.keyboard.press("Control+Alt+Shift+KeyK")
  await expect(settings).toHaveAttribute("data-focused", "true")
  await composer.click()
  await page.keyboard.press("Alt+KeyQ")
  await expect(composer).toBeVisible()
  await page.keyboard.press("Alt+KeyW")
  await expect(composer).toBeHidden()

  // ↶ takes a line out.
  await settings
    .locator('[data-key="Alt+W"]')
    .getByRole("button", { name: "Reset Alt+W" })
    .click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toBe('[binds]\n# mine\n"Alt+Q" = "pane.close"\n')
})
