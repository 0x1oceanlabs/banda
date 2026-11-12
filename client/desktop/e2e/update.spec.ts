import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("Banda's update shows on the bar as it downloads, is ready, or cannot install", async () => {
  window = await startWindow()
  const { page, app } = window
  // Main holds and tells the update as its updater would (ADR 0041); a
  // checkout's Banda Local has none of its own. A bar that mounts again
  // reads what main holds, as one did here once the first Thread opened.
  const tell = (value: object) =>
    app.evaluate(({ BrowserWindow, ipcMain }, value) => {
      ipcMain.removeHandler("update.current")
      ipcMain.handle("update.current", () => value)
      BrowserWindow.getAllWindows()[0]?.webContents.send("update.listen", value)
    }, value)
  const known = { name: "Banda Dev", have: "0.1.0-dev.62", always: false }
  const { composer } = await firstThread(page)
  const downloading = page.getByRole("button", { name: /^Downloading/ })

  // A download that is over in two seconds never shows.
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.66",
    share: 0.1,
    notes: [],
    restarts: false,
  })
  await page.waitForTimeout(1000)
  await expect(downloading).toBeHidden()
  await expect(downloading).toHaveAccessibleName("Downloading dev.66 · 10%")
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.66",
    share: 0.38,
    notes: [],
    restarts: false,
  })
  await expect(downloading).toHaveAccessibleName("Downloading dev.66 · 38%")
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.66",
    share: 0.38,
    notes: [],
    restarts: false,
    down: 11_800_000,
    size: 31_000_000,
  })
  // Until it is down the window has no row of its own (ADR 0115, the
  // chosen mock): the icon's ring says how far.
  await downloading.click()
  const popover = page.locator("[data-slot=popover-content]")
  await expect(popover).toBeVisible()
  await expect(popover.locator('[data-machine="window"]')).toHaveCount(0)
  await page.keyboard.press("Escape")

  // Ready, while a Thread works: the version stands beside the icon, and
  // the popover says where Banda goes, what changed by kind (ADR 0072),
  // and that only the window restarts (ADR 0115, decision 4).
  await composer.fill("slow please")
  await composer.press("Enter")
  await tell({
    ...known,
    state: "ready",
    version: "0.1.0-dev.66",
    notes: [
      {
        version: "0.1.0-dev.66",
        text: "Built from 6c3d557: feat(bar): the hook",
      },
      { version: "0.1.0-dev.65", text: "Built from 1ceb27c: the README" },
    ],
  })
  const ready = page.getByRole("button", {
    name: "dev.66 is ready · click to restart",
  })
  await expect(ready).toHaveText("dev.66")
  await ready.click()
  const windowRow = popover.locator('[data-machine="window"]')
  await expect(windowRow).toContainText(
    "dev.62 → dev.66. Agents keep working: only the window restarts."
  )
  await expect(popover).toContainText("the hook")
  await expect(popover).toContainText("the README")
  await expect(
    windowRow.getByRole("button", { name: "Restart window" })
  ).toBeVisible()
  await expect(
    popover.getByRole("button", { name: "Restart when idle" })
  ).toHaveCount(0)
  await page.screenshot({ path: "test-results/8-update-ready.png" })
  await page.keyboard.press("Escape")
  await expect(popover).toBeHidden()

  await tell({ ...known, state: "failed", reason: "Banda cannot write /opt" })
  await expect(
    page.getByRole("button", {
      name: "Banda Dev cannot update itself: Banda cannot write /opt",
    })
  ).toBeVisible()
  await tell({ ...known, state: "none" })
  await expect(page.getByRole("button", { name: /cannot update/ })).toBeHidden()
})

test("Banda Dev's widget stays on the bar and looks now (ADR 0045)", async () => {
  window = await startWindow()
  const { page, app } = window
  const tell = (value: object) =>
    app.evaluate(({ BrowserWindow, ipcMain }, value) => {
      ipcMain.removeHandler("update.current")
      ipcMain.handle("update.current", () => value)
      BrowserWindow.getAllWindows()[0]?.webContents.send("update.listen", value)
    }, value)
  // Main counts what the page asks of it, in place of its updater.
  await app.evaluate(({ ipcMain }) => {
    const asked: string[] = []
    ;(globalThis as { asked?: string[] }).asked = asked
    for (const name of ["check", "now", "later"]) {
      ipcMain.removeAllListeners(`update.${name}`)
      ipcMain.on(`update.${name}`, () => asked.push(name))
    }
  })
  const asked = () =>
    app.evaluate(() => (globalThis as { asked?: string[] }).asked)
  const known = { name: "Banda Dev", have: "0.1.0-dev.101", always: true }
  await firstThread(page)

  await tell({ ...known, state: "none", looked: Date.now() - 4 * 60_000 })
  const widget = page.getByRole("button", { name: "Banda Dev 0.1.0-dev.101" })
  await widget.click()
  const popover = page.locator("[data-slot=popover-content]")
  // Check now looks for this window's app, and each machine's engine.
  await popover.getByRole("button", { name: "Check now" }).click()
  await expect.poll(asked).toEqual(["check"])

  // The bar follows the look and the download; the window has a row once
  // its app is down.
  await page.keyboard.press("Escape")
  await tell({ ...known, state: "looking" })
  await expect(page.locator('[data-update="looking"]')).toHaveAccessibleName(
    "Looking for a new Banda Dev…"
  )
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.104",
    share: 0.38,
    notes: [],
    restarts: false,
  })
  await expect(
    page.locator('[data-update="downloading"]')
  ).toHaveAccessibleName("Downloading dev.104 · 38%")

  // A look the Person asked for that failed says why, at the foot.
  await tell({
    ...known,
    state: "none",
    missed: "net::ERR_INTERNET_DISCONNECTED",
  })
  await widget.click()
  await expect(popover).toContainText(
    "Could not update: net::ERR_INTERNET_DISCONNECTED"
  )
})

