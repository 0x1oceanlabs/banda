import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  bandaMenu,
  firstThread,
  FREE,
  sharesOf,
  startWindow,
  textOf,
  type Window,
} from "./window"

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

  // Under the section's rows, one line: where its file is, and whose
  // copy it is (#1736, point 4). The look is this device's.
  const whose = settings.locator('[data-whose="look.toml"]')
  await expect(whose).toHaveCount(1)
  await expect(whose).toContainText("config/look.toml")
  await expect(whose).toContainText("on this device")
  await expect(whose.locator(`[title="${file}"]`)).toHaveCount(1)

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

  // One Sheet, in the window: the sidebar's gear goes to it, where it is,
  // and its × takes it away.
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

test("Agents show each account as a card, its page who is signed in, and write harnesses.toml", async () => {
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

  // Each account is a card, by Harness (ADR 0093, decision 9); the card
  // opens its page, which takes the card's name.
  const fake = settings.getByRole("group", { name: "Fake AI" })
  await expect(fake.getByText("Not signed in")).toBeVisible()
  await expect(fake.getByText("Default")).toBeVisible()
  await settings.getByRole("button", { name: "Open Fake AI" }).click()
  await expect(
    settings.getByRole("button", { name: "Accounts", exact: true })
  ).toBeVisible()
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
  await expect(fake.getByText("person@example.invalid")).toBeVisible()
  await expect(fake.getByText("Fake Pro")).toBeVisible()
  await settings.screenshot({ path: "test-results/settings-agents.png" })

  await fake.getByRole("button", { name: "Sign out" }).click()
  const asking = page.getByRole("dialog", { name: "Sign out of Fake AI?" })
  await asking.getByRole("button", { name: "Sign out" }).click()
  await expect(fake.getByText("Not signed in.")).toBeVisible()

  // A way that runs in a terminal opens one over the settings, in a
  // dialog (`SectionProps.open`): a code there signs in.
  await fake.getByRole("button", { name: "Sign in with Fake account" }).click()
  const over = page.getByRole("dialog", { name: "Sign in: Fake account" })
  const screen = over.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type("fake-code")
  await page.keyboard.press("Enter")
  await expect(fake.getByText("person@example.invalid")).toBeVisible()
  await expect(over).toBeHidden()
  await fake.getByRole("button", { name: "Sign out" }).click()
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

  // Its name and emblem are its entry's in harnesses.toml (ADR 0093).
  await fake.getByRole("button", { name: "Experiments" }).click()
  await expect.poll(() => textOf(file)).toContain('icon = "experiments"')
  await fake
    .getByRole("group", { name: "Colour" })
    .getByRole("button", { name: "Rose" })
    .click()
  await expect.poll(() => textOf(file)).toContain("colour = 2")
  // The first account on is the default till another is made it.
  await expect(fake.getByRole("button", { name: "Default" })).toBeDisabled()
  await fake.getByRole("textbox", { name: "Account name" }).fill("Fake Work")
  await fake.getByRole("textbox", { name: "Account name" }).press("Enter")
  await expect.poll(() => textOf(file)).toContain('name = "Fake Work"')
  const work = settings.getByRole("group", { name: "Fake Work" })
  await work.getByRole("button", { name: "Accounts", exact: true }).click()
  await expect(work.getByText("Default")).toBeVisible()
  await work.getByRole("button", { name: "Open Fake Work" }).click()
  await work.getByRole("textbox", { name: "Account name" }).fill("Fake AI")
  await work.getByRole("textbox", { name: "Account name" }).press("Enter")
  await expect.poll(() => textOf(file)).toContain('name = "Fake AI"')
  await fake.getByRole("button", { name: "Accounts", exact: true }).click()

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
  await settings.getByRole("button", { name: "Open Other Agent" }).click()
  await expect(
    other.getByRole("textbox", { name: "Other Agent command" })
  ).toHaveValue("other-acp --stdio 'a b'")
  await other.getByRole("button", { name: "Remove" }).click()
  await page
    .getByRole("dialog", { name: "Remove Other Agent?" })
    .getByRole("button", { name: "Remove" })
    .click()
  await expect(other).toHaveCount(0)
  // Removal hides the Account but keeps the source needed by old sessions.
  const removed = readFileSync(file, "utf8")
  expect(removed).toContain('id = "other-agent"')
  expect(removed).toContain("[harness.retired]")
  expect(removed).toContain('to = "fake"')

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

test("General, how the sidebar groups and a card's lines, and hearing a sound", async () => {
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
  // These settings say how they come and go.
  await expect(
    settings.getByText(
      /^Comes in over the tiles, from the Banda menu or with .+; Esc, a click on the tiles or its × takes it away\.$/
    )
  ).toBeVisible()
  // The fence, off in the tests: why, what Full access means then, and
  // where each Harness's new Threads' mode is (ADR 0083).
  const fence = settings.locator('[data-key="fence"]')
  await expect(fence).toContainText(
    "Off. It is off until it is designed whole (BANDA_FENCE=on turns it on). New Threads start Supervised, unless you set another mode for them."
  )
  await expect(fence).toContainText(
    "In Full access, an Agent is you, in Banda too."
  )
  await fence.getByRole("button", { name: "New Threads' mode" }).click()
  await expect(settings.getByRole("group", { name: "Fake AI" })).toBeVisible()

  await sections.getByRole("button", { name: /Sidebar/ }).click()
  // No preset row: Group by is one key, None or Project (ADR 0098,
  // decision 7, as amended).
  await expect(settings.locator('[data-key="preset"]')).toHaveCount(0)
  const group = settings.locator('[data-key="group"]')
  await expect(group.getByRole("radio", { name: "none" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await expect(group.getByRole("radio")).toHaveCount(2)
  await group.getByRole("radio", { name: "project" }).click()
  await expect
    .poll(() => textOf(join(dir, "config/sidebar.toml")))
    .toContain('group = "project"')
  // Each key says what it does.
  await expect(group).toContainText("How the list is grouped")
  // A card's lines: 3, 2 or 1, 3 by default (decision 9, as amended
  // again).
  const card = settings.locator('[data-key="card"]')
  await expect(card.getByRole("radio")).toHaveText(["3", "2", "1"])
  await expect(card.getByRole("radio", { name: "3" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await card.getByRole("radio", { name: "1" }).click()
  await expect
    .poll(() => textOf(join(dir, "config/sidebar.toml")))
    .toMatch(/^card = 1$/m)

  await sections.getByRole("button", { name: /Sounds/ }).click()
  await settings.getByRole("button", { name: "Play done" }).click()
  await expect(settings.locator('[data-key="notify.done"]')).toContainText(
    "finished"
  )
  await expect(
    settings.locator('[data-key="notify.done"]').getByRole("switch")
  ).toHaveAttribute("aria-checked", "true")
})

test("Settings files lists every settings file and whether it reads, apart from the Files App's section (ADR 0016)", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const settings = await openSettings(page)
  const sections = settings.getByRole("navigation", {
    name: "Settings sections",
  })
  await sections
    .getByRole("button", { name: "Settings files", exact: true })
    .click()
  await expect(
    settings.getByRole("heading", { name: "Settings files" })
  ).toBeVisible()
  // look.toml's row: the innermost block with its name and an Open.
  const look = settings
    .getByRole("main")
    .locator("div")
    .filter({ has: page.getByText("look.toml", { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Open", exact: true }) })
    .last()
  await expect(look.getByRole("button", { name: "Open" })).toBeVisible()
  await page.screenshot({ path: "test-results/settings-files.png" })

  // A file that does not read says its first problem in its row.
  writeFileSync(join(dir, "config/look.toml"), 'radius = "round"\n')
  await expect(look).toContainText("look.toml:1")

  // The Files App's section keeps its own name and file.
  await sections.getByRole("button", { name: /^Files/ }).click()
  await expect(
    settings.getByRole("heading", { name: "Files", exact: true })
  ).toBeVisible()
  await expect(
    sections.getByRole("button", { name: /^Files/ })
  ).toHaveAttribute("aria-current", "page")
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
  // Alt+Q is nothing again, and Alt+W closes the Pane. Esc takes the
  // Sheet away, and the focus goes back where it was (ADR 0102, decision
  // 5).
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await composer.click()
  await page.keyboard.press("Control+Alt+Shift+KeyK")
  await expect(settings).toHaveAttribute("data-focused", "true")
  // A press on the tiles takes it away too.
  await composer.dispatchEvent("pointerdown")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyQ")
  await expect(composer).toBeVisible()
  await page.keyboard.press("Alt+KeyW")
  await expect(composer).toBeHidden()
  await page.keyboard.press("Control+Alt+Shift+KeyK")

  // ↶ takes a line out.
  await settings
    .locator('[data-key="Alt+W"]')
    .getByRole("button", { name: "Reset Alt+W" })
    .click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toBe('[binds]\n# mine\n"Alt+Q" = "pane.close"\n')
})

test("the Sheet is the one top layer: it has the keys while it shows, Esc and Alt+W take it, and going to a Pane or the overview puts it away (ADR 0102, decision 5)", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const settings = settingsIn(page)
  const search = settings.getByRole("textbox", { name: "Search settings" })
  const tile = page.locator("section[data-tile][data-focused=true]")

  // Esc in the search clears it first, and the next takes the Sheet
  // away; the keys go back to the composer they came from. The settings
  // load with their first opening: once they show, / goes to the search.
  await openSettings(page)
  await expect(settings).toBeFocused()
  await expect(search).toBeVisible()
  await page.keyboard.press("/")
  await expect(search).toBeFocused()
  await page.keyboard.type("radius")
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")
  await expect(settings).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()

  // A search result pressed goes as the row comes, and the keys stay in
  // the Sheet: Alt+W takes it away, not the Thread behind it.
  await openSettings(page)
  await expect(settings).toBeFocused()
  await page.keyboard.press("/")
  await page.keyboard.type("radius")
  await settings.getByRole("button", { name: /look\.toml · radius$/ }).click()
  await expect(settings.locator('[data-key="radius"]')).toBeVisible()
  await expect(settings).toBeFocused()
  await page.keyboard.press("Alt+KeyW")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()

  // The sidebar's gear goes to it where it is, and brings the keys back
  // in; opened from the gear, a button pressed on the way, Esc gives them
  // back to the Thread's composer, where they were (ADR 0110, step 3).
  const gear = page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: "Settings" })
  await openSettings(page)
  await gear.click()
  await expect(settings).toBeFocused()
  await page.keyboard.press("/")
  await expect(search).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await gear.click()
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()
  await page.keyboard.type("hi")
  await expect(composer).toHaveText("hi")

  // From the Banda menu too.
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await page.keyboard.press("Alt+KeyK")
  await menu.getByRole("combobox", { name: "Search" }).fill("Open the settings")
  await menu.getByRole("option", { name: /^Open the settings/ }).click()
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(composer).toBeFocused()

  // The overview takes the keys, and the Sheet goes. Opened over the
  // overview, the Sheet gives them back to it as it goes.
  await openSettings(page)
  await page.keyboard.press("Alt+KeyO")
  const overview = page.getByRole("dialog", { name: "Overview" })
  await expect(overview).toBeFocused()
  await expect(settings).toHaveCount(0)
  await openSettings(page)
  await expect(settings).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
  await expect(overview).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-overview-state]")).toHaveCount(0)

  // So does a new Thread, which types what comes next.
  await openSettings(page)
  await page.keyboard.press("Alt+Enter")
  await expect(settings).toHaveCount(0)
  const fresh = tile.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(fresh).toBeFocused()
  await expect(fresh).toHaveText("")
  await page.keyboard.type("typed")
  await expect(fresh).toHaveText("typed")

  // A pick in the sidebar puts it away too, even of the Thread in front.
  await page.keyboard.press("Enter")
  const row = page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("option", { name: /^typed,/ })
  await expect(row).toBeVisible()
  await openSettings(page)
  await row.click()
  await expect(settings).toHaveCount(0)
  // And in the Banda menu.
  await openSettings(page)
  await bandaMenu(page)
  const find = menu.getByRole("combobox", { name: "Search" })
  await find.fill("typed")
  await expect(menu.getByRole("option").first()).toContainText("typed")
  await find.press("Enter")
  await expect(menu).toBeHidden()
  await expect(settings).toHaveCount(0)

  // So does the drawer as it drops, which has the keys then.
  await openSettings(page)
  await page.keyboard.press("Alt+Backquote")
  const drawer = page.getByRole("dialog", { name: "Drawer" })
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(settings).toHaveCount(0)
  await expect(
    drawer.getByRole("textbox", { name: "Message to Fake AI" })
  ).toBeFocused()
  // Opened over the dropped drawer, from the Banda menu, it stands over
  // it, and a press in it is its own.
  await page.keyboard.press("Alt+KeyK")
  await menu.getByRole("combobox", { name: "Search" }).fill("Open the settings")
  await menu.getByRole("option", { name: /^Open the settings/ }).click()
  await expect(settings).toBeFocused()
  await search.click()
  await expect(search).toBeFocused()
  await expect(settings).toBeVisible()
})

test("Usage never becomes a tile: the launcher and an empty workspace leave it out (ADR 0102, decision 5)", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect(
    launcher.getByRole("button", { name: /New Thread/ })
  ).toBeVisible()
  await expect(launcher.getByRole("button", { name: /Usage/ })).toHaveCount(0)
  await page.keyboard.press("Alt+KeyW")
  await expect(launcher).toHaveCount(0)

  await page.getByRole("button", { name: "New workspace" }).click()
  const empty = page.getByRole("main")
  await expect(
    empty.getByRole("button", { name: "New Thread", exact: true })
  ).toBeVisible()
  await expect(empty.getByRole("button", { name: /Usage/ })).toHaveCount(0)
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
  window = await startWindow({ files: FREE })
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
  await page.keyboard.press("Escape")
  await screen.click()
  await page.screenshot({ path: "test-results/terminal-toml.png" })
})

test("Settings → Tiling shows the Flow, the widths and the rules and writes tiling.toml, and the widths look.toml still says hold (ADR 0127, decision 4)", async () => {
  window = await startWindow({
    files: {
      "config/tiling.toml":
        'flow = "free"\n\n[columns]\nheights = ["1/2"]\n\n' +
        '[rule.git.diff]\nwidth = "1/3"\nopens = "below"\n\n' +
        '[rule.terminal.terminal]\nwidth = "2/5"\n',
    },
    // The widths were look.toml's: it still says two of them.
    look: '[columns]\nalone = "1/2"\ndefault = "1/3"\nmin = 10\n',
  })
  const { page, dir } = window
  const tiling = join(dir, "config/tiling.toml")
  const look = join(dir, "config/look.toml")
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  // The column alone is half the screen, as look.toml still says.
  await expect.poll(() => sharesOf(thread)).toEqual([50])

  const settings = await openSettings(page)
  const sections = settings.getByRole("navigation", {
    name: "Settings sections",
  })
  await sections.getByRole("button", { name: /Tiling/ }).click()
  await expect(settings.getByRole("heading", { name: "Tiling" })).toBeVisible()
  // The Tiling is the Person's everywhere: its file says so under its
  // rows, once, though the section names it twice (#1736, point 4).
  const whose = settings.locator('[data-whose="tiling.toml"]')
  await expect(whose).toHaveCount(1)
  await expect(whose).toContainText("config/tiling.toml")
  await expect(whose).toContainText("on every device")

  // The Flow, as the file says it.
  const flow = settings.getByRole("radiogroup", { name: "Flow" })
  await expect(flow.getByRole("radio", { name: "free" })).toBeChecked()
  // The widths, each from where it is said: look.toml's line still. A
  // width is a menu of the Steps.
  const width = settings.locator('[data-key="columns.default"]')
  const menu = width.getByRole("combobox", { name: "New column" })
  await expect(menu).toContainText("1/3")
  await expect(width).toContainText("look.toml:3")
  // The Steps and the Heights are chips; the last one is not taken out.
  const steps = settings.getByRole("list", { name: "Steps" })
  await expect(steps.getByRole("listitem")).toHaveText([
    "1/3",
    "1/2",
    "2/3",
    "1",
    "",
  ])
  const heights = settings.getByRole("list", { name: "Heights" })
  await expect(heights.getByRole("listitem")).toHaveText(["1/2", ""])
  await expect(heights.getByRole("button", { name: /^Remove/ })).toHaveCount(0)
  await expect(
    settings
      .locator('[data-key="columns.display"]')
      .getByRole("radio", { name: "stack" })
  ).toBeChecked()
  // The rules the file has now, a row each: the kind as it names itself,
  // then what the rule says. The file opens from their row alone.
  const diff = settings.locator('[data-key="rule.git.diff"]')
  await expect(diff).toContainText("Diff")
  await expect(diff).toContainText("a third wide, below")
  await expect(
    settings.locator('[data-key="rule.terminal.terminal"]')
  ).toContainText("2/5 wide")
  await expect(
    settings
      .locator('[data-key="rule"]')
      .getByRole("button", { name: "Open file" })
  ).toBeVisible()
  await expect(settings.getByRole("button", { name: "Open file" })).toHaveCount(
    1
  )
  await page.screenshot({ path: "test-results/settings-tiling.png" })

  // A step picked from the menu is written in the Tiling's file, and the
  // old line goes; what is the screen's stays in look.toml.
  const written = () => readFileSync(tiling, "utf8")
  await menu.click()
  await page.getByRole("option", { name: "2/3" }).click()
  await expect.poll(written).toContain('default = "2/3"\n')
  expect(readFileSync(look, "utf8")).toBe(
    '[columns]\nalone = "1/2"\nmin = 10\n'
  )
  await expect(width).toContainText(/tiling\.toml:\d+/)
  // Another share is written through Other…, which is a field in the
  // menu's place; no step, it is shown, first in the menu.
  const field = width.getByRole("textbox", { name: "New column" })
  await menu.click()
  await page.getByRole("option", { name: "Other…" }).click()
  await expect(field).toBeFocused()
  await field.fill("2/5")
  await field.press("Enter")
  await expect.poll(written).toContain('default = "2/5"\n')
  await expect(menu).toContainText("2/5")
  await expect(menu).toBeFocused()
  await menu.click()
  await expect(page.getByRole("option").first()).toHaveText("2/5")
  await page.getByRole("option").first().click()
  // What is no share is refused in the file's check's words, at the row,
  // and nothing is written; Esc leaves it as it was, and the Sheet stays.
  await menu.click()
  await page.getByRole("option", { name: "Other…" }).click()
  await field.fill("wide")
  await field.press("Enter")
  await expect(width.getByRole("alert")).toContainText(
    '"wide" is no width: a share of the screen'
  )
  await expect(field).toHaveAttribute("aria-invalid", "true")
  await field.press("Escape")
  await expect(width.getByRole("alert")).toHaveCount(0)
  await expect(menu).toContainText("2/5")
  expect(written()).toContain('default = "2/5"\n')

  // A chip is added where its size puts it; a share already there, not
  // twice; and Backspace on a chip takes it out.
  const add = steps.getByRole("button", { name: "Add to Steps" })
  const adding = steps.getByRole("textbox", { name: "Add to Steps" })
  await add.click()
  await adding.fill("1/4")
  await adding.press("Enter")
  await expect
    .poll(written)
    .toContain('presets = ["1/4", "1/3", "1/2", "2/3", "1"]')
  await expect(add).toBeFocused()
  await add.click()
  await adding.fill("2/4")
  await adding.press("Enter")
  await expect(add).toBeFocused()
  await steps.getByRole("button", { name: "Remove 2/3" }).focus()
  await page.keyboard.press("Backspace")
  await expect.poll(written).toContain('presets = ["1/4", "1/3", "1/2", "1"]')
  await expect(steps.getByRole("listitem")).toHaveText([
    "1/4",
    "1/3",
    "1/2",
    "1",
    "",
  ])
  await add.click()
  await adding.fill("wide")
  await adding.press("Enter")
  await expect(
    settings.locator('[data-key="columns.presets"]').getByRole("alert")
  ).toContainText('"wide" is no width')
  await adding.press("Escape")
  expect(written()).toContain('presets = ["1/4", "1/3", "1/2", "1"]')

  // What is the screen's stays in Appearance; the Flow left Agents.
  await sections.getByRole("button", { name: /Appearance/ }).click()
  await expect(settings.locator('[data-key="columns.min"]')).toContainText(
    "look.toml:3"
  )
  await expect(settings.locator('[data-key="columns.center"]')).toBeVisible()
  await expect(settings.locator('[data-key="columns.snap"]')).toBeVisible()
  await expect(settings.locator('[data-key="columns.default"]')).toHaveCount(0)
  await sections.getByRole("button", { name: /Agents/ }).click()
  await expect(settings.getByRole("heading", { name: "Agents" })).toBeVisible()
  await expect(settings.locator('[data-key="flow"]')).toHaveCount(0)

  // The search finds the Flow in the Tiling's section.
  await page.keyboard.press("/")
  await page.keyboard.type("flow")
  await settings.getByRole("button", { name: /tiling\.toml · flow$/ }).click()
  await expect(settings.getByRole("heading", { name: "Tiling" })).toBeVisible()
  await settings.getByRole("button", { name: "Close Settings" }).click()

  // The width chosen in Settings is the next column's: the Thread's is
  // no longer alone, and both take the new width, two fifths.
  await page.keyboard.press("Alt+Enter")
  await expect.poll(() => sharesOf(thread)).toEqual([40, 40])
  // The old names are still written to, and land in the Tiling's file.
  window.banda("settings", "set", "look.toml", "columns.alone", '"1/3"')
  expect(readFileSync(tiling, "utf8")).toContain('alone = "1/3"')
  expect(readFileSync(look, "utf8")).toBe("[columns]\nmin = 10\n")
})
