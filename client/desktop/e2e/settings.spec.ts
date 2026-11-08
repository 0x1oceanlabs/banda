import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { firstThread, startWindow, textOf, type Window } from "./window"

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

  // ↶ takes the line out, and Banda's own shows again. The field's blur
  // on the way sends -1 once more; only ↶'s answer counts, so the refusal
  // goes with the value it was against.
  await border.getByRole("button", { name: "Reset tile.border" }).click()
  await expect.poll(() => readFileSync(file, "utf8")).not.toContain("border")
  await expect(border.getByRole("alert")).toHaveCount(0)

  // A hand edit shows as soon as it is saved.
  writeFileSync(file, "radius = 9\n")
  await expect(radius.getByRole("spinbutton", { name: "Radius" })).toHaveValue(
    "9"
  )

  // A value that does not read shows at its key's row, though the row's
  // value is still Banda's own.
  writeFileSync(file, 'radius = 9\n\n[tile]\nborder = "thick"\n')
  await expect(border.getByRole("alert")).toContainText("thick")
  writeFileSync(file, "radius = 9\n")
  await expect(border.getByRole("alert")).toHaveCount(0)

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
  await settings.getByRole("button", { name: "Close Settings" }).click()
  await expect(settings).toHaveCount(0)
})

test("Agents show who is signed in to each Harness, and write harnesses.toml", async () => {
  window = await startWindow({ account: true, oldCli: true })
  const { page, dir } = window
  const file = join(dir, "config/harnesses.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  // Full access written into agents.toml by hand is no one's choice: where
  // the fence does not hold, as here, it counts only as the Person picks
  // it in Settings, which writes through the engine (ADR 0083).
  const agents = join(dir, "config/agents.toml")
  writeFileSync(agents, '[start.fake]\nmode = "full_access"\n')
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

  // What a new Thread starts with is agents.toml's, set from the
  // composer's own bar, and ↶ gives it back to the Harness. The file's
  // Full access shows as Supervised until the Person picks it here.
  await fake.getByRole("button", { name: "Mode: Supervised" }).click()
  await page.getByRole("menuitemradio", { name: /Full access/ }).click()
  await expect
    .poll(() => textOf(agents))
    .toContain('[start.fake]\nmode = "full_access"')
  await expect(
    fake.getByRole("button", { name: "Mode: Full access" })
  ).toBeVisible()
  await fake.getByRole("button", { name: "Fake AI's own" }).click()
  await expect.poll(() => textOf(agents)).not.toContain("[start.fake]")
  expect(readFileSync(file, "utf8")).not.toContain("[harness.start]")

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

  // A mistake made in an editor shows here, at its line, and the list
  // from before stays.
  const good = readFileSync(file, "utf8")
  writeFileSync(file, `${good}\n[[harness]]\nid = "nobody"\n`)
  const lines = good.split("\n").length + 1
  await expect(settings.getByRole("alert")).toContainText(
    `harnesses.toml:${lines}:1: Banda does not know a Harness "nobody"`
  )
  await expect(fake).toBeVisible()
  writeFileSync(file, good)
  await expect(settings.getByRole("alert")).toHaveCount(0)

  // What Enter does while an Agent works is agents.toml's, under the
  // Harnesses.
  const enter = settings.locator('[data-key="enter"]')
  await expect(enter).toContainText(/while the Agent works/)
  await enter.getByRole("radio", { name: "queue" }).click()
  await expect
    .poll(() => textOf(join(dir, "config/agents.toml")))
    .toMatch(/^enter = "queue"$/m)
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
  // The fence, off in the tests: why, what Full access means then, and
  // where each Harness's new Threads' mode is (ADR 0083).
  const fence = settings.locator('[data-key="fence"]')
  await expect(fence).toContainText(
    "Off. It is turned off for testing (BANDA_FENCE=off). New Threads start Supervised, unless you set another mode for them."
  )
  await expect(fence).toContainText(
    "In Full access, an Agent is you, in Banda too."
  )
  await fence.getByRole("button", { name: "New Threads' mode" }).click()
  await expect(settings.getByRole("group", { name: "Fake AI" })).toBeVisible()

  await sections.getByRole("button", { name: /Sidebar/ }).click()
  const preset = settings.locator('[data-key="preset"]')
  await expect(preset.getByRole("radio", { name: "inbox" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await preset.getByRole("radio", { name: "projects" }).click()
  await expect
    .poll(() => textOf(join(dir, "config/sidebar.toml")))
    .toContain('preset = "projects"')
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

test("Keys: the main key moves Banda's keys, and the Person's lines with it (ADR 0068)", async () => {
  window = await startWindow({
    files: {
      "config/keys.toml":
        '[binds]\n"Alt+M" = "column.maximize"\n"Alt+F" = "none"\n',
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

  // Ctrl+Alt is written, and the lines that held Alt are shown to move:
  // Alt+M to Ctrl+Alt+M, and Alt+F's none goes.
  await settings.getByRole("radio", { name: /^Ctrl\+Alt/ }).click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toMatch(/^mod = "Ctrl\+Alt"\n/)
  await expect(settings).toContainText("2 of your keys hold Alt")
  await settings.getByRole("button", { name: "Move", exact: true }).click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toBe('mod = "Ctrl+Alt"\n[binds]\n"Ctrl+Alt+M" = "column.maximize"\n')

  // Banda's keys read with it, and a mod that cannot be one is refused.
  await expect(settings).toContainText("Ctrl+Alt+Return")
  await settings.getByRole("radio", { name: /^Your own/ }).click()
  await settings.getByRole("button", { name: "Super", exact: true }).click()
  await expect(settings).toContainText("all three leave no key")
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toMatch(/^mod = "Ctrl\+Alt"\n/)
})

test("New terminal: Ctrl+Alt+Enter opens a shell, and its keys can be assigned, changed and freed", async () => {
  window = await startWindow()
  const { page, dir } = window
  const file = join(dir, "config/keys.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const screens = page.getByRole("region", { name: "Terminal screen" })

  // The default key opens a working shell in the focused Project. Another
  // press from the terminal opens another shell, rather than typing in it.
  await page.keyboard.press("Control+Alt+Enter")
  await expect(screens).toHaveCount(1)
  await expect(screens).toHaveAttribute("data-state", "running")
  await screens.click()
  await page.keyboard.type("pwd > terminal-folder.txt")
  await page.keyboard.press("Enter")
  await expect
    .poll(() => textOf(join(dir, "root/Work/terminal-folder.txt")).trim())
    .toBe(join(dir, "root/Work"))
  await page.keyboard.press("Control+Alt+Enter")
  await expect(screens).toHaveCount(2)
  await expect(screens.last()).toHaveAttribute("data-state", "running")
  await page.keyboard.press("Alt+KeyW")
  await expect(screens).toHaveCount(1)
  await page.keyboard.press("Alt+KeyW")
  await expect(screens).toHaveCount(0)

  // New terminal is in the same key sheet as every other action. A key
  // assigned there is a line in Settings > Keys, ready to change.
  const settings = await openSettings(page)
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Keys/ })
    .click()
  await settings.getByRole("button", { name: "Open the key sheet" }).click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await search.fill("New terminal")
  await expect(
    menu.getByRole("option", { name: /^New terminal/ })
  ).toBeVisible()
  await search.press("Tab")
  const acts = menu.getByRole("listbox", { name: "Actions" })
  await acts.getByRole("option", { name: "Add a key…" }).click()
  await search.press("F8")
  await expect(menu.getByRole("status")).toContainText(
    "F8 runs “New terminal” now"
  )
  await expect.poll(() => textOf(file)).toMatch(/^"?F8"? = "terminal.new"$/m)
  await search.press("Escape")
  await expect(menu).toBeHidden()
  await settings
    .locator('[data-key="F8"]')
    .getByRole("button", { name: "Change F8" })
    .click()
  await page.keyboard.press("Control+Alt+KeyT")
  await expect
    .poll(() => textOf(file))
    .toContain('"Ctrl+Alt+T" = "terminal.new"')
  expect(textOf(file)).not.toMatch(/^"?F8"?\s*=/m)
  await expect(settings.locator('[data-key="Ctrl+Alt+T"]')).toContainText(
    "terminal.new"
  )
  await page.screenshot({ path: "test-results/settings-terminal-key.png" })
  await settings.getByRole("button", { name: "Close Settings" }).click()
  await expect(settings).toBeHidden()
  await composer.click()

  // The previous key is gone; the new one and the default both work.
  await page.keyboard.press("F8")
  await page.keyboard.press("Control+Alt+KeyT")
  await expect(screens).toHaveCount(1)
  await expect(screens).toHaveAttribute("data-state", "running")
  await page.keyboard.press("Control+Alt+Enter")
  await expect(screens).toHaveCount(2)
  await expect(screens.last()).toHaveAttribute("data-state", "running")
  await page.keyboard.press("Alt+KeyW")
  await expect(screens).toHaveCount(1)
  await page.keyboard.press("Alt+KeyW")
  await expect(screens).toHaveCount(0)

  // Freeing its default leaves only the custom key in force, at once.
  await page.keyboard.press("Alt+KeyK")
  await search.fill("New terminal")
  await search.press("Tab")
  await acts.getByRole("option", { name: "Free Ctrl+Alt+Return" }).click()
  await expect(menu.getByRole("status")).toContainText(
    "Ctrl+Alt+Return goes to the Pane now"
  )
  await expect.poll(() => textOf(file)).toContain('"Ctrl+Alt+Return" = "none"')
  await expect(
    menu
      .getByRole("option", { name: /^New terminal/ })
      .locator("[data-slot=kbd-group]")
  ).toHaveCount(1)
  await search.press("Escape")
  await expect(menu).toBeHidden()
  await composer.click()
  await page.keyboard.press("Control+Alt+Enter")
  await page.keyboard.press("Control+Alt+KeyT")
  await expect(screens).toHaveCount(1)
  await expect(screens).toHaveAttribute("data-state", "running")
})

test("Sharing: nothing on and no ID, then an ID as a switch turns on, and a Banda from a checkout never sends (ADR 0039)", async () => {
  window = await startWindow()
  const { page, dir } = window
  const file = join(dir, "config/sharing.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const settings = await openSettings(page)
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Sharing/ })
    .click()

  const problems = settings.locator('[data-key="problems"]').getByRole("switch")
  await expect(problems).toHaveAttribute("aria-checked", "false")
  await expect(
    settings.locator('[data-key="usage"]').getByRole("switch")
  ).toHaveAttribute("aria-checked", "false")
  await expect(settings).toContainText("None while nothing is shared")
  await expect(settings).toContainText("Nothing sent.")
  await expect(settings).toContainText("This Banda runs from a checkout")

  await problems.click()
  await expect
    .poll(() => (existsSync(file) ? readFileSync(file, "utf8") : ""))
    .toMatch(/^problems = true$/m)
  const newId = settings.getByRole("button", { name: "New ID" })
  await expect(newId).toBeVisible()
  const id = readFileSync(join(dir, "state/sharing-id"), "utf8")
  await newId.click()
  await expect
    .poll(() => readFileSync(join(dir, "state/sharing-id"), "utf8"))
    .not.toBe(id)
  await page.screenshot({ path: "test-results/settings-sharing.png" })

  // All of it off: the ID goes.
  await problems.click()
  await expect(newId).toHaveCount(0)
  await expect(settings).toContainText("None while nothing is shared")
})

test("The first run asks to share once, nothing ticked, after the first Project; Continue writes the answer, nothing too (ADR 0039)", async () => {
  window = await startWindow({ asked: false })
  const { page, dir } = window
  const file = join(dir, "config/sharing.toml")
  await firstThread(page)

  const ask = page.getByRole("dialog", { name: "Help make Banda better?" })
  await expect(ask).toBeVisible()
  const problems = ask.getByRole("checkbox").first()
  const usage = ask.getByRole("checkbox").nth(1)
  await expect(problems).not.toBeChecked()
  await expect(usage).not.toBeChecked()
  await expect(ask.getByRole("button")).toHaveText([
    /See exactly what is sent/,
    "Continue",
  ])
  await ask.getByRole("button", { name: /See exactly what is sent/ }).click()
  // The engine's own: the same code makes what goes.
  await expect(ask).toContainText('"event": "$exception"')
  await expect(ask).toContainText('"event": "day"')
  await expect(ask).toContainText('"distinct_id": "<a random ID>"')
  await page.screenshot({ path: "test-results/sharing-ask.png" })

  // Nothing ticked is an answer too, though the file's template says it.
  await ask.getByRole("button", { name: "Continue" }).click()
  await expect(ask).toHaveCount(0)
  const text = readFileSync(file, "utf8")
  expect(text).toMatch(/^problems = false$/m)
  expect(text).toMatch(/^usage = false$/m)
})

test("Terminal: terminal.toml's rows write the file, and a terminal open follows it (ADR 0047)", async () => {
  window = await startWindow({
    files: { "config/terminal.toml": '[cursor]\nstyle = "bar"\n' },
  })
  const { page, dir } = window
  const file = join(dir, "config/terminal.toml")
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type("echo 'a -> b => c != d'")
  await page.keyboard.press("Enter")

  const settings = await openSettings(page)
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Terminal/ })
    .click()
  const ligatures = settings
    .locator('[data-key="ligatures"]')
    .getByRole("switch")
  await expect(ligatures).toHaveAttribute("aria-checked", "true")
  await expect(settings.locator('[data-key="cursor.style"]')).toContainText(
    "bar"
  )
  await page.screenshot({ path: "test-results/settings-terminal.png" })

  await ligatures.click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toMatch(/^ligatures = false$/m)
  await expect(ligatures).toHaveAttribute("aria-checked", "false")
  // The terminal stays running as its file changes under it.
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.screenshot({ path: "test-results/terminal-toml.png" })
})
