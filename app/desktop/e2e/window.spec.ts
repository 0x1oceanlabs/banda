import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  clickNotice,
  countNotes,
  desktopOf,
  firstThread,
  sendAndLeave,
  setInFront,
  setQuiet,
  startWindow,
  type Window,
} from "./window"

let window: Window

/** Opens the latest turn's work, which folds once the turn is done. */
async function openWork(thread: Locator) {
  await thread
    .getByRole("button", { name: /^Worked for/ })
    .last()
    .click()
}

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
  // The turn ended: its work folds behind how long it took.
  await expect(question).toBeHidden()
  await openWork(thread)
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
  // It grows to the whole screen and comes to rest at the right end, the
  // launcher whole in view.
  const room = () =>
    launcher.evaluate((e) => {
      const column = e.closest<HTMLElement>("[data-column]")!
      const strip = column.parentElement!
      const pad = parseFloat(getComputedStyle(strip).paddingLeft)
      return strip.clientWidth - 2 * pad - column.offsetWidth
    })
  await expect.poll(room).toBeLessThan(1)
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

  await expect(composer).toHaveText("half a thought")
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
  await expect(thread.getByText(/banda-fake-agent --sign-in$/)).toBeVisible()
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
    fake.getByText(/^fake-cli 1\.0\.0 · banda-fake-agent \d/)
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

  await thread.getByRole("button", { name: "Plan", exact: true }).click()
  await composer.fill("which settings in a plan")
  await composer.press("Enter")
  // A reply in plan mode is the plan.
  await expect(
    thread.getByRole("group", { name: "Proposed plan" })
  ).toContainText("Mode plan, model smart, brief true")
  await composer.fill("plan done")
  await composer.press("Enter")
  await expect(thread.getByText("The plan is ready.")).toBeVisible()
  await expect(
    thread.getByRole("button", { name: "Mode: Auto-accept edits" })
  ).toBeVisible()
  await expect(
    thread.getByRole("button", { name: "Plan", exact: true })
  ).toHaveAttribute("aria-pressed", "false")
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
  // One field at a time, as T3 Code asks.
  await expect(question.getByText("1 of 2")).toBeVisible()
  await question.getByRole("button", { name: "Next" }).click()
  await question.getByRole("button", { name: "Submit" }).click()
  await expect(thread.getByText("You chose Blue.")).toBeVisible()
  await expect(question.getByText("Colour", { exact: true })).toBeVisible()
  await expect(question.getByRole("button")).toHaveCount(0)

  await composer.fill("choose once more")
  await composer.press("Enter")
  const again = thread.getByRole("group", { name: "Which colour?" }).last()
  // Keys pick a choice of the field shown, and move on to the next.
  await again.getByRole("radio", { name: /^Red/ }).focus()
  await page.keyboard.press("2")
  await expect(again.getByText("2 of 2")).toBeVisible()
  await again.getByLabel("Other").fill("Green")
  await again.getByRole("button", { name: "Submit" }).click()
  await expect(thread.getByText("You chose Green.")).toBeVisible()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/9-answered.png" })
})

/** A Thread with a turn done, and plan mode on: Shift+Tab switches it, as
 * in T3 Code. */
async function planning(page: Page) {
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const planMode = thread.getByRole("button", { name: "Plan", exact: true })
  await composer.press("Shift+Tab")
  await expect(planMode).toHaveAttribute("aria-pressed", "true")
  return { thread, composer, planMode }
}

test("a plan waits for the Person to implement it", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer, planMode } = await planning(page)
  await composer.fill("a plan for the notes")
  await composer.press("Enter")
  const proposed = thread.getByRole("group", { name: "Proposed plan" })
  await expect(proposed).toContainText("You said: a plan for the notes")
  const ready = thread.getByRole("group", { name: "Plan ready" })
  await expect(ready).toContainText("You said: a plan for the notes")
  await expect(composer).toHaveAttribute("aria-placeholder", /refine the plan/)
  await page.screenshot({ path: "test-results/7b-plan-ready.png" })

  await ready.getByRole("button", { name: "Implement" }).click()
  await expect(thread.getByText("You said: Implement the plan.")).toBeVisible()
  await expect(planMode).toHaveAttribute("aria-pressed", "false")
  await expect(ready).toBeHidden()
})

