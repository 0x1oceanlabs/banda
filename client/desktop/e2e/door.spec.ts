import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a browser at this machine's door shows a code; allowed by it, the page is the window, and removed, it asks again (ADR 0124, decision 6; SE5)", async () => {
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
  // It asks under the name its field says; another name is another
  // asking, with a code of its own.
  const name = card.getByLabel("This browser")
  await expect(name).toHaveValue(/ on /)
  await name.fill("The test's browser")
  await name.press("Enter")
  await expect(card.getByLabel("Code")).not.toHaveText(code!)
  await expect(card.getByLabel("Code")).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  const asked = (await card.getByLabel("Code").textContent())!

  // The Person allows it on this machine: the page is the window, on
  // the same workspaces.
  window.banda("devices", "allow", asked)
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

  // Removed on the machine, the page drops at once and asks again.
  window.banda("devices", "remove", paired!.id)
  await expect(card).toHaveAttribute("data-pairing", "asked", {
    timeout: 30_000,
  })
  await expect(card.getByLabel("This browser")).toBeVisible()
})
