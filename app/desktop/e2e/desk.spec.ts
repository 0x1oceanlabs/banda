import { expect, test } from "@playwright/test"
import { startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a Person makes a Space and an Agent, and works with it", async () => {
  window = await startWindow()
  const { page } = window

  await expect(page.getByText("Create your first Space")).toBeVisible()
  await page.screenshot({ path: "test-results/0-welcome.png" })
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()

  const agents = page.getByRole("region", { name: "Agents" })
  await expect(agents.getByText("No Agents yet")).toBeVisible()
  await page.screenshot({ path: "test-results/1-first-space.png" })
  await agents.getByRole("button", { name: "New Agent" }).click()
  const dialog = page.getByRole("dialog", { name: "New Agent" })
  await dialog.getByLabel("Name").fill("Writer")
  await expect(dialog.getByRole("combobox", { name: "Harness" })).toHaveText(
    /Fake AI/
  )
  await dialog.getByRole("button", { name: "Create Agent" }).click()

  const thread = page.getByRole("region", { name: "Writer" })
  const composer = thread.getByRole("textbox", { name: "Message to Writer" })
  await expect(composer).toBeFocused()
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(agents.getByRole("button", { name: /hello/ })).toBeVisible()

  await composer.fill("please ask first")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "Run a check" })
  await expect(question).toBeVisible()
  await page.screenshot({ path: "test-results/2-question.png" })
  await question.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(thread.getByText("The check passed.")).toBeVisible()
  await expect(question.getByText("You chose: Allow")).toBeVisible()
  await page.screenshot({ path: "test-results/3-answered.png" })

  await thread.getByRole("button", { name: "Close Writer" }).click()
  await expect(thread).toBeHidden()
  await agents.getByRole("button", { name: /hello/ }).click()
  await expect(
    page.getByRole("region", { name: "Writer" }).getByText("The check passed.")
  ).toBeVisible()
})

test("the desk splits, moves the focus by keys, and comes back as it was", async () => {
  window = await startWindow()
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  const agents = page.getByRole("region", { name: "Agents" })
  await expect(agents.getByText("No Agents yet")).toBeVisible()

  await page.keyboard.press("Control+Backslash")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toBeVisible()
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(agents).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+ArrowRight")
  await expect(launcher).toHaveAttribute("data-focused", "true")

  await page.reload()
  await expect(page.getByRole("region", { name: "New Pane" })).toBeVisible()
  await page.keyboard.press("Control+w")
  await expect(page.getByRole("region", { name: "New Pane" })).toBeHidden()
  await expect(page.getByRole("region", { name: "Agents" })).toBeVisible()
})

test("each split adds a tile, even beside a New Pane", async () => {
  window = await startWindow()
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  await expect(page.getByRole("region", { name: "Agents" })).toBeVisible()

  await page.keyboard.press("Control+Backslash")
  await page.keyboard.press("Control+Shift+Backslash")
  await expect(page.getByRole("region", { name: "New Pane" })).toHaveCount(2)
})

test("the engine dies mid-work, comes back, and the Thread goes on", async () => {
  window = await startWindow()
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  await page.getByRole("button", { name: "New Agent" }).click()
  const dialog = page.getByRole("dialog", { name: "New Agent" })
  await dialog.getByLabel("Name").fill("Writer")
  await dialog.getByRole("button", { name: "Create Agent" }).click()
  const thread = page.getByRole("region", { name: "Writer" })
  const composer = thread.getByRole("textbox", { name: "Message to Writer" })
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()

  await composer.fill("half a thought")
  const first = window.engine()!
  process.kill(first, "SIGKILL")
  await expect.poll(() => window.engine() ?? first).not.toBe(first)

  await expect(composer).toHaveValue("half a thought")
  await composer.fill("after the break")
  await composer.press("Enter")
  await expect(thread.getByText("You said: after the break")).toBeVisible()
  await expect(thread.getByText("You said: hello")).toBeVisible()
})
