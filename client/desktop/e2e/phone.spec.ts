import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a browser as narrow as a phone has the phone's form: the list is its home, a Thread is the whole screen, and its header leads back (ADR 0124, SE6)", async () => {
  test.setTimeout(120_000)
  window = await startWindow()
  const { app, page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  const { url } = await page.evaluate(() =>
    (
      globalThis as unknown as {
        banda: { engine: () => Promise<{ url: string }> }
      }
    ).banda.engine()
  )
  const door = url.replace(/^ws/, "http").replace(/\/ws$/, "/")
  // The desktop's window, however narrow, keeps the desktop's form.
  await expect(page.locator("html")).not.toHaveAttribute("data-phone")

  // A phone: a browser 390 wide at the door, with no desktop behind it.
  const [tab] = await Promise.all([
    app.waitForEvent("window"),
    app.evaluate(({ BrowserWindow }, door) => {
      const phone = new BrowserWindow({
        show: false,
        width: 390,
        height: 844,
        useContentSize: true,
      })
      void phone.loadURL(door)
    }, door),
  ])
  const card = tab.locator('[data-pairing="asked"]')
  await expect(card).toBeAttached()
  const code = (await card.getByLabel("Code").textContent())!
  window.banda("call", "devices.allow", "--params", JSON.stringify({ code }))

  // Its home is the list, the whole screen wide, with no bar; the way to
  // a new Thread is over it.
  const list = tab.getByRole("complementary", { name: "Sidebar" })
  await expect(list).toBeAttached({ timeout: 30_000 })
  await expect(tab.locator("html")).toHaveAttribute("data-phone", "")
  await expect(tab.locator("[data-bar]")).toBeHidden()
  const wide = await list.evaluate(
    (aside) => aside.getBoundingClientRect().width / innerWidth
  )
  expect(wide).toBeGreaterThan(0.9)

  // A new Thread is the whole screen, the list gone; its header leads
  // back to the list. The window is never shown, so each click is said.
  await tab.locator("[data-phone-new]").dispatchEvent("click")
  await expect(list).toHaveCount(0)
  // Beside the first Thread, which the Window still places: the phone
  // shows the one with the focus.
  const boxes = tab.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(boxes).toHaveCount(2)
  const back = tab.getByRole("button", { name: "Back to the list" })
  await back.last().dispatchEvent("click")
  await expect(list).toBeAttached()
})
