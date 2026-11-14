import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a browser at this machine's door shows a code; the window asks the Person, and allowed there, the page is the window; removed, it asks again (ADR 0124, decisions 3 and 6; SE5)", async () => {
  test.setTimeout(120_000)
  window = await startWindow()
  const { app, page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  // The door, as the desktop's own page reaches it.
  const { url } = await page.evaluate(() =>
    (
      globalThis as unknown as {
        banda: { engine: () => Promise<{ url: string }> }
      }
    ).banda.engine()
  )
  const door = url.replace(/^ws/, "http").replace(/\/ws$/, "/")

  // A browser: a window with no desktop behind its page, at the door.
  const [tab] = await Promise.all([
    app.waitForEvent("window"),
    app.evaluate(({ BrowserWindow }, door) => {
      const browser = new BrowserWindow({ show: false })
      void browser.loadURL(door)
    }, door),
  ])
  const card = tab.locator("[data-pairing]")
  // The window, by its Thread's message box: there, if not on a screen,
  // as this browser's window is never shown.
  const shown = tab.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(card).toHaveAttribute("data-pairing", "asked")
  // Whose door it is, by the name the machine gives itself.
  await expect(card.getByRole("heading")).not.toHaveText(/^(Banda)?$/)
  const code = await card.getByLabel("Code").textContent()
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  await expect(card).toContainText(
    "Allow this browser in Banda on a computer you already use."
  )
  await expect(card.getByRole("status")).toContainText(
    "Waiting for Allow · the code is good until"
  )
  // The window that is the Person here asks about it: who, the code its
  // screen shows, and the address of the page that asks.
  const question = page.locator("[data-devices-asking]")
  await expect(question).toHaveAttribute("data-devices-asking", code!)
  await expect(question.getByRole("heading")).toHaveText(/ wants to join /)
  await expect(question.getByLabel("Code")).toHaveText(code!)
  await expect(question).toContainText(
    `Browser · asked now · from ${new URL(door).host}`
  )
  // One machine is all this window reaches: nothing to choose between.
  await expect(question.getByRole("radio")).toHaveCount(0)
  // Not allowed, it is told so, and may ask again.
  await question.getByRole("button", { name: "Don't allow" }).click()
  await expect(question).toHaveCount(0)
  await expect(card).toHaveAttribute("data-pairing", "refused")
  // Its window is never shown, so the click is said to the button.
  await card.getByRole("button", { name: "Ask again" }).dispatchEvent("click")
  await expect(card).toHaveAttribute("data-pairing", "asked")
  // It asks under the name its field says; another name is another
  // asking, with a code of its own.
  const name = card.getByLabel("This browser")
  await expect(name).toHaveValue(/ on /)
  const before = await card.getByLabel("Code").textContent()
  await name.fill("The test's browser")
  await name.press("Enter")
  await expect(card.getByLabel("Code")).not.toHaveText(before!)
  await expect(card.getByLabel("Code")).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  const asked = (await card.getByLabel("Code").textContent())!

  // The Person allows it in the window: the page is the window, on the
  // same workspaces.
  await expect(question).toHaveAttribute("data-devices-asking", asked)
  await expect(question.getByRole("heading")).toHaveText(
    /^The test's browser wants to join /
  )
  await question.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(question).toHaveCount(0)
  await expect(page.getByText(/^The test's browser joined /)).toBeVisible()
  await expect(shown).toBeAttached({ timeout: 30_000 })
  await expect(card).toHaveCount(0)
  const listed = () =>
    JSON.parse(window.banda("devices", "list")).ok.devices as {
      id: string
      name: string
      kind: string
      origin?: string
    }[]
  const paired = listed().find((device) => device.kind === "browser")
  expect(paired).toMatchObject({
    name: "The test's browser",
    origin: new URL(door).origin,
  })

  // Opened again, it comes in as that device, with no code.
  await tab.reload()
  await expect(shown).toBeAttached({ timeout: 30_000 })
  expect(listed().filter((device) => device.kind === "browser")).toHaveLength(1)

  // Settings → Devices lists who this machine lets in: its own window,
  // which pairs itself and is not removed, and the browser.
  await page.keyboard.press("Alt+Comma")
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Devices/ })
    .click()
  const row = settings.locator(`[data-device="${paired!.id}"]`)
  await expect(row).toContainText("The test's browser")
  await expect(row).toContainText(`from ${new URL(door).host}`)
  const own = settings.locator("[data-device]", {
    hasText: "this machine's window",
  })
  await expect(own).toHaveCount(1)
  await expect(own.getByRole("button")).toHaveCount(0)
  // Removed there, the page drops at once and asks again.
  await row.getByRole("button", { name: /^Remove / }).click()
  const removal = page.getByRole("dialog", {
    name: "Remove The test's browser?",
  })
  await expect(removal.getByRole("radio")).toHaveCount(0)
  await removal
    .getByRole("button", { name: "Remove The test's browser" })
    .click()
  await expect(row).toHaveCount(0)
  await expect(card).toHaveAttribute("data-pairing", "asked", {
    timeout: 30_000,
  })
  await expect(card.getByLabel("This browser")).toBeVisible()
})