test("a plan Claude Code asks to carry out shows in its card, answered there", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer, planMode } = await planning(page)

  // The fake agent asks to leave plan mode with its plan, as Claude Code
  // does: the plan is the card, its answers under it.
  await composer.fill("propose")
  await composer.press("Enter")
  const proposed = thread.getByRole("group", { name: "Proposed plan" })
  await expect(
    proposed.getByRole("heading", { name: "Tidy the notes" })
  ).toBeVisible()
  await expect(proposed).toContainText("Sort them.")
  await page.screenshot({ path: "test-results/7c-plan-asked.png" })
  await proposed
    .getByRole("button", { name: "Yes, manually approve edits" })
    .click()
  await expect(thread.getByText("The notes are tidy.")).toBeVisible()
  await expect(proposed).toContainText("You chose: Yes, manually approve edits")
  // The Thread follows the Harness out of plan mode; nothing waits.
  await expect(planMode).toHaveAttribute("aria-pressed", "false")
  await expect(thread.getByRole("group", { name: "Plan ready" })).toBeHidden()
  await expect(
    thread.getByRole("group", { name: "Proposed plan" })
  ).toHaveCount(1)
})

test("a message sent while the Agent asks says no to it", async () => {
  window = await startWindow()
  const { thread, composer } = await firstThread(window.page)

  await composer.fill("please ask first")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "Run a check" })
  // The answer the Harness keeps for next time waits under More.
  await expect(question.getByRole("button", { name: "More" })).toBeVisible()
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    /^Send a message to say no/
  )
  await composer.fill("something else instead")
  await composer.press("Enter")
  await expect(
    thread.getByText("You said: something else instead")
  ).toBeVisible()
  await openWork(thread)
  await expect(thread.getByText("I did not run the check.")).toBeVisible()
})

