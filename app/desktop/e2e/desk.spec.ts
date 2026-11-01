import { resolve } from "node:path"
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

test("a Person signs in from the turn that needed it, and it goes again", async () => {
  window = await startWindow({ account: true })
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
  await expect(thread.getByText("needs you to sign in.")).toBeVisible()
  // A way in a terminal shows what to run, with the Harness's own program.
  await expect(thread.getByText(/Fake account .*run this in a/)).toBeVisible()
  await expect(thread.getByText(/bandaso-fake-agent --sign-in$/)).toBeVisible()
  await page.screenshot({ path: "test-results/4-sign-in.png" })

  await thread
    .getByRole("button", { name: "Sign in with Fake browser" })
    .click()
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(thread.getByText("needs you to sign in.")).toBeVisible()
  await expect(
    thread.getByRole("button", { name: "Sign in with Fake browser" })
  ).toHaveCount(0)
})

test("a Person sees who is signed in to a Harness, signs in and out", async () => {
  window = await startWindow({ account: true })
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  await expect(page.getByRole("region", { name: "Agents" })).toBeVisible()
  await page.keyboard.press("Control+Backslash")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Harnesses" })
    .click()
  const settings = page.getByRole("region", { name: "Harnesses" })
  const fake = settings.getByRole("group", { name: "Fake AI" })
  await expect(fake.getByText(/^bandaso-fake-agent \d/)).toBeVisible()
  await expect(fake.getByText("Not signed in.")).toBeVisible()

  await fake.getByRole("button", { name: "Sign in with Fake browser" }).click()
  await expect(
    fake.getByText("Signed in as person@example.invalid · Fake Pro")
  ).toBeVisible()
  await page.screenshot({ path: "test-results/5-harnesses.png" })

  await fake.getByRole("button", { name: "Sign out" }).click()
  const asking = page.getByRole("dialog", { name: "Sign out of Fake AI?" })
  await asking.getByRole("button", { name: "Sign out" }).click()
  await expect(fake.getByText("Not signed in.")).toBeVisible()

  // What Enter does while an Agent works is the window's to choose.
  const choice = page
    .getByRole("radiogroup", { name: /while an Agent works/ })
    .getByRole("radio", { name: "Queue it" })
  await choice.click()
  await page.reload()
  await expect(choice).toBeChecked()
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
  await expect(change.locator("[data-kind=removed]")).toHaveText("−two")
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

test("an Agent's plan shows its steps, and the context how full it is", async () => {
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

  await composer.fill("work in steps")
  await composer.press("Enter")
  await expect(thread.getByText("All three steps are done.")).toBeVisible()
  const plan = thread.getByRole("region", { name: "Plan" })
  await expect(plan.getByText("3 of 3 done")).toBeVisible()
  await expect(plan.getByRole("listitem")).toHaveText([
    /Read the notes/,
    /Fix the typo/,
    /Check the result/,
  ])
  const meter = thread.getByRole("meter", { name: "Context used" })
  await expect(meter).toHaveAttribute("aria-valuetext", /^26% of the context/)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/11-plan.png" })
})

test("a message starts with a slash command its Agent offers", async () => {
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
  const commands = thread.getByRole("listbox", { name: "Slash commands" })

  // Its Harness says its slash commands once its session opens.
  await composer.fill("/")
  await expect(
    thread.getByText("No slash commands from Writer yet.")
  ).toHaveAttribute("role", "status")
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()

  await composer.fill("/re")
  await expect(commands.getByRole("option")).toHaveText([
    /^\/review/,
    /^\/plan/,
  ])
  await expect(composer).toHaveAttribute(
    "aria-activedescendant",
    (await commands.getByRole("option").first().getAttribute("id"))!
  )
  await page.screenshot({ path: "test-results/12-commands.png" })
  await composer.press("Enter")
  await expect(composer).toHaveValue("/review ")
  await expect(commands).toBeHidden()
  await composer.pressSequentially("the notes")
  await composer.press("Enter")
  await expect(thread.getByText("You said: /review the notes")).toBeVisible()

  // The window's own switch plan mode and send nothing.
  await composer.fill("/pl")
  await commands.getByRole("option", { name: /^\/plan/ }).click()
  await expect(composer).toHaveValue("")
  await expect(thread.getByRole("button", { name: "Plan" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(composer).toBeFocused()

  await composer.fill("/default")
  await expect(commands).toBeVisible()
  await composer.press("Escape")
  await expect(commands).toBeHidden()
  await composer.press("Enter")
  await expect(composer).toHaveValue("")
  await expect(thread.getByRole("button", { name: "Plan" })).toHaveAttribute(
    "aria-pressed",
    "false"
  )
  await expect(thread.getByText("You said: /default")).toBeHidden()
})

test("a message carries images to its Agent", async () => {
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
  const shot = resolve(import.meta.dirname, "shot.png")
  const files = thread.locator('input[type="file"]')

  // An image goes to the engine as it is added, and can be taken back.
  await files.setInputFiles(shot)
  const waiting = thread.getByRole("list", { name: "Images to send" })
  await expect(waiting.getByRole("img", { name: "shot.png" })).toBeVisible()
  await waiting.getByRole("button", { name: "Remove shot.png" }).click()
  await expect(waiting).toBeHidden()

  // A file that is not an image of the four kinds stays out.
  await files.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  })
  await expect(thread.getByRole("alert")).toHaveText(/PNG, JPEG, GIF and WebP/)

  await files.setInputFiles(shot)
  await expect(waiting.getByRole("img", { name: "shot.png" })).toBeVisible()
  await composer.fill("look")
  await page.screenshot({ path: "test-results/13-images-to-send.png" })
  await composer.press("Enter")
  await expect(thread.getByText("I see 1 image: image/png.")).toBeVisible()
  await expect(thread.getByText("You said: look")).toBeVisible()
  await expect(waiting).toBeHidden()
  const sent = thread.getByRole("button", { name: "Open shot.png" })
  await expect(sent.getByRole("img", { name: "shot.png" })).toBeVisible()
  await page.screenshot({ path: "test-results/14-images.png" })

  // A press shows the image whole.
  await sent.click()
  const whole = page.getByRole("dialog", { name: "shot.png" })
  await expect(whole.getByRole("img", { name: "shot.png" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(whole).toBeHidden()

  // An image alone is a message too.
  await files.setInputFiles(shot)
  await expect(waiting.getByRole("img", { name: "shot.png" })).toBeVisible()
  await thread.getByRole("button", { name: "Send" }).click()
  await expect(
    thread.getByRole("button", { name: "Open shot.png" })
  ).toHaveCount(2)

  // An image dropped anywhere on the Thread joins the message, and one
  // wider than 2000 pixels goes 2000 wide, as in T3 Code.
  const wide = await page.evaluateHandle(async () => {
    const canvas = new OffscreenCanvas(3000, 1000)
    const context = canvas.getContext("2d")!
    context.fillStyle = "#3b82f6"
    context.fillRect(0, 0, 3000, 1000)
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const dragged = new DataTransfer()
    dragged.items.add(new File([blob], "wide.png", { type: "image/png" }))
    return dragged
  })
  const transcript = thread.getByRole("region", { name: "Thread with Writer" })
  await transcript.dispatchEvent("dragover", { dataTransfer: wide })
  await transcript.dispatchEvent("drop", { dataTransfer: wide })
  await expect(waiting.getByRole("img", { name: "wide.png" })).toBeVisible()
  await waiting.getByRole("button", { name: "Open wide.png" }).click()
  await expect(page.getByRole("dialog", { name: "wide.png" })).toBeVisible()
  await page.keyboard.press("Escape")
  await composer.fill("wide")
  await composer.press("Enter")
  await expect(thread.getByText("You said: wide")).toBeVisible()
  await thread.getByRole("button", { name: "Open wide.png" }).click()
  const shown = page.getByRole("dialog", { name: "wide.png" }).getByRole("img")
  await expect
    .poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(2000)
})

test("a message goes into the turn that runs, or waits its turn in the queue", async () => {
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
  const waits = thread.getByText("Waiting.")

  // While the Agent works, Enter sends a message into its turn.
  await composer.fill("wait here")
  await composer.press("Enter")
  await expect(waits).toHaveCount(1)
  await composer.fill("also this")
  await expect(thread.getByRole("button", { name: "Queue" })).toBeVisible()
  await page.screenshot({ path: "test-results/15-steer.png" })
  await composer.press("Enter")
  await expect(thread.getByText("Steered: also this.")).toBeVisible()

  // Ctrl+Enter, or Queue, has it wait for the turn to end.
  await composer.fill("wait again")
  await composer.press("Enter")
  await expect(waits).toHaveCount(2)
  await composer.fill("second")
  await composer.press("Control+Enter")
  await composer.fill("third")
  await thread.getByRole("button", { name: "Queue" }).click()
  const queue = thread.getByRole("list", { name: "Waiting messages" })
  await expect(queue.getByRole("listitem")).toHaveCount(2)
  await page.screenshot({ path: "test-results/16-queue.png" })

  const second = queue.getByRole("listitem").filter({ hasText: "second" })
  await second.getByRole("button", { name: "Edit" }).click()
  await second
    .getByRole("textbox", { name: "Waiting message" })
    .fill("second, changed")
  await second.getByRole("button", { name: "Save" }).click()
  await expect(second.getByText("second, changed")).toBeVisible()
  await queue
    .getByRole("listitem")
    .filter({ hasText: "third" })
    .getByRole("button", { name: "Remove" })
    .click()
  await expect(queue.getByRole("listitem")).toHaveCount(1)

  // A stop holds the queue until the Person continues.
  await thread.getByRole("button", { name: "Stop" }).click()
  await expect(
    thread.getByText("One message waits until you continue.")
  ).toBeVisible()
  await page.screenshot({ path: "test-results/17-held.png" })
  await thread.getByRole("button", { name: "Continue" }).click()
  await expect(thread.getByText("You said: second, changed")).toBeVisible()
  await expect(queue).toBeHidden()
  await expect(thread.getByText("third")).toBeHidden()

  // Send now puts a waiting message into the turn that runs.
  await composer.fill("wait once more")
  await composer.press("Enter")
  await expect(waits).toHaveCount(3)
  await composer.fill("now this")
  await composer.press("Control+Enter")
  await queue.getByRole("button", { name: "Send now" }).click()
  await expect(thread.getByText("Steered: now this.")).toBeVisible()
  await expect(queue).toBeHidden()
})

test("what the Agent does by itself shows in a turn of its own", async () => {
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

  // The turn ends; the task it started ends later, and the Agent goes on.
  await composer.fill("background long")
  await composer.press("Enter")
  await expect(thread.getByText("Writer went on by itself.")).toBeVisible()
  await expect(thread.getByText("The task finished.")).toBeVisible()
  await expect(thread.getByText("Writer is working…")).toBeVisible()
  await composer.fill("and this")
  // Its own turn takes no message: one goes as a turn of its own.
  await expect(thread.getByRole("button", { name: "Queue" })).toBeHidden()
  await page.screenshot({ path: "test-results/18-by-itself.png" })
  await composer.press("Enter")
  await expect(thread.getByText("You said: and this")).toBeVisible()
  await expect(thread.getByText("Writer is working…")).toBeHidden()
})
