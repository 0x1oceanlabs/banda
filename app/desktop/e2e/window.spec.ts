import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

test("a Person makes a Space, starts a Thread in it, and works with it", async () => {
  window = await startWindow()
  const { page } = window

  await expect(page.getByText("Create your first Space")).toBeVisible()
  await page.screenshot({ path: "test-results/0-welcome.png" })
  const { thread, composer } = await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await expect(composer).toBeFocused()
  await expect(
    thread.getByRole("button", { name: "Harness: Fake AI" })
  ).toBeVisible()
  await expect(
    thread.getByRole("button", { name: "Space: Work" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/1-first-space.png" })
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(page.getByRole("region", { name: "hello" })).toBeVisible()
  // Once started, the Thread's Harness is its own.
  await expect(thread.getByRole("button", { name: /^Harness:/ })).toBeHidden()
  await expect(thread.getByRole("button", { name: /^Space:/ })).toBeHidden()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(sidebar.getByRole("button", { name: /hello/ })).toBeVisible()

  await composer.fill("please ask first")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "Run a check" })
  await expect(question).toBeVisible()
  // The Thread's Mark, and the bar's, say it asks the Person.
  const row = sidebar.getByRole("button", { name: /hello/ })
  await expect(row).toContainText("Asks you")
  const mark = page.getByRole("button", { name: /^Sidebar/ })
  await expect(mark).toHaveAccessibleName(/Asks you/)
  await page.screenshot({ path: "test-results/2-question.png" })
  await question.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(thread.getByText("The check passed.")).toBeVisible()
  await expect(question.getByText("You chose: Allow")).toBeVisible()
  // The Person watched it finish, so nothing calls for them.
  await expect(row).not.toContainText("Asks you")
  await expect(mark).toHaveAccessibleName("Sidebar")
  await page.screenshot({ path: "test-results/3-answered.png" })

  await thread.getByRole("button", { name: "Close hello" }).click()
  await expect(thread).toBeHidden()
  await sidebar.getByRole("button", { name: /hello/ }).click()
  await expect(thread.getByText("The check passed.")).toBeVisible()

  // Alt+Enter opens another new Thread beside the first.
  await page.keyboard.press("Alt+Enter")
  const second = page.getByRole("region", { name: "New Thread" })
  await expect(second).toBeVisible()
  await expect(
    second.getByRole("textbox", { name: "Message to Fake AI" })
  ).toBeFocused()
})

test("a workspace opens Panes side by side, moves the focus by keys, and comes back as it was", async () => {
  window = await startWindow()
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  const draft = page.getByRole("region", { name: "New Thread" })
  await expect(draft).toBeVisible()

  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toBeVisible()
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(draft).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+ArrowRight")
  await expect(launcher).toHaveAttribute("data-focused", "true")

  await page.reload()
  await expect(page.getByRole("region", { name: "New Pane" })).toBeVisible()
  await page.keyboard.press("Alt+KeyW")
  await expect(page.getByRole("region", { name: "New Pane" })).toBeHidden()
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
})

test("a Pane moves to another workspace, and the overview shows them all", async () => {
  window = await startWindow()
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  const draft = page.getByRole("region", { name: "New Thread" })
  await expect(draft).toBeVisible()
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  await expect(numbers.getByRole("button")).toHaveText(["1"])

  // The Pane goes to the workspace below, and the window follows it.
  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+Shift+Digit2")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect(draft).toBeHidden()
  await expect(numbers.getByRole("button")).toHaveText(["1", "2"])
  await expect(numbers.getByRole("button", { name: "2" })).toHaveAttribute(
    "aria-current",
    "true"
  )
  await page.keyboard.press("Alt+PageUp")
  await expect(draft).toBeVisible()
  await expect(launcher).toBeHidden()

  const overview = page.getByRole("dialog", { name: "Overview" })
  await page.keyboard.press("Alt+KeyO")
  await expect(
    overview.getByRole("button", { name: "New Thread in Work" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/3-overview.png" })
  await overview.getByRole("button", { name: "New Pane in Work" }).click()
  await expect(overview).toBeHidden()
  await expect(launcher).toHaveAttribute("data-focused", "true")

  // A click on the current number opens it too; Esc goes back.
  await numbers.getByRole("button", { name: "2" }).click()
  await expect(overview).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(overview).toBeHidden()

  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(sidebar).toBeVisible()
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebar).toBeHidden()
})

test("a sideways swipe moves the Strip and lands on a column; a scroll up and down leaves it be", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  // The launcher takes the whole screen; the Thread is out of view, left.
  await page.keyboard.press("Alt+Control+ArrowRight")
  await page.keyboard.press("Alt+Control+ArrowRight")
  const strip = page.locator("[data-column]").first().locator("xpath=..")
  const scrolled = () => strip.evaluate((element) => element.scrollLeft)
  // It comes to rest at the right end, the launcher whole in view.
  await expect
    .poll(() =>
      strip.evaluate((e) => e.scrollWidth - e.clientWidth - e.scrollLeft)
    )
    .toBeLessThan(1)
  const box = await launcher.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)

  // A scroll up that drifts sideways a little moves nothing sideways.
  const before = await scrolled()
  for (let i = 0; i < 6; i++) await page.mouse.wheel(-4, -40)
  await page.waitForTimeout(300)
  expect(await scrolled()).toBe(before)
  await expect(launcher).toHaveAttribute("data-focused", "true")

  // A swipe to the left brings the Thread into view, and it takes the focus.
  for (let i = 0; i < 10; i++) await page.mouse.wheel(-60, 0)
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect.poll(scrolled).toBe(0)

  // Alt and a long swipe down moves one workspace, however long it is.
  await page.keyboard.press("Alt+Shift+Digit2")
  await page.keyboard.press("Alt+PageUp")
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  await expect(numbers.getByRole("button", { name: "1" })).toHaveAttribute(
    "aria-current",
    "true"
  )
  await page.keyboard.down("Alt")
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 30)
    await page.waitForTimeout(60)
  }
  await page.keyboard.up("Alt")
  await expect(numbers.getByRole("button", { name: "2" })).toHaveAttribute(
    "aria-current",
    "true"
  )
  await expect(numbers.getByRole("button")).toHaveText(["1", "2"])
})