test("a tool call opens on what it changed and what it printed", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)

  await composer.fill("edit the notes")
  await composer.press("Enter")
  await expect(thread.getByText("I edited notes.md.")).toBeVisible()
  await openWork(thread)
  const edit = thread.getByRole("button", { name: /Edit notes\.md/ })
  await expect(edit).toHaveText(/\+2\s*−1/)
  await edit.click()
  const change = thread.locator("[data-slot=diff]")
  await expect(change).toBeVisible()
  await expect(change.locator("[data-kind=removed]")).toHaveText("−two")
  await expect(change.locator("[data-kind=added]")).toHaveText(["+2", "+four"])

  // Under the reply, the turn's changed files; one opens beside the Thread.
  const changed = thread.getByRole("region", { name: "Changed files" })
  await expect(changed).toContainText("1 file changed")
  await changed.getByRole("button", { name: /notes\.md/ }).click()
  const diff = page.getByRole("region", { name: "Changes · edit the notes" })
  await expect(diff.locator("[data-kind=removed]")).toHaveText("−two")
  await page.screenshot({ path: "test-results/10-diff-pane.png" })
  await diff
    .getByRole("button", { name: "Close Changes · edit the notes" })
    .click()

  await composer.fill("run the tests")
  await composer.press("Enter")
  await expect(thread.getByText("The tests passed.")).toBeVisible()
  await openWork(thread)
  await thread.getByRole("button", { name: /Run the tests/ }).click()
  const printed = thread.locator("[data-slot=console]")
  await expect(printed).toBeVisible()
  await expect(printed).toContainText("test two ... ok")
  // The fold opened above the reply; the console's own end is in view.
  await printed.scrollIntoViewIfNeeded()
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
  await expect(composer).toHaveText("/review ")
  await expect(commands).toBeHidden()
  await composer.pressSequentially("the notes")
  await composer.press("Enter")
  await expect(thread.getByText("You said: /review the notes")).toBeVisible()

  // The window's own switch plan mode and send nothing.
  await composer.fill("/pl")
  await commands.getByRole("option", { name: /^\/plan/ }).click()
  await expect(composer).toHaveText("")
  await expect(
    thread.getByRole("button", { name: "Plan", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(composer).toBeFocused()

  await composer.fill("/default")
  await expect(commands).toBeVisible()
  await composer.press("Escape")
  await expect(commands).toBeHidden()
  await composer.press("Enter")
  await expect(composer).toHaveText("")
  await expect(
    thread.getByRole("button", { name: "Plan", exact: true })
  ).toHaveAttribute("aria-pressed", "false")
  await expect(thread.getByText("You said: /default")).toBeHidden()

  // A command starts any line, not only the message.
  await composer.pressSequentially("first")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("/rev")
  await expect(commands).toBeVisible()
  await composer.press("Enter")
  await expect(composer.locator("p")).toHaveText(["first", "/review"])
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
  await expect(thread.getByText("You said: look")).toBeVisible()
  await openWork(thread)
  await expect(thread.getByText("I see 1 image: image/png.")).toBeVisible()
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
  // The button steers too, and says so.
  await expect(thread.getByRole("button", { name: "Steer" })).toBeEnabled()
  await page.screenshot({ path: "test-results/15-steer.png" })
  await composer.press("Enter")
  await expect(thread.getByText("Steered: also this.")).toBeVisible()

  // Ctrl+Enter, or Ctrl+click on the button, has it wait for the turn to
  // end.
  await composer.fill("wait again")
  await composer.press("Enter")
  await expect(waits).toHaveCount(2)
  await composer.fill("second")
  await composer.press("Control+Enter")
  await composer.fill("third")
  await thread
    .getByRole("button", { name: "Steer" })
    .click({ modifiers: ["ControlOrMeta"] })
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

test("the composer walks earlier messages, keeps a draft and edits what waits", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await composer.fill("again")
  await composer.press("Enter")
  await expect(thread.getByText("You said: again")).toBeVisible()

  // ↑ and ↓ in an empty box walk what the Person sent.
  await composer.press("ArrowUp")
  await expect(composer).toHaveText("again")
  await composer.press("ArrowUp")
  await expect(composer).toHaveText("hello")
  await composer.press("ArrowDown")
  await composer.press("ArrowDown")
  await expect(composer).toHaveText("")

  // Shift+Enter starts a line; ↑ on the second line moves the caret
  // first, and only then walks the history.
  await composer.pressSequentially("one")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("two")
  await expect(composer.locator("p")).toHaveText(["one", "two"])
  await composer.press("ArrowUp")
  await expect(composer.locator("p")).toHaveText(["one", "two"])
  await composer.press("Enter")
  await expect(thread.getByText(/You said: one\s+two/)).toBeVisible()
  await expect(composer).toHaveText("")

  // Pasted text goes in as plain lines.
  await composer.evaluate((box) => {
    const data = new DataTransfer()
    data.setData("text/plain", "pasted\nlines")
    const paste = { clipboardData: data, bubbles: true, cancelable: true }
    box.dispatchEvent(new ClipboardEvent("paste", paste))
  })
  await expect(composer.locator("p")).toHaveText(["pasted", "lines"])
  await composer.press("ControlOrMeta+a")
  await composer.press("Backspace")
  await expect(composer).toHaveText("")

  // What is written waits as the Thread's draft, until it is sent.
  const drafts = () =>
    page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("banda.agents.draft."))
        .map((key) => localStorage.getItem(key))
    )
  await composer.fill("half written")
  await expect.poll(drafts).toEqual(["half written"])
  await composer.fill("")
  await expect.poll(drafts).toEqual([])

  // ↑ opens the last message that waits, to change it, before the
  // earlier ones.
  await composer.fill("wait here")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()
  await composer.fill("after it")
  await composer.press("Control+Enter")
  const queue = thread.getByRole("list", { name: "Waiting messages" })
  await expect(queue.getByText("after it")).toBeVisible()
  await expect(composer).toHaveText("")
  await composer.press("ArrowUp")
  const edit = thread.getByRole("textbox", { name: "Waiting message" })
  await expect(edit).toHaveValue("after it")
  await edit.fill("after it, changed")
  await edit.press("Enter")
  await expect(queue.getByText("after it, changed")).toBeVisible()
  await thread.getByRole("button", { name: "Stop" }).click()
})

