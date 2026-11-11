import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

for (const accepted of [true, false]) {
  test(`a clicked effort level waits for the engine to ${accepted ? "confirm" : "refuse"} it`, async () => {
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
    // The level chosen stays as it was until the engine answers.
    const effort = page.getByRole("radiogroup", { name: "Effort" })
    await effort.getByRole("radio", { name: "Max" }).click()
    await expect.poll(() => calls).toBe(1)
    await expect(model).toBeDisabled()
    confirm()
    await expect(model).toBeEnabled()
    await expect(model).toHaveAccessibleName(
      `Model: Fast, ${accepted ? "Max" : "Medium"}`
    )
    await expect(effort.getByRole("radio", { checked: true })).toHaveText(
      accepted ? "Max" : "Medium"
    )
    if (!accepted) {
      await expect(thread.getByText("The settings were refused.")).toBeVisible()
      return
    }

    // A level already chosen is no change, and asks nothing.
    await effort.getByRole("radio", { name: "Max" }).click()
    await effort.getByRole("radio", { name: "Low" }).click()
    await expect.poll(() => calls).toBe(2)
    confirm()
    await expect(model).toHaveAccessibleName("Model: Fast, Low")
  })
}
