import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

/** Alt+, in `page`, and the settings window it opens. */
async function openSettings(
  app: ElectronApplication,
  page: Page
): Promise<Page> {
  await page.keyboard.press("Alt+Comma")
  const settingsPage = () =>
    app.windows().find((shown) => shown.url().includes("#settings"))
  await expect.poll(settingsPage).toBeTruthy()
  return settingsPage()!
}

test.afterEach(async () => {
  await window?.close()
})

test("Alt+, opens the settings window, which writes the files and follows them (ADR 0016)", async () => {
  window = await startWindow({ look: "# Mine.\nradius = 6\n" })
  const { app, page, dir } = window
  const file = join(dir, "config/look.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()

  const settings = await openSettings(app, page)
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

test("Agents show who is signed in to each Harness, and write harnesses.toml", async () => {
  window = await startWindow({ account: true, oldCli: true })
  const { app, page, dir } = window
  const file = join(dir, "config/harnesses.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const settings = await openSettings(app, page)
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
  const asking = settings.getByRole("dialog", { name: "Sign out of Fake AI?" })
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
  const adding = settings.getByRole("dialog", { name: "Add a Harness" })
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
  await settings
    .getByRole("dialog", { name: "Remove Other Agent?" })
    .getByRole("button", { name: "Remove" })
    .click()
  await expect(other).toHaveCount(0)
  expect(readFileSync(file, "utf8")).not.toContain("other")

  // What Enter does while an Agent works is the window's to choose.
  const choice = settings
    .getByRole("radiogroup", { name: /while an Agent works/ })
    .getByRole("radio", { name: "Queue it" })
  await choice.click()
  await settings.reload()
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Agents/ })
    .click()
  await expect(choice).toBeChecked()
})