test("a sent message moves near the top, the end says what waits, and a Thread keeps its place", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  for (const word of ["one", "two", "three", "four", "five", "six"]) {
    await composer.fill(word)
    await composer.press("Enter")
    await expect(thread.getByText(`You said: ${word}`)).toBeVisible()
  }
  const log = thread.getByRole("log")
  const view = thread.getByRole("region", { name: "Thread with Fake AI" })

  // The message sent sits near the top, its reply below it.
  await composer.fill("wait here")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()
  const sent = log.getByText("wait here", { exact: true })
  const top = async () =>
    (await sent.boundingBox())!.y - (await view.boundingBox())!.y
  await expect.poll(top).toBeLessThan(120)

  // Scrolled up, the button to the end says what waits there.
  for (const word of ["a", "b"]) {
    await composer.fill(word)
    await composer.press("Control+Enter")
    await expect(composer).toHaveText("")
  }
  await expect(
    thread.getByRole("list", { name: "Waiting messages" }).getByRole("listitem")
  ).toHaveCount(2)
  await log.hover()
  await page.mouse.wheel(0, -3000)
  const toEnd = thread.getByRole("button", { name: /^Scroll to end/ })
  await expect(toEnd).toHaveText("Scroll to end · 2 queued")
  await expect(toEnd).toHaveAttribute("data-active", "true")
  await page.screenshot({ path: "test-results/18b-scroll-to-end.png" })

  // Closed and opened again, the Thread is where its Person left it.
  await expect(log.getByText("You said: one")).toBeInViewport()
  await thread.getByRole("button", { name: "Close one" }).click()
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /one/ })
    .click()
  await expect(thread.getByText("Waiting.")).toBeAttached()
  await expect(log.getByText("You said: one")).toBeInViewport()
  await expect(thread.getByText("Waiting.")).not.toBeInViewport()

  await toEnd.click()
  await expect(toEnd).toHaveAttribute("data-active", "false")
  await expect(thread.getByText("Waiting.")).toBeInViewport()
  await thread.getByRole("button", { name: "Stop" }).click()
})

test("Ctrl+F finds in the Thread and opens what folds it, and the minimap goes to a message", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("run it")
  await composer.press("Enter")
  await expect(thread.getByText("The tests passed.")).toBeVisible()
  for (const word of ["one", "two"]) {
    await composer.fill(word)
    await composer.press("Enter")
    await expect(thread.getByText(`You said: ${word}`)).toBeVisible()
  }
  const tool = thread.getByRole("button", { name: /Run the tests/ })
  await expect(tool).toBeHidden()

  // Ctrl+F opens the find bar; what it finds in a folded turn shows.
  await composer.press("ControlOrMeta+f")
  const find = thread.getByRole("textbox", { name: "Find in thread" })
  await expect(find).toBeFocused()
  await find.fill("the tests")
  await expect(tool).toBeVisible()
  await expect(thread.getByText(/^1 of \d+$/)).toBeVisible()
  await find.press("Enter")
  await expect(thread.getByText(/^2 of \d+$/)).toBeVisible()
  await find.fill("nothing like it")
  await expect(thread.getByText("No results")).toBeVisible()
  await find.fill("you said")
  await page.screenshot({ path: "test-results/18c-find.png" })
  await find.press("Escape")
  await expect(find).toBeHidden()
  await expect(tool).toBeHidden()

  // The minimap marks each message the Person sent, and goes to it.
  const minimap = thread.getByRole("navigation", { name: "Your messages" })
  await expect(minimap.getByRole("button")).toHaveCount(3)
  await minimap.getByRole("button", { name: "run it" }).click()
  await expect(
    thread.getByRole("log").getByText("run it", { exact: true })
  ).toBeInViewport()
})

test("@ names a file in the Space's folder, picked from a list", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const space = join(dir, "root", "Work")
  mkdirSync(join(space, "src"), { recursive: true })
  writeFileSync(join(space, "src", "main.ts"), "")
  writeFileSync(join(space, "notes.md"), "")

  await composer.fill("look at @mai")
  const files = page.getByRole("listbox", { name: "Files" })
  await expect(files.getByRole("option")).toHaveCount(1)
  await expect(files.getByRole("option")).toContainText("main.ts")
  await expect(files.getByRole("option")).toContainText("src")
  await page.screenshot({ path: "test-results/18d-files.png" })
  await composer.press("Enter")
  // The file is a chip: its name, the path on hover.
  const chip = composer.locator("[data-chip=file]")
  await expect(chip).toHaveText("main.ts")
  await expect(chip).toHaveAttribute("title", "src/main.ts")
  await expect(files).toBeHidden()
  await page.screenshot({ path: "test-results/18e-file-chip.png" })
  // Backspace takes the space, then the chip whole.
  await composer.press("Backspace")
  await composer.press("Backspace")
  await expect(chip).toHaveCount(0)
  await expect(composer).toHaveText("look at")
  await composer.pressSequentially(" @mai")
  await expect(files.getByRole("option")).toHaveCount(1)
  await composer.press("Enter")
  await composer.pressSequentially("please")
  await composer.press("Enter")
  // It is sent as what it writes.
  await expect(
    thread.getByText("You said: look at @src/main.ts please")
  ).toBeVisible()

  // Nothing that holds the words says so.
  await composer.fill("@nothing-like-it")
  await expect(page.getByText("No file holds that.")).toBeVisible()
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
  await expect(thread.getByText(/^Working for \d+s$/)).toBeVisible()
  await composer.fill("and this")
  // Its own turn takes no message: one goes as a turn of its own.
  await expect(thread.getByRole("button", { name: "Steer" })).toBeHidden()
  await page.screenshot({ path: "test-results/18-by-itself.png" })
  await composer.press("Enter")
  await expect(thread.getByText("You said: and this")).toBeVisible()
  await expect(thread.getByText(/^Working for/)).toBeHidden()
})

