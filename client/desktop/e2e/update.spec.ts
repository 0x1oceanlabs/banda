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
  const downloading = page.getByRole("button", { name: /^Updating/ })

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
  await expect(downloading).toHaveAccessibleName("Updating to dev.66 · 10%")
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.66",
    share: 0.38,
    notes: [],
    restarts: false,
  })
  await expect(downloading).toHaveAccessibleName("Updating to dev.66 · 38%")
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
  // Its machine's row says how far (ADR 0131): no row of its own.
  await downloading.click()
  const popover = page.locator("[data-slot=popover-content]")
  const here = popover.locator('[data-machine="here"]')
  await expect(here).toContainText("12 of 31 MB")
  await expect(popover.locator('[data-machine="window"]')).toHaveCount(0)
  await page.keyboard.press("Escape")

  // Ready, while a Thread works: the bar has its icon alone, and its
  // machine's row one Update, which restarts only the window (ADR 0119,
  // decision 4). No notes (ADR 0131).
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
    ],
  })
  const ready = page.getByRole("button", { name: "Banda dev.66 is ready" })
  await expect(ready).toHaveText("")
  await ready.click()
  await expect(popover.locator("[data-update-title]")).toHaveText(
    "Banda dev.66 is ready"
  )
  await expect(here.getByRole("button", { name: "Update" })).toBeVisible()
  await expect(popover).not.toContainText("the hook")
  await page.screenshot({ path: "test-results/8-update-ready.png" })
  await page.keyboard.press("Escape")
  await expect(popover).toBeHidden()

  // Failed: the icon goes red, and the words are the Person's; the
  // program's own stay behind Details.
  await tell({
    ...known,
    state: "failed",
    reason: "EACCES: Banda cannot write /opt",
  })
  const failed = page.getByRole("button", { name: /^Couldn't update/ })
  await failed.click()
  await expect(here).toContainText(
    "Banda may not write where it keeps its copy."
  )
  await expect(here).not.toContainText("/opt")
  await here.getByRole("button", { name: "Details" }).click()
  await expect(here).toContainText("EACCES: Banda cannot write /opt")
  await page.keyboard.press("Escape")
  await tell({ ...known, state: "none" })
  await expect(failed).toBeHidden()
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
  const widget = page.locator("[data-update]")
  await widget.click()
  const popover = page.locator("[data-slot=popover-content]")
  // Check now looks for this window's app, and each machine's engine.
  await popover.getByRole("button", { name: "Check now" }).click()
  await expect.poll(asked).toEqual(["check"])

  // The bar follows the look and the download.
  await page.keyboard.press("Escape")
  await tell({ ...known, state: "looking" })
  await expect(page.locator('[data-update="looking"]')).toHaveAccessibleName(
    "Checking for updates…"
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
  ).toHaveAccessibleName("Updating to dev.104 · 38%")

  // A look that failed says why in words on its machine's row, with Try
  // again; never at the foot, nor on the bar.
  await tell({
    ...known,
    state: "none",
    missed: "net::ERR_INTERNET_DISCONNECTED",
  })
  await widget.click()
  const here = popover.locator('[data-machine="here"]')
  await expect(here).toContainText(
    "Couldn't reach the releases. Check the connection."
  )
  await here.getByRole("button", { name: "Try again" }).click()
  await expect.poll(asked).toEqual(["check", "check"])
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

  await page.getByRole("button", { name: "Banda dev.66 is ready" }).click()
  const popover = page.locator("[data-slot=popover-content]")
  await expect(popover).toContainText("Run this in a terminal to update:")
  await expect(popover.getByText(command)).toBeVisible()
  // brew installs it: no Update.
  await expect(
    popover.getByRole("button", { name: "Update", exact: true })
  ).toHaveCount(0)
  await popover.getByRole("button", { name: "Copy" }).click()
  await expect(popover.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    command
  )
  await page.screenshot({ path: "test-results/8-update-out.png" })
})

test("Banda's window restarts at once while a Thread works, and the new one says it updated (ADR 0072, ADR 0119)", async () => {
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
  await page.getByRole("button", { name: "Banda 0.3.0 is ready" }).click()
  const popover = page.locator("[data-slot=popover-content]")
  await popover
    .locator('[data-machine="here"]')
    .getByRole("button", { name: "Update" })
    .click()
  await expect.poll(asked).toEqual(["restart"])

  // The new Banda says it updated until the Person closes it.
  await tell({
    ...known,
    have: "0.3.0",
    state: "updated",
    from: "0.2.0",
    notes: ready.notes,
  })
  const updated = page.getByRole("button", { name: "Updated to 0.3.0" })
  await expect(updated).toHaveText("")
  await updated.click()
  await expect(popover).toContainText("Updated just now.")
  await page.screenshot({ path: "test-results/8-update-updated.png" })
  // Closed, what changed was seen.
  await page.keyboard.press("Escape")
  await expect.poll(asked).toEqual(["restart", "seen"])
})
