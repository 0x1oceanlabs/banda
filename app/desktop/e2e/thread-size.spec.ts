import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("Ctrl with + − 0 sizes a Thread's words, not its controls", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const badge = page.getByRole("status", { name: "Zoom" })
  // Before the Thread is made: it keeps the size once it is.
  await composer.press("Control+Equal")
  await expect(badge).toHaveText("110%")
  await composer.fill("A reply with `code` in it.")
  await composer.press("Enter")
  const reply = thread.locator("[data-quotable]")
  await expect(reply).toContainText("A reply with")
  // The zoom it is drawn at, its own and its parents'.
  const zoomOf = (element: typeof reply) =>
    element.evaluate((one) => (one as HTMLElement).currentCSSZoom)
  expect(await zoomOf(reply)).toBeCloseTo(1.1)
  expect(
    await zoomOf(thread.locator("[data-slot=bubble-content]"))
  ).toBeCloseTo(1.1)
  expect(await zoomOf(composer)).toBe(1)
  await page.screenshot({ path: "test-results/thread-size.png" })
  // It goes after a moment.
  await expect(badge).toBeHidden()

  await composer.press("Control+Minus")
  await composer.press("Control+Minus")
  await expect(badge).toHaveText("90%")
  expect(await zoomOf(reply)).toBeCloseTo(0.9)
  await composer.press("Control+Digit0")
  await expect(badge).toHaveText("100%")
  expect(await zoomOf(reply)).toBe(1)
})