test("the sidebar is arranged by sidebar.toml, and its view menu writes the file", async () => {
  window = await startWindow({ sidebar: '# mine\npreset = "spaces"\n' })
  const { page, dir } = window
  const file = join(dir, "config/sidebar.toml")
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const view = sidebar.getByRole("button", { name: /^View: / })
  await expect(view).toHaveAccessibleName("View: spaces")
  // Each Space a section: the row sits under its Space's name.
  const work = sidebar.getByRole("group", { name: "Work" })
  await expect(work.getByRole("button", { name: /hello/ })).toBeVisible()
  await page.screenshot({ path: "test-results/22-sidebar-spaces.png" })

  // The menu writes the preset into the file and keeps the rest; the
  // arrangement comes back from the file.
  await view.click()
  await page.getByRole("menuitemradio", { name: /^places/ }).click()
  await expect(view).toHaveAccessibleName("View: places")
  expect(readFileSync(file, "utf8")).toBe('# mine\npreset = "places"\n')
  await expect(sidebar.getByRole("group", { name: "Spaces" })).toBeVisible()
  await page.screenshot({ path: "test-results/23-sidebar-places.png" })

  // A wrong key is named by its line, and the last good arrangement stays.
  writeFileSync(file, 'preset = "places"\n[row]\nlines = 5\n')
  const problem = page.getByRole("status", { name: /^The look: / })
  await expect(problem).toHaveAttribute("aria-label", /sidebar\.toml:3:9: /)
  await expect(view).toHaveAccessibleName("View: places")

  // A preset of the Person's own is a file, and the menu lists it.
  mkdirSync(join(dir, "config/sidebars"))
  writeFileSync(
    join(dir, "config/sidebars/flat.toml"),
    '[group]\nby = "none"\n[row]\nlines = 1\n'
  )
  writeFileSync(file, 'preset = "flat"\n')
  await expect(view).toHaveAccessibleName("View: flat")
  await expect(problem).toBeHidden()
  await view.click()
  await expect(
    page.getByRole("menuitemradio", { name: /^flat/ })
  ).toContainText("Your own preset")
  await page.keyboard.press("Escape")
})

test("columns and the text size come from look.toml", async () => {
  window = await startWindow({
    look: '[columns]\npresets = ["1/4", "3/4"]\ndefault = "1/4"\nmin = 0\n[font]\nsize = 16\n',
  })
  const { page } = window
  const root = page.locator("html")
  // 16px text: the root grows by 16/14, and the rest with it.
  await expect(root).toHaveCSS("--text-root", "18.286px")
  const size = await root.evaluate((e) =>
    parseFloat(getComputedStyle(e).fontSize)
  )
  expect(size).toBeCloseTo(18.286, 1)

  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const column = thread.locator("xpath=ancestor::*[@data-column][1]")
  const share = () =>
    column.evaluate(
      (e: HTMLElement) => e.offsetWidth / e.parentElement!.clientWidth
    )
  // A new column opens at the look's default, a quarter.
  await expect.poll(share).toBeLessThan(0.3)
  await page.keyboard.press("Alt+Control+ArrowRight")
  await expect.poll(share).toBeGreaterThan(0.7)
})

