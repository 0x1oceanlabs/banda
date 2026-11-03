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
  await expect(downloading).toHaveAccessibleName(
    "Downloading Banda Dev 0.1.0-dev.66 · 10%"
  )
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.66",
    share: 0.38,
    notes: [],
    restarts: false,
  })
  await expect(downloading).toHaveAccessibleName(
    "Downloading Banda Dev 0.1.0-dev.66 · 38%"
  )

  // Ready, while a Thread works: the popover says what changed and that
  // a restart stops the turn.
  await composer.fill("slow please")
  await composer.press("Enter")
  await tell({
    ...known,
    state: "ready",
    version: "0.1.0-dev.66",
    notes: [
      { version: "0.1.0-dev.66", text: "Built from 6c3d557: the hook" },
      { version: "0.1.0-dev.65", text: "Built from 1ceb27c: the README" },
    ],
  })
  await page
    .getByRole("button", {
      name: "Banda Dev 0.1.0-dev.66 is ready: it installs when you quit Banda Dev",
    })
    .click()
  const popover = page.locator("[data-slot=popover-content]")
  await expect(popover).toContainText("You have 0.1.0-dev.62")
  await expect(popover).toContainText("dev.65Built from 1ceb27c: the README")
  await expect(popover).toContainText(
    "A Thread works: a restart stops its turn."
  )
  await page.screenshot({ path: "test-results/8-update-ready.png" })
  await popover.getByRole("button", { name: "Later" }).click()
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

test("Banda Dev's widget stays on the bar and updates now (ADR 0045)", async () => {
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
    for (const name of ["now", "later"]) {
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
  await expect(popover).toContainText(
    "You have the newest Banda Dev · looked 4m ago"
  )
  await popover.getByRole("button", { name: "Update now" }).click()
  await expect.poll(asked).toEqual(["now"])

  // The popover stays open, and follows the look and the download.
  await tell({ ...known, state: "looking" })
  await expect(popover).toContainText("Looking for a new Banda Dev…")
  await expect(
    popover.getByRole("button", { name: "Update now" })
  ).toBeDisabled()
  await tell({
    ...known,
    state: "downloading",
    version: "0.1.0-dev.104",
    share: 0.38,
    notes: [
      { version: "0.1.0-dev.104", text: "Built from 1ceb27c: the README" },
    ],
    restarts: true,
  })
  await expect(popover).toContainText(
    "Downloading · 38% · restarts when it is down"
  )
  await expect(popover).toContainText("dev.104Built from 1ceb27c: the README")
  await page.screenshot({ path: "test-results/8-update-now.png" })
  await popover.getByRole("button", { name: "Don't restart" }).click()
  await expect.poll(asked).toEqual(["now", "later"])

  await tell({
    ...known,
    state: "none",
    missed: "net::ERR_INTERNET_DISCONNECTED",
  })
  await expect(popover).toContainText(
    "Could not update: net::ERR_INTERNET_DISCONNECTED"
  )
})
