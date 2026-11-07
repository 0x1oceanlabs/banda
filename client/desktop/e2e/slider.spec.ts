import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

for (const accepted of [true, false]) {
  test(`a clicked effort waits for the engine to ${accepted ? "confirm" : "refuse"} it`, async () => {
    window = await startWindow()
    const { page } = window
    let confirm = () => {}
    let calls = 0
    // Hold the actual configure call so the old settings remain visible to
    // the picker while the Person's chosen level is waiting to be saved.
    await page.routeWebSocket(/.*/, (socket) => {
      const engine = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message)) as {
          method?: string
          id: number
        }
        if (frame.method === "agents.configure") {
          confirm = () =>
            accepted
              ? engine.send(message)
              : socket.send(
                  JSON.stringify({
                    type: "result",
                    id: frame.id,
                    error: {
                      code: "invalid",
                      message: "The settings were refused.",
                    },
                  })
                )
          calls++
        } else engine.send(message)
      })
    })
    await page.reload()
    const { thread, composer } = await firstThread(page)
    await composer.fill("which settings")
    await composer.press("Enter")
    const model = thread.getByRole("button", { name: /^Model:/ })
    await expect(model).toHaveAccessibleName("Model: Fast, Medium")
    await model.click()
    const effort = page.getByRole("slider", { name: "Effort" })
    const track = page.locator("[data-base-ui-slider-control]")
    const box = await track.boundingBox()
    if (!box) throw new Error("The effort track is missing")
    await track.click({ position: { x: box.width - 10, y: box.height / 2 } })
    await expect.poll(() => calls).toBe(1)
    await expect(effort).toHaveAttribute("aria-valuetext", "Max")
    confirm()
    await expect(model).toBeEnabled()
    await expect(model).toHaveAccessibleName(
      `Model: Fast, ${accepted ? "Max" : "Medium"}`
    )
    await expect(effort).toHaveAttribute(
      "aria-valuetext",
      accepted ? "Max" : "Medium"
    )
    if (!accepted) {
      await expect(thread.getByText("The settings were refused.")).toBeVisible()
      return
    }

    // Keyboard changes and drags keep their preview through the same wait.
    await effort.press("Home")
    await expect.poll(() => calls).toBe(2)
    await expect(effort).toHaveAttribute("aria-valuetext", "Low")
    confirm()
    await expect(model).toBeEnabled()
    await expect(model).toHaveAccessibleName("Model: Fast, Low")
    await effort.locator("..").hover()
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, {
      steps: 5,
    })
    await page.mouse.up()
    await expect.poll(() => calls).toBe(3)
    await expect(effort).toHaveAttribute("aria-valuetext", "Max")
    confirm()
    await expect(model).toBeEnabled()
    await expect(model).toHaveAccessibleName("Model: Fast, Max")
  })
}
