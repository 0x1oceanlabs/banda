import { expect, test } from "@playwright/test"
import { firstThread, startWindow } from "./window"

test("a command permission shows its input without a preceding call and survives reload", async () => {
  const window = await startWindow()
  try {
    const { page } = window
    const { thread, composer } = await firstThread(page)
    await composer.fill("command-permission")
    await composer.press("Enter")
    const question = page.getByRole("group", {
      name: "Run command",
      exact: true,
    })
    const command = "brew install --cask karabiner-elements"
    await expect(question.locator("pre")).toHaveText(command)
    await page.reload()
    await expect(question.locator("pre")).toHaveText(command)
    await page.setViewportSize({ width: 728, height: 900 })
    await page.screenshot({ path: "test-results/question-command.png" })
    await question
      .getByRole("button", {
        name: "No, and tell Codex what to do differently",
      })
      .click()
    await expect(
      thread.getByText("You declined the fixture command.")
    ).toBeVisible()
    await composer.fill("command-permission")
    await composer.press("Enter")
    await expect(question.locator("pre")).toHaveText(command)
    await question.getByRole("button", { name: "Yes, proceed" }).click()
    await expect(
      thread.getByText("You allowed the fixture command.")
    ).toBeVisible()
  } finally {
    await window.close()
  }
})
