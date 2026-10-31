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

test("a failed turn says what to do, and Try again sends its message again", async () => {
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

  await composer.fill("sign in please")
  await composer.press("Enter")
  await expect(thread.getByText("needs you to sign in.")).toBeVisible()
  await expect(
    thread.getByText("Sign in from a terminal, then try again.")
  ).toBeVisible()

  await composer.fill("a flaky one")
  await composer.press("Enter")
  await expect(thread.getByText("reported an error.")).toBeVisible()
  const retry = thread.getByRole("button", { name: "Try again" })
  await expect(retry).toHaveCount(1)
  await page.screenshot({ path: "test-results/4-failed.png" })
  await retry.click()
  await expect(thread.getByText("You said: a flaky one")).toBeVisible()
  await expect(retry).toHaveCount(0)
  await page.screenshot({ path: "test-results/5-tried-again.png" })
})

test("a Person chooses the model and the mode under the message box", async () => {
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

  await expect(
    thread.getByRole("button", { name: "Mode: Full access" })
  ).toBeVisible()
  await composer.fill("which settings")
  await composer.press("Enter")
  await expect(
    thread.getByText("Mode bypassPermissions, model fast, brief false")
  ).toBeVisible()

  // The Harness offered its options with its first turn.
  await thread.getByRole("button", { name: "Model: Fast" }).click()
  await page.getByRole("menuitemradio", { name: "Smart" }).click()
  await expect(
    thread.getByRole("button", { name: "Model: Smart" })
  ).toBeVisible()
  await thread.getByRole("button", { name: "Mode: Full access" }).click()
  await expect(
    page.getByRole("menuitemradio", { name: /Supervised/ })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/6-modes.png" })
  await page.getByRole("menuitemradio", { name: /Supervised/ }).click()
  await thread.getByRole("button", { name: "Brief" }).click()
  await expect(thread.getByRole("button", { name: "Brief" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await composer.fill("which settings now")
  await composer.press("Enter")
  await expect(
    thread.getByText("Mode default, model smart, brief true")
  ).toBeVisible()

  await thread.getByRole("button", { name: "Plan" }).click()
  await composer.fill("which settings in a plan")
  await composer.press("Enter")
  await expect(
    thread.getByText("Mode plan, model smart, brief true")
  ).toBeVisible()
  await composer.fill("plan done")
  await composer.press("Enter")
  await expect(thread.getByText("The plan is ready.")).toBeVisible()
  await expect(
    thread.getByRole("button", { name: "Mode: Auto-accept edits" })
  ).toBeVisible()
  await expect(thread.getByRole("button", { name: "Plan" })).toHaveAttribute(
    "aria-pressed",
    "false"
  )
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/7-after-the-plan.png" })
})

test("a Person fills in the form an Agent asks with", async () => {
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

  await composer.fill("choose a colour")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "Which colour?" })
  await question.getByRole("radio", { name: /^Blue/ }).click()
  await expect(question.getByText("Like the sea")).toBeVisible()
  await page.screenshot({ path: "test-results/8-form.png" })
  await question.getByRole("button", { name: "Submit" }).click()
  await expect(thread.getByText("You chose Blue.")).toBeVisible()
  await expect(question.getByText("Colour", { exact: true })).toBeVisible()
  await expect(question.getByRole("button")).toHaveCount(0)

  await composer.fill("choose once more")
  await composer.press("Enter")
  const again = thread.getByRole("group", { name: "Which colour?" }).last()
  await again.getByLabel("Other").fill("Green")
  await again.getByRole("button", { name: "Submit" }).click()
  await expect(thread.getByText("You chose Green.")).toBeVisible()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/9-answered.png" })
})

test("a tool call opens on what it changed and what it printed", async () => {
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

  await composer.fill("edit the notes")
  await composer.press("Enter")
  await expect(thread.getByText("I edited notes.md.")).toBeVisible()
  const edit = thread.getByRole("button", { name: /Edit notes\.md/ })
  await expect(edit).toHaveText(/\+2\s*−1/)
  await edit.click()
  const change = thread.locator("[data-slot=diff]")
  await expect(change).toBeVisible()
  await expect(change.locator("[data-kind=removed]")).toHaveText("-two")
  await expect(change.locator("[data-kind=added]")).toHaveText(["+2", "+four"])

  await composer.fill("run the tests")
  await composer.press("Enter")
  await expect(thread.getByText("The tests passed.")).toBeVisible()
  await thread.getByRole("button", { name: /Run the tests/ }).click()
  const printed = thread.locator("[data-slot=console]")
  await expect(printed).toBeVisible()
  await expect(printed).toContainText("test two ... ok")
  await expect(printed.getByText("Finished.")).toBeInViewport({ ratio: 1 })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/10-tool-calls.png" })
})