test("on macOS the widget says a version is out, with its brew command (ADR 0033, decision 6)", async () => {
  window = await startWindow()
  const { page, app } = window
  const command = "brew update && brew upgrade --cask banda-dev"
  const out = {
    name: "Banda Dev",
    have: "0.1.0-dev.62",
    always: true,
    state: "out",
    version: "0.1.0-dev.66",
    notes: [{ version: "0.1.0-dev.66", text: "Built from 6c3d557: the hook" }],
    command,
  }
  await firstThread(page)
  await app.evaluate(({ BrowserWindow, ipcMain }, value) => {
    ipcMain.removeHandler("update.current")
    ipcMain.handle("update.current", () => value)
    BrowserWindow.getAllWindows()[0]?.webContents.send("update.listen", value)
  }, out)

  await page
    .getByRole("button", { name: "dev.66 is out · install it with brew" })
    .click()
  const popover = page.locator("[data-slot=popover-content]")
  await expect(popover).toContainText(
    "dev.62 → dev.66. Its app updates with Homebrew:"
  )
  await expect(popover).toContainText("the hook")
  await expect(popover.getByText(command)).toBeVisible()
  // brew installs it: no Restart window.
  await expect(
    popover.getByRole("button", { name: "Restart window" })
  ).toHaveCount(0)
  await popover.getByRole("button", { name: "Copy" }).click()
  await expect(popover.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    command
  )
  await page.screenshot({ path: "test-results/8-update-out.png" })
})

test("Banda's window restarts at once while a Thread works, and the new one says it updated (ADR 0072, ADR 0115)", async () => {
  window = await startWindow()
  const { page, app } = window
  const tell = (value: object) =>
    app.evaluate(({ BrowserWindow, ipcMain }, value) => {
      ipcMain.removeHandler("update.current")
      ipcMain.handle("update.current", () => value)
      BrowserWindow.getAllWindows()[0]?.webContents.send("update.listen", value)
    }, value)
  await app.evaluate(({ ipcMain }) => {
    const asked: string[] = []
    ;(globalThis as { asked?: string[] }).asked = asked
    for (const name of ["later", "restart", "seen"]) {
      ipcMain.removeAllListeners(`update.${name}`)
      ipcMain.on(`update.${name}`, () => asked.push(name))
    }
  })
  const asked = () =>
    app.evaluate(() => (globalThis as { asked?: string[] }).asked)
  const known = { name: "Banda", have: "0.2.0", always: false }
  const ready = {
    ...known,
    state: "ready",
    version: "0.3.0",
    notes: [{ version: "0.3.0", text: "fix(sidebar): a new row comes last" }],
  }
  const { composer } = await firstThread(page)

  // A Thread works: the window restarts all the same, as only the window
  // restarts; nothing waits for the turn.
  await composer.fill("slow please")
  await composer.press("Enter")
  await tell(ready)
  await page
    .getByRole("button", { name: "0.3.0 is ready · click to restart" })
    .click()
  const popover = page.locator("[data-slot=popover-content]")
  await popover.getByRole("button", { name: "Restart window" }).click()
  await expect.poll(asked).toEqual(["restart"])

  // The new Banda says it updated, and what changed, until the Person
  // closes it.
  await tell({
    ...known,
    have: "0.3.0",
    state: "updated",
    from: "0.2.0",
    notes: ready.notes,
  })
  const updated = page.getByRole("button", { name: "Updated to 0.3.0" })
  await expect(updated).toHaveText("0.3.0")
  await updated.click()
  await expect(popover).toContainText("Updated from 0.2.0")
  await expect(popover).toContainText("a new row comes last")
  await page.screenshot({ path: "test-results/8-update-updated.png" })
  // Closed, what changed was seen.
  await page.keyboard.press("Escape")
  await expect.poll(asked).toEqual(["restart", "seen"])
})