test("no column is narrower than columns.min; Alt+R goes round, Alt+F fills", async () => {
  // 50 rem is more than 2/3 of this window's Strip and less than all of it.
  window = await startWindow({ look: "[columns]\nmin = 50\n" })
  const { page } = window
  const rem = await page
    .locator("html")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  const { thread } = await firstThread(page)
  const column = thread.locator("xpath=ancestor::*[@data-column][1]")
  // The column's width, and the Strip's room for columns.
  const sizes = () =>
    column.evaluate((e: HTMLElement) => {
      const strip = getComputedStyle(e.parentElement!)
      const room =
        e.parentElement!.clientWidth -
        parseFloat(strip.paddingLeft) -
        parseFloat(strip.paddingRight)
      return { width: e.offsetWidth, room }
    })
  const floor = async () => {
    const { width } = await sizes()
    return Math.abs(width - 50 * rem) < 1
  }
  const full = async () => {
    const { width, room } = await sizes()
    return Math.abs(width - room) < 1
  }
  // A half would be too narrow: the column is 50 rem.
  await expect.poll(floor).toBe(true)
  // Nothing narrower shows, so the step does nothing.
  await page.keyboard.press("Alt+Control+ArrowLeft")
  await expect.poll(floor).toBe(true)
  // 2/3 is drawn at the floor too: Alt+R goes past it to all of it.
  await page.keyboard.press("Alt+r")
  await expect.poll(full).toBe(true)
  await page.keyboard.press("Alt+r")
  await expect.poll(floor).toBe(true)
  await page.keyboard.press("Alt+f")
  await expect.poll(full).toBe(true)
  await page.keyboard.press("Alt+f")
  await expect.poll(floor).toBe(true)
})

test("tiles without the focus darken as dim-inactive says", async () => {
  window = await startWindow({ look: "[tile]\ndim-inactive = 0.5\n" })
  const { page } = window
  const { thread } = await firstThread(page)
  const veil = (tile: Locator) =>
    tile.evaluate((e) => getComputedStyle(e, "::after").opacity)
  await expect.poll(() => veil(thread)).toBe("0")
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect.poll(() => veil(thread)).toBe("0.5")
  expect(await veil(launcher)).toBe("0")
  await page.screenshot({ path: "test-results/22-look-dim.png" })
})