test("the engine dies mid-work, comes back, and the Thread goes on", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
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
  const { thread, composer } = await firstThread(page)

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
  const { thread, composer } = await firstThread(page)

  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("needs you to sign in.")).toBeVisible()
  // A way in a terminal runs in one, or by hand: the Harness's own program.
  await expect(
    thread.getByRole("button", { name: "Sign in with Fake account" })
  ).toBeVisible()
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

test("a Person signs in in a terminal below the turn, and it goes again", async () => {
  window = await startWindow({ account: true })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("needs you to sign in.")).toBeVisible()
  const signIn = thread.getByRole("button", {
    name: "Sign in with Fake account",
  })

  // A wrong code: the program ends with 1, and the turn waits.
  await signIn.click()
  const first = page.getByRole("region", { name: "Sign in: Fake account" })
  const firstScreen = first.getByRole("region", { name: "Terminal screen" })
  await expect(firstScreen).toHaveAttribute("data-state", "running")
  await firstScreen.click()
  await page.keyboard.type("wrong")
  await page.keyboard.press("Enter")
  await expect(first.getByText("The program ended with code 1.")).toBeVisible()
  await expect(thread.getByText("You said: hello")).toHaveCount(0)
  await first
    .getByRole("button", { name: "Close Sign in: Fake account" })
    .click()

  // The right one, after a reload: the terminal Pane signs in, the turn
  // goes again, and the Pane closes.
  await signIn.click()
  const terminal = page.getByRole("region", { name: "Sign in: Fake account" })
  const screen = terminal.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await page.screenshot({ path: "test-results/6-sign-in-terminal.png" })
  await page.reload()
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type("fake-code")
  await page.keyboard.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(terminal).toBeHidden()
})

