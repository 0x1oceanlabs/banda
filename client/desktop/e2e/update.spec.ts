import type { AppUpdate } from "@banda/contract/updates"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Says what this machine's app does with its update, as main says it to
 * its engine (`updates.app`, ADR 0137): a checkout's Banda Local has no
 * update of its own, and says nothing. The page reads it where it reads
 * everything of a machine's update, on `updates.state`. */
const tell = (window: Window, app: AppUpdate) => {
  window.banda("call", "updates.app", "--params", JSON.stringify(app))
}

test("Banda's update shows on the bar as it downloads, is ready, or cannot install", async () => {
  window = await startWindow()
  const { page } = window
  const known = { name: "Banda Dev", running: "0.1.0-dev.62" }
  const coming = {
    ...known,
    phase: "downloading" as const,
    version: "0.1.0-dev.66",
  }
  const { composer } = await firstThread(page)
  const downloading = page.getByRole("button", { name: /^Downloading/ })

  // A download that is over in two seconds never shows.
  tell(window, { ...coming, share: 0.1 })
  await page.waitForTimeout(1000)
  await expect(downloading).toBeHidden()
  await expect(downloading).toHaveAccessibleName("Downloading dev.66 · 10%")
  tell(window, { ...coming, share: 0.38 })
  await expect(downloading).toHaveAccessibleName("Downloading dev.66 · 38%")
  tell(window, { ...coming, share: 0.38, down: 11_800_000, size: 31_000_000 })
  // Its machine's row says how far (ADR 0131): no row of its own.
  await downloading.click()
  const popover = page.locator("[data-slot=popover-content]")
  const here = popover.locator('[data-machine="here"]')
  await expect(here).toContainText("12 of 31 MB")
  await expect(popover.locator('[data-machine="window"]')).toHaveCount(0)
  await page.keyboard.press("Escape")

  // Ready, while a Thread works: the bar has its icon alone, and its
  // machine's row one Update. No notes (ADR 0131).
  await composer.fill("slow please")
  await composer.press("Enter")
  tell(window, { ...known, phase: "ready", version: "0.1.0-dev.66" })
  const ready = page.getByRole("button", { name: "Banda dev.66 is ready" })
  await expect(ready).toHaveText("")
  await ready.click()
  await expect(popover.locator("[data-update-title]")).toHaveText(
    "Banda dev.66 is ready"
  )
  await expect(here.getByRole("button", { name: "Update" })).toBeVisible()
  await page.screenshot({ path: "test-results/8-update-ready.png" })
  await page.keyboard.press("Escape")
  await expect(popover).toBeHidden()

  // Failed: the icon goes red, and the words are the Person's; the
  // program's own stay behind Details.
  tell(window, {
    ...known,
    phase: "failed",
    why: "EACCES: Banda cannot write /opt",
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
  tell(window, { ...known, phase: "none" })
  await expect(failed).toBeHidden()
})

test("Banda Dev's widget stays on the bar, and Check now asks the engine (ADR 0045, ADR 0137)", async () => {
  window = await startWindow()
  const { page } = window
  const known = { name: "Banda Dev", running: "0.1.0-dev.101", always: true }
  await firstThread(page)

  // With nothing to say it stands there, quiet.
  tell(window, { ...known, phase: "none" })
  const widget = page.locator("[data-update]")
  await expect(widget).toHaveAccessibleName("Banda is up to date")
  await widget.click()
  const popover = page.locator("[data-slot=popover-content]")
  // Check now is the engine's look: a checkout's takes nothing, and
  // answers at once.
  const check = popover.getByRole("button", { name: "Check now" })
  await check.click()
  await expect(check).toBeEnabled()
  await page.keyboard.press("Escape")

  // The bar follows the download.
  tell(window, {
    ...known,
    phase: "downloading",
    version: "0.1.0-dev.104",
    share: 0.38,
  })
  await expect(
    page.locator('[data-update="downloading"]')
  ).toHaveAccessibleName("Downloading dev.104 · 38%")

  // One that could not says why in words on its machine's row, with Try
  // again; never at the foot, nor on the bar.
  tell(window, {
    ...known,
    phase: "failed",
    why: "net::ERR_INTERNET_DISCONNECTED",
  })
  await widget.click()
  const here = popover.locator('[data-machine="here"]')
  await expect(here).toContainText(
    "Couldn't reach the releases. Check the connection."
  )
  await expect(here.getByRole("button", { name: "Try again" })).toBeVisible()
})

test("on macOS the widget says a version is out, with its brew command (ADR 0033, decision 6)", async () => {
  window = await startWindow()
  const { page, app } = window
  const command = "brew update && brew upgrade --cask banda-dev"
  await firstThread(page)
  tell(window, {
    name: "Banda Dev",
    running: "0.1.0-dev.62",
    always: true,
    phase: "out",
    version: "0.1.0-dev.66",
    command,
  })

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

test("Update is one call: the engine holds it for the Agents its restart would stop, asks the app, and the new window says it updated (ADR 0072, ADR 0137)", async () => {
  window = await startWindow()
  const { page } = window
  const known = { name: "Banda", running: "0.2.0" }
  const ready = { ...known, phase: "ready" as const, version: "0.3.0" }
  /** What this machine's engine says of its updates now. */
  const state = () =>
    JSON.parse(window.banda("update")) as {
      held?: boolean
      wants_app?: number
    }
  const { composer } = await firstThread(page)

  // A Thread works, on an engine that stops with the window, as a
  // checkout's does and Windows': Update asks first, and waiting is the
  // default. The engine holds it: the row says what it waits for, and
  // nothing asks the app.
  await composer.fill("wait please")
  await composer.press("Enter")
  tell(window, ready)
  await page.getByRole("button", { name: "Banda 0.3.0 is ready" }).click()
  const popover = page.locator("[data-slot=popover-content]")
  const here = popover.locator('[data-machine="here"]')
  await here.getByRole("button", { name: "Update" }).click()
  await expect(page.getByRole("dialog")).toContainText("An Agent is working")
  await page.getByRole("button", { name: "Update when they finish" }).click()
  await expect(here).toContainText("After 1 Agent")
  await expect(here.getByRole("button", { name: "Update" })).toBeHidden()
  expect(state()).toMatchObject({ held: true })
  expect(state().wants_app).toBeUndefined()
  await page.screenshot({ path: "test-results/8-update-held.png" })

  // The window loads again: the wait is the engine's, and still there.
  await page.reload()
  await page.getByRole("button", { name: "Banda 0.3.0 is ready" }).click()
  await expect(here).toContainText("After 1 Agent")
  await page.keyboard.press("Escape")

  // The Agent is done: the engine asks the app to restart, by itself.
  await page.getByRole("button", { name: "Stop" }).click()
  await expect.poll(() => state().wants_app ?? 0).toBeGreaterThan(Date.now())
  expect(state().held).toBeFalsy()

  // The app says each step, and its row says it, with no button, while
  // nothing looks.
  tell(window, { ...ready, phase: "installing" })
  await page.getByRole("button", { name: "Updating to 0.3.0" }).click()
  await expect(here).toContainText("Installing")
  await expect(
    popover.getByRole("button", { name: "Check now" })
  ).toBeDisabled()
  // An app that installs is asked no more.
  expect(state().wants_app).toBeUndefined()
  tell(window, { ...ready, phase: "restarting" })
  await expect(here).toContainText("Restarting")
  await expect(popover.locator("[data-update-title]")).toHaveText(
    "Updating to 0.3.0"
  )
  await page.screenshot({ path: "test-results/8-update-restarting.png" })
  await page.keyboard.press("Escape")

  // The new Banda says it updated until the Person closes it.
  tell(window, {
    ...known,
    running: "0.3.0",
    phase: "updated",
    from: "0.2.0",
  })
  const updated = page.getByRole("button", { name: "Updated to 0.3.0" })
  await expect(updated).toHaveText("")
  await updated.click()
  await expect(popover).toContainText("Updated just now.")
  await page.screenshot({ path: "test-results/8-update-updated.png" })
  // Closed, it was seen: this window says no more of it.
  await page.keyboard.press("Escape")
  await expect(updated).toBeHidden()
})