test("columns grow and go to their new places on the look's motion", async () => {
  const slow = 'easing = { duration-ms = 1500, curve = "linear" }'
  window = await startWindow({
    look: `[motion.resize]\n${slow}\n[motion.move]\n${slow}\n`,
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const column = thread.locator("xpath=ancestor::*[@data-column][1]")
  const share = () =>
    column.evaluate(
      (e: HTMLElement) => e.offsetWidth / e.parentElement!.clientWidth
    )

  // From a half to two thirds: seen on its way, and there in the end.
  const half = await share()
  await page.keyboard.press("Alt+Control+ArrowRight")
  await expect.poll(share).toBeGreaterThan(half + 0.03)
  expect(await share()).toBeLessThan(0.64)
  await expect.poll(share).toBeGreaterThan(0.65)

  // The Thread changes places with the column on its right: it goes there.
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Shift+ArrowLeft")
  const slide = () => column.evaluate((e: HTMLElement) => e.style.translate)
  await expect.poll(slide).not.toBe("")
  await expect.poll(slide).toBe("")
})

test("a tile fades in as it opens and fades out where it was as it closes", async () => {
  const slow = 'easing = { duration-ms = 1500, curve = "linear" }'
  window = await startWindow({
    look: `[motion.open]\n${slow}\n[motion.close]\n${slow}\n`,
  })
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const opacity = (tile: Locator) =>
    tile.evaluate((e) => Number(getComputedStyle(e).opacity))

  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toBeVisible()
  expect(await opacity(launcher)).toBeLessThan(0.9)
  await expect.poll(() => opacity(launcher)).toBe(1)

  // Closed, it is gone from the window at once, and its look fades out.
  await page.keyboard.press("Alt+KeyW")
  await expect(launcher).toBeHidden()
  const ghost = page.locator("[aria-hidden=true][inert]", {
    hasText: "What should this tile show?",
  })
  await expect(ghost).toHaveCount(1)
  await expect(ghost).toHaveCount(0)
})

test("the window takes its look from look.toml, and again on each save", async () => {
  window = await startWindow({
    look: '[gaps]\ninner = 12\n[colors]\naccent = "#e07a3f"\n',
  })
  const { page, dir } = window
  const file = join(dir, "config/look.toml")
  // Each settings file's schema is there for an editor (ADR 0016).
  await expect
    .poll(() => existsSync(join(dir, "config/schemas/look.schema.json")))
    .toBe(true)
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

  // Motion is the look's too: a slow, straight move between workspaces
  // is seen halfway, and lands.
  writeFileSync(
    file,
    '[gaps]\ninner = 7\n[motion.workspace]\neasing = { duration-ms = 1500, curve = "linear" }\n'
  )
  await expect(root).toHaveCSS("--gap-inner", "7px")
  const first = page.getByRole("group", {
    name: "Workspace 1",
    includeHidden: true,
  })
  const place = () =>
    first.evaluate((e) =>
      parseFloat(e.style.transform.slice("translateY(".length))
    )
  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+Shift+Digit2")
  await expect.poll(place).toBeLessThan(-10)
  expect(await place()).toBeGreaterThan(-90)
  await expect.poll(place).toBe(-100)
})

test("a Thread that finishes while the Person is elsewhere calls them with a sound", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const notes = await countNotes(page)

  // A turn the Person watches end makes no sound.
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(thread.getByText("Fake AI is working…")).toBeHidden()
  await page.waitForTimeout(500)
  expect(await notes()).toBe(0)

  // One that ends while they are in another Thread does.
  await sendAndLeave(page, composer, "slow hello")
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(
    sidebar.getByRole("button", { name: /hello/ }).getByRole("img", {
      name: "Done",
    })
  ).toBeVisible()
  await expect.poll(notes).toBeGreaterThan(0)
})

test("[sound] in look.toml chooses the sounds: off is silence", async () => {
  window = await startWindow({ look: '[sound]\nfamily = "off"\n' })
  const { page } = window
  const { composer } = await firstThread(page)
  const notes = await countNotes(page)
  await sendAndLeave(page, composer, "slow hello")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(
    sidebar.getByRole("button", { name: /slow hello/ }).getByRole("img", {
      name: "Done",
    })
  ).toBeVisible()
  await page.waitForTimeout(500)
  expect(await notes()).toBe(0)
})

/** Sends `text` in `composer`'s Thread, then goes to the empty workspace below. */
async function sendAndGoBelow(page: Page, composer: Locator, text: string) {
  await composer.fill(text)
  await composer.press("Enter")
  const thread = composer.locator("xpath=ancestor::section[1]")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  await page.keyboard.press("Alt+PageDown")
  await expect(thread).toBeHidden()
}

test("a Thread that finishes out of sight shows a toast, and it goes there", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")

  const calls = page.getByRole("region", { name: "Calls" })
  const toast = calls.getByRole("button", { name: /slow hello/ })
  await expect(toast).toContainText("Done")
  await expect(toast).toContainText("Open")
  await page.screenshot({ path: "test-results/23-toast.png" })

  await toast.click()
  const thread = page.getByRole("region", { name: "slow hello" })
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(toast).toBeHidden()
  // Seen: the sidebar's mark settles.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(
    sidebar.getByRole("button", { name: /slow hello/ }).getByRole("img", {
      name: "Done",
    })
  ).toBeHidden()
})

test("a Thread that finishes on screen makes its sound, and no toast", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  const notes = await countNotes(page)
  await sendAndLeave(page, composer, "slow hello")
  await expect.poll(notes).toBeGreaterThan(0)
  await expect(page.getByRole("region", { name: "Calls" })).toBeHidden()
})

test("Alt+U goes to the Thread that calls", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")
  const calls = page.getByRole("region", { name: "Calls" })
  await expect(calls.getByRole("button", { name: /slow hello/ })).toBeVisible()

  await page.keyboard.press("Alt+U")
  const thread = page.getByRole("region", { name: "slow hello" })
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(calls).toBeHidden()
})