test("a Person works in a terminal in the Space, and closing it stops the shell", async () => {
  window = await startWindow()
  const { page, dir } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()

  const terminal = page.getByRole("region", { name: "Terminal", exact: true })
  const screen = terminal.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type("echo $$ > shell.pid; printf 'é 😀' > typed.txt")
  await page.keyboard.press("Enter")
  const space = join(dir, "root", "Work")
  await expect.poll(() => read(join(space, "typed.txt"))).toBe("é 😀")
  await page.screenshot({ path: "test-results/7-terminal.png" })

  // Moving it to another workspace draws it again: the same shell goes on.
  await page.keyboard.press("Alt+Shift+Digit2")
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type("echo again >> typed.txt")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(space, "typed.txt"))).toBe("é 😀again\n")

  // Ctrl+W is the shell's: it deletes a word. Alt+W closes the Pane.
  await page.keyboard.type("echo one > word.txt two")
  await page.keyboard.press("Control+w")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(space, "word.txt"))).toBe("one\n")
  const shell = Number(read(join(space, "shell.pid")))
  await page.keyboard.press("Alt+KeyW")
  await expect(terminal).toBeHidden()
  await expect.poll(() => running(shell)).toBe(false)
})

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test("a Person sees who is signed in to a Harness, signs in and out", async () => {
  window = await startWindow({ account: true, oldCli: true })
  const { page } = window
  await page.getByLabel("Name").fill("Work")
  await page.getByRole("button", { name: "Create Space" }).click()
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Harnesses" })
    .click()
  const settings = page.getByRole("region", { name: "Harnesses" })
  const fake = settings.getByRole("group", { name: "Fake AI" })
  await expect(
    fake.getByText(/^fake-cli 1\.0\.0 · bandaso-fake-agent \d/)
  ).toBeVisible()
  await expect(
    fake
      .getByRole("status")
      .filter({ hasText: /1\.0\.0 is older than 2\.0\.0/ })
  ).toBeVisible()
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
  const { thread, composer } = await firstThread(page)

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
  const { thread, composer } = await firstThread(page)

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
  const { thread, composer } = await firstThread(page)

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
  const { thread, composer } = await firstThread(page)

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
  const { thread, composer } = await firstThread(page)
  const commands = thread.getByRole("listbox", { name: "Slash commands" })

  // Its Harness says its slash commands once its session opens.
  await composer.fill("/")
  await expect(
    thread.getByText("No slash commands from Fake AI yet.")
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
  const { thread, composer } = await firstThread(page)
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
  const transcript = thread.getByRole("region", { name: "Thread with Fake AI" })
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
  const { thread, composer } = await firstThread(page)
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
  const { thread, composer } = await firstThread(page)

  // The turn ends; the task it started ends later, and the Agent goes on.
  await composer.fill("background long")
  await composer.press("Enter")
  await expect(thread.getByText("Fake AI went on by itself.")).toBeVisible()
  await expect(thread.getByText("The task finished.")).toBeVisible()
  await expect(thread.getByText("Fake AI is working…")).toBeVisible()
  await composer.fill("and this")
  // Its own turn takes no message: one goes as a turn of its own.
  await expect(thread.getByRole("button", { name: "Queue" })).toBeHidden()
  await page.screenshot({ path: "test-results/18-by-itself.png" })
  await composer.press("Enter")
  await expect(thread.getByText("You said: and this")).toBeVisible()
  await expect(thread.getByText("Fake AI is working…")).toBeHidden()
})

test("the window takes its look from look.toml, and again on each save", async () => {
  window = await startWindow({
    look: '[gaps]\ninner = 12\n[colors]\naccent = "#e07a3f"\n',
  })
  const { page, dir } = window
  const file = join(dir, "look/look.toml")
  const { thread } = await firstThread(page)
  const root = page.locator("html")
  await expect(root).toHaveCSS("--gap-inner", "12px")
  // The focused tile's border takes the accent.
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(thread).toHaveCSS("border-top-color", "rgb(224, 122, 63)")
  await page.screenshot({ path: "test-results/19-look.png" })

  // A broken file keeps the last good look, and the bar names its line.
  writeFileSync(file, "[gaps]\ninner = oops\n")
  const problem = page.getByRole("status", { name: /^The look: / })
  await expect(problem).toHaveAttribute("aria-label", /look\.toml:2:9: /)
  await expect(root).toHaveCSS("--gap-inner", "12px")

  writeFileSync(file, 'mode = "dark"\n[gaps]\ninner = 20\n')
  await expect(root).toHaveCSS("--gap-inner", "20px")
  await expect(root).toHaveClass(/\bdark\b/)
  await expect(problem).toBeHidden()
  await page.screenshot({ path: "test-results/20-look-dark.png" })

  // niri's ring grows the focused tile's frame out into the gap, in the
  // border's colour: one frame, not two.
  writeFileSync(file, '[focus]\nring = 3\nborder = "#3fa0e0"\n')
  await expect(thread).toHaveCSS("border-top-color", "rgb(63, 160, 224)")
  // One stroke over the 2px border and 3px past it.
  await expect(thread).toHaveCSS("outline-width", "5px")
  await expect(thread).toHaveCSS("outline-offset", "-2px")
  await expect(thread).toHaveCSS("outline-color", "rgb(63, 160, 224)")
  await page.screenshot({ path: "test-results/21-look-ring.png" })
})

test("a Thread that finishes while the Person is elsewhere calls them with a sound", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  // Playwright hears nothing; it counts the sounds' notes as they start.
  await page.evaluate(() => {
    const counted = globalThis as unknown as { notes: number }
    counted.notes = 0
    const start = AudioScheduledSourceNode.prototype.start
    AudioScheduledSourceNode.prototype.start = function (...args) {
      counted.notes += 1
      return start.apply(this, args)
    }
  })
  const notes = () =>
    page.evaluate(() => (globalThis as unknown as { notes: number }).notes)

  // A turn the Person watches end makes no sound.
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(thread.getByText("Fake AI is working…")).toBeHidden()
  await page.waitForTimeout(500)
  expect(await notes()).toBe(0)

  // One that ends while they are in another Thread does.
  await composer.fill("slow hello")
  await composer.press("Enter")
  await page.keyboard.press("Alt+Enter")
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(
    sidebar.getByRole("button", { name: /hello/ }).getByRole("img", {
      name: "Done",
    })
  ).toBeVisible()
  await expect.poll(notes).toBeGreaterThan(0)
})