test("a Thread that finishes behind another window sends a system notification, and its click goes there", async () => {
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("slow hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  await setInFront(page, false)

  // Its Pane has the focus, but the window is behind: it is not seen.
  await expect.poll(async () => (await desktopOf(app)).shown.length).toBe(1)
  const [notice] = (await desktopOf(app)).shown
  expect(notice).toMatchObject({
    title: "slow hello",
    body: "Done",
    answer: "Open",
    lasts: false,
  })
  expect(notice!.icon).toMatch(/^data:image\/png;base64,/)
  writeFileSync(
    "test-results/24-notice-icon.png",
    Buffer.from(notice!.icon!.split(",")[1]!, "base64")
  )
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const done = sidebar
    .getByRole("button", { name: /slow hello/ })
    .getByRole("img", { name: "Done" })
  await expect(done).toBeVisible()

  // The Person clicks it: the window is in front again, the Thread seen.
  await setInFront(page, true)
  await clickNotice(app, notice!.key)
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(done).toBeHidden()
  // Seen, its notice is taken back.
  await expect
    .poll(async () => (await desktopOf(app)).withdrawn)
    .toContain(notice!.key)
})

test("the desktop's Do Not Disturb leaves only the Marks", async () => {
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  const notes = await countNotes(page)
  await setQuiet(app, true)
  await composer.fill("slow hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  await setInFront(page, false)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(
    sidebar.getByRole("button", { name: /slow hello/ }).getByRole("img", {
      name: "Done",
    })
  ).toBeVisible()
  await page.waitForTimeout(500)
  expect((await desktopOf(app)).shown).toEqual([])
  expect(await notes()).toBe(0)
})

test("[notify] in look.toml chooses where a call is told: always the desktop, never a toast", async () => {
  window = await startWindow({
    look: '[notify]\nsystem = "always"\nwindow = "off"\ndetail = false\n',
  })
  const { app, page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")

  // The window is in front, the Thread out of sight: a notice, no toast.
  await expect.poll(async () => (await desktopOf(app)).shown.length).toBe(1)
  expect((await desktopOf(app)).shown[0]).toMatchObject({
    title: "slow hello",
    body: "Done",
  })
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(
    sidebar.getByRole("button", { name: /slow hello/ }).getByRole("img", {
      name: "Done",
    })
  ).toBeVisible()
  await expect(page.getByRole("region", { name: "Calls" })).toBeHidden()
})

test("a Thread settles from its row's menu, as in T3 Code, and Alt+S brings it back", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const list = sidebar.getByRole("group", { name: "Threads" })
  const row = list.getByRole("button", { name: /hello/ })
  await expect(row).toBeVisible()

  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: /Settle thread/ }).click()
  // On the Settled shelf, folded, with its count.
  const shelf = sidebar.getByRole("group", { name: "Settled" })
  const header = shelf.getByRole("button", { name: /Settled/ })
  await expect(header).toHaveAttribute("aria-expanded", "false")
  await expect(header).toContainText("1")
  await expect(row).toBeHidden()
  await header.click()
  await expect(shelf.getByRole("button", { name: /hello/ })).toBeVisible()
  await page.screenshot({ path: "test-results/25-settled.png" })

  // The Thread in the focused Pane comes back with Alt+S.
  await page.keyboard.press("Alt+S")
  await expect(row).toBeVisible()
  await expect(shelf).toBeHidden()
})

test("Alt+Space opens the Banda menu: it finds a Thread, and Alt+Enter starts one with the words", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")

  // The sidebar's field opens it, and Esc closes it.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await sidebar.screenshot({ path: "test-results/26-sidebar-search.png" })
  await sidebar.getByRole("button", { name: /Search/ }).click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(
    menu.getByRole("group", { name: "Recent Threads" })
  ).toContainText("hello")
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  // Alt+Space; the words find the Thread, and New Thread with them waits
  // last.
  await page.keyboard.press("Alt+Space")
  const search = menu.getByRole("combobox", { name: "Search" })
  await search.fill("hel")
  await expect(menu.getByRole("option").first()).toContainText("hello")
  await expect(
    menu.getByRole("option", { name: /New Thread: “hel”/ })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/26-banda-menu.png" })

  // Alt+Enter starts a Thread with the words.
  await search.fill("write a poem")
  await page.keyboard.press("Alt+Enter")
  await expect(menu).toBeHidden()
  await expect(page.getByText("You said: write a poem")).toBeVisible()

  // Alt+K opens it at its Actions, each with its key; Alt+K again closes it.
  await page.keyboard.press("Alt+K")
  await expect(menu.getByRole("group", { name: "Actions" })).toContainText(
    "Show or hide the sidebar"
  )
  await page.keyboard.press("Alt+K")
  await expect(menu).toBeHidden()
})
