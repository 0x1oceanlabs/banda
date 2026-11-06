import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  agentAnswers,
  agentCalls,
  agentSays,
  clickNotice,
  countNotes,
  desktopOf,
  firstThread,
  GLASS,
  sendAndLeave,
  setInFront,
  setQuiet,
  startWindow,
  wallpaper,
  type Window,
  read,
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

test("a Person makes a Project, starts a Thread in it, and works with it", async () => {
  window = await startWindow()
  const { page } = window
  // A checkout is Banda Local (ADR 0033); its profile stays beside the
  // engine's.
  expect(
    await window.app.evaluate(({ app }) => [
      app.getName(),
      app.getPath("userData"),
    ])
  ).toEqual(["Banda Local", join(window.dir, "state", "window")])

  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.screenshot({ path: "test-results/0-welcome.png" })
  const { thread, composer } = await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await expect(composer).toBeFocused()
  await expect(
    thread.getByRole("button", { name: "Project: Work" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/1-first-project.png" })
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(page.getByRole("region", { name: "hello" })).toBeVisible()
  // Once started, the Thread's Project is its own.
  await expect(thread.getByRole("button", { name: /^Project:/ })).toBeHidden()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(sidebar.getByRole("button", { name: /hello/ })).toBeVisible()

  await composer.fill("please ask first")
  await composer.press("Enter")
  // The Question waits on the composer, saying in words what it allows;
  // the Thread keeps a line in its place.
  const question = thread.getByRole("group", { name: "Run a check" })
  await expect(question).toContainText("Allow Fake AI to run a command?")
  await expect(thread.getByText("Waiting for you: Run a check")).toBeVisible()
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
  await expect(thread.getByText("Allowed: Run a check")).toBeVisible()
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
  await firstThread(page)
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

test("New Pane and New Thread open a new tile at each press, as a browser's new window", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  const drafts = page.getByRole("region", { name: "New Thread" })
  const launchers = page.getByRole("region", { name: "New Pane" })
  await expect(drafts).toHaveCount(1)

  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+KeyN")
  await expect(launchers).toHaveCount(2)
  await expect(launchers.last()).toHaveAttribute("data-focused", "true")

  // A launcher becomes a new Thread, though another waits unstarted.
  await launchers.last().getByRole("button", { name: "New Thread" }).click()
  await expect(launchers).toHaveCount(1)
  await expect(drafts).toHaveCount(2)

  await page.keyboard.press("Alt+Enter")
  await page.keyboard.press("Alt+Enter")
  await expect(drafts).toHaveCount(4)
  await expect(drafts.last()).toHaveAttribute("data-focused", "true")
  await page.screenshot({ path: "test-results/2-many-new.png" })

  // An empty workspace's New Thread starts one there, not elsewhere.
  await page.getByRole("button", { name: "New workspace" }).click()
  await page
    .getByRole("main")
    .getByRole("button", { name: "New Thread", exact: true })
    .click()
  // The others wait on workspace 1, out of sight.
  await expect(drafts).toHaveCount(1)
  await expect(drafts).toHaveAttribute("data-focused", "true")
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  await expect(numbers.locator("[aria-current]")).toHaveText("2")
})

test("a Pane moves to another workspace, and the overview shows them all", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)
  const draft = page.getByRole("region", { name: "New Thread" })
  await expect(draft).toBeVisible()
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  const names = () =>
    numbers
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((b) => b.ariaLabel))
  await expect.poll(names).toEqual(["Workspace 1", "New workspace"])

  // The + is the empty workspace at the bottom: a click goes there, and
  // there it is the one marked.
  const fresh = page.getByRole("button", { name: "New workspace" })
  await fresh.click()
  await expect(fresh).toHaveAttribute("aria-current", "true")
  await expect.poll(names).toEqual(["Workspace 1", "New workspace"])
  await page.screenshot({ path: "test-results/2-new-workspace.png" })
  await page.keyboard.press("Alt+PageUp")
  await expect(fresh).not.toHaveAttribute("aria-current")
  await expect(draft).toBeVisible()

  // The Pane goes to the workspace below, and the window follows it.
  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+Shift+Digit2")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect(draft).toBeHidden()
  await expect
    .poll(names)
    .toEqual(["Workspace 1", "Workspace 2", "New workspace"])
  await expect(
    numbers.getByRole("button", { name: "Workspace 2" })
  ).toHaveAttribute("aria-current", "true")
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
  await numbers.getByRole("button", { name: "Workspace 2" }).click()
  await expect(overview).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(overview).toBeHidden()

  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(sidebar).toBeVisible()
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebar).toBeHidden()
})

test("the bar's workspaces come and go on the look's motion, as numbers or dots", async () => {
  const slow = 'easing = { duration-ms = 1500, curve = "linear" }'
  window = await startWindow({ look: `[motion.workspace]\n${slow}\n` })
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  const width = (cell: Locator) =>
    cell.evaluate((e) => e.getBoundingClientRect().width)
  const x = async (cell: Locator) => (await cell.boundingBox())!.x

  // The Pane goes to the empty workspace at the bottom, which becomes
  // Workspace 2; a new empty one comes below it, widening from nothing,
  // and the mark goes to Workspace 2.
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  // The bar settles from the window's start first: at the slow move the
  // cells the first Thread made widen for a while, and the one that comes
  // is told apart from them by its id, not its width.
  await expect
    .poll(() =>
      numbers
        .locator(":scope > button[data-workspace]")
        .evaluateAll((cells) =>
          cells.every((cell) => cell.getBoundingClientRect().width === 26)
        )
    )
    .toBe(true)
  // Every frame's width of a cell that was not there: one measure after
  // it came is late on a busy runner, as the motion runs on.
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Workspaces"]')!
    const cells = () => [
      ...nav.querySelectorAll<HTMLElement>(":scope > [data-workspace]"),
    ]
    const before = new Set(cells().map((cell) => cell.dataset.workspace))
    const seen: number[] = []
    Object.assign(window, { seen })
    let frames = 0
    const sample = () => {
      for (const cell of cells())
        if (!before.has(cell.dataset.workspace))
          seen.push(cell.getBoundingClientRect().width)
      if (++frames < 600) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.keyboard.press("Alt+Shift+Digit2")
  const two = numbers.getByRole("button", { name: "Workspace 2" })
  await expect(two).toHaveAttribute("aria-current", "true")
  const seen = () =>
    page.evaluate(() => (window as unknown as { seen: number[] }).seen)
  await expect.poll(async () => (await seen()).at(-1)).toBe(26)
  expect(Math.min(...(await seen()))).toBeLessThan(20)
  const mark = numbers.locator(":scope > span[aria-hidden]")
  await expect
    .poll(async () => Math.round((await x(mark)) - (await x(two))))
    .toBe(1)

  // Emptied, it is still there while the Person is; left, it narrows
  // where it was, out of reach.
  await page.keyboard.press("Alt+KeyW")
  await expect(two.locator(".border-dashed")).toBeVisible()
  await page.keyboard.press("Alt+PageUp")
  const gone = numbers.locator("[inert]")
  await expect(gone).toHaveCount(1)
  await expect(gone).toHaveCount(0)
  await expect(two).toHaveCount(0)

  // As dots, the one shown is drawn long.
  await window.close()
  window = await startWindow({ look: '[bar]\nworkspaces = "dots"\n' })
  await firstThread(window.page)
  const dots = window.page.getByRole("navigation", { name: "Workspaces" })
  const one = dots.getByRole("button", { name: "Workspace 1" })
  await expect(one).toHaveAttribute("aria-current", "true")
  await expect.poll(() => width(one)).toBe(30)
  await expect
    .poll(() => width(dots.getByRole("button", { name: "New workspace" })))
    .toBe(14)
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
      const { paddingLeft, paddingRight } = getComputedStyle(strip)
      return (
        strip.clientWidth -
        parseFloat(paddingLeft) -
        parseFloat(paddingRight) -
        column.offsetWidth
      )
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
  await expect(
    numbers.getByRole("button", { name: "Workspace 1" })
  ).toHaveAttribute("aria-current", "true")
  await page.keyboard.down("Alt")
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 30)
    await page.waitForTimeout(60)
  }
  await page.keyboard.up("Alt")
  await expect(
    numbers.getByRole("button", { name: "Workspace 2" })
  ).toHaveAttribute("aria-current", "true")
  // Two and the empty one; a Project's shows its badge, not its number.
  await expect(numbers.getByRole("button")).toHaveCount(3)
  await expect(
    numbers.getByRole("button", { name: "Workspace 1" })
  ).toBeVisible()
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

test("a Person works in a terminal in the Project, and closing it stops the shell", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()

  const terminal = terminalTile(page)
  const screen = terminal.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type("echo $$ > shell.pid; printf 'é 😀' > typed.txt")
  await page.keyboard.press("Enter")
  const project = join(dir, "root", "Work")
  await expect.poll(() => read(join(project, "typed.txt"))).toBe("é 😀")
  await page.screenshot({ path: "test-results/7-terminal.png" })

  // Moving it to another workspace draws it again: the same shell goes on.
  await page.keyboard.press("Alt+Shift+Digit2")
  const moved = page
    .getByRole("group", { name: "Workspace 2" })
    .getByRole("region", { name: "Terminal screen" })
  await expect(moved).toHaveAttribute("data-state", "running")
  await moved.click()
  await page.keyboard.type("echo again >> typed.txt")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(project, "typed.txt"))).toBe("é 😀again\n")

  // Ctrl+W is the shell's: it deletes a word. Alt+W closes the Pane.
  await page.keyboard.type("echo one > word.txt two")
  await page.keyboard.press("Control+w")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(project, "word.txt"))).toBe("one\n")

  // Ctrl added to a key Banda takes hands the shell that key with Alt:
  // Ctrl+Alt+W is Alt+W, Escape and w. A key Banda leaves free is sent as
  // it was: Ctrl+Alt+B is Escape and Ctrl+B.
  // The keys wait for read: the shell drops what was typed ahead.
  await page.keyboard.type(
    `: > reading; IFS= read -r x; printf '%s' "$x" > alt.txt`
  )
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(project, "reading"))).toBe("")
  await page.keyboard.press("Control+Alt+KeyW")
  await page.keyboard.press("Control+Alt+KeyB")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(project, "alt.txt"))).toBe("\x1bw\x1b\x02")
  await expect(terminal).toBeVisible()

  // Its header says what runs in it, and where.
  const header = terminal.locator("header")
  await expect(header).toContainText("root/Work")
  await page.keyboard.type("cat")
  await page.keyboard.press("Enter")
  await expect(header.getByRole("heading")).toHaveText("cat")

  const shell = Number(read(join(project, "shell.pid")))
  await page.keyboard.press("Alt+KeyW")
  await expect(terminal).toBeHidden()
  await expect.poll(() => running(shell)).toBe(false)
})

test("with Ctrl+Alt the mod, Banda's keys hold it and Alt keys are the shell's (ADR 0068)", async () => {
  window = await startWindow({
    files: { "config/keys.toml": 'mod = "Ctrl+Alt"\n' },
  })
  const { page, dir } = window
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Control+Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const terminal = terminalTile(page)
  const screen = terminal.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()

  // Alt+R is the shell's now, Escape and r, as the program asked for it.
  const space = join(dir, "root", "Work")
  await page.keyboard.type(
    `: > reading; IFS= read -r x; printf '%s' "$x" > alt.txt`
  )
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(space, "reading"))).toBe("")
  await page.keyboard.press("Alt+KeyR")
  await page.keyboard.press("Enter")
  await expect.poll(() => read(join(space, "alt.txt"))).toBe("\x1br")

  // Ctrl+Alt+R gives the terminal's column its next width, and the Pane's
  // close button names Ctrl+Alt+W.
  const width = async () => (await terminal.boundingBox())!.width
  const before = await width()
  await page.keyboard.press("Control+Alt+KeyR")
  await expect.poll(width).not.toBe(before)
  await expect(
    terminal.locator('header button[title^="Close"]')
  ).toHaveAttribute("title", "Close (Ctrl+Alt+W)")
})

test("a server started in a terminal shows on the bar, opens in a browser Pane and stops", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = terminalTile(page).getByRole("region", {
    name: "Terminal screen",
  })
  await expect(screen).toHaveAttribute("data-state", "running")
  await screen.click()
  await page.keyboard.type(
    `node -e "require('http').createServer((q, s) => s.end('served')).listen(0, '127.0.0.1', function () { console.log(' port ' + this.address().port + ' ') })" > served.txt 2>&1`
  )
  await page.keyboard.press("Enter")
  const served = join(dir, "root", "Work", "served.txt")
  await expect.poll(() => read(served)).toMatch(/ port \d+ /)
  const port = read(served)!.match(/ port (\d+) /)![1]!

  // The bar says its port, and its list who started it.
  const bar = page.getByRole("banner")
  const widget = bar.getByRole("button", { name: `Servers: localhost:${port}` })
  await expect(widget).toHaveText(`:${port}`)
  await widget.click()
  const row = page.getByRole("menuitem", {
    name: new RegExp(`^localhost:${port}`),
  })
  await expect(row).toContainText("Terminal · node -e")
  await page.screenshot({ path: "test-results/26-servers.png" })
  await row.click()
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue(
    new RegExp(`^localhost:${port}/?$`)
  )

  // Its square stops it, and the bar has nothing more to say.
  await widget.click()
  await row.hover()
  await row.getByRole("button", { name: `Stop localhost:${port}` }).click()
  await expect(widget).toBeHidden()
})

/** A terminal's tile: its title follows what runs in it. */
function terminalTile(page: Page): Locator {
  return page.locator("section[data-tile]").filter({
    has: page.getByRole("region", { name: "Terminal screen" }),
  })
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test("a Person chooses the model and the mode under the message box", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  // A shield beside the send button names the mode, and the model picker
  // the model and its effort, once the Harness offered them (ADR 0031).
  const mode = (name: string) =>
    thread.getByRole("button", { name: `Mode: ${name}` })
  const model = (name: string) =>
    thread.getByRole("button", { name: `Model: ${name}` })

  await expect(mode("Full access")).toBeVisible()
  await expect(thread.getByRole("button", { name: /^Model:/ })).toBeHidden()
  await composer.fill("which settings")
  await composer.press("Enter")
  await expect(
    thread.getByText("Mode bypassPermissions, model fast, brief false")
  ).toBeVisible()

  // The Harness offered its options with its first turn. The picker
  // opens on the effort; the model's name opens the models.
  await model("Fast, Medium").click()
  const effort = page.getByRole("slider", { name: "Effort" })
  await expect(effort).toHaveAttribute("aria-valuetext", "Medium")
  await page.getByRole("button", { name: "Models" }).click()
  // A row is named by its model alone: the logo beside it only decorates.
  await page.getByRole("option", { name: "Smart", exact: true }).click()
  await expect(model("Smart, Medium")).toBeVisible()
  await model("Smart, Medium").click()
  await effort.focus()
  await effort.press("End")
  await expect(model("Smart, Max")).toBeVisible()
  const fast = page.getByRole("button", { name: "Fast mode" })
  await fast.click()
  await expect(fast).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: "test-results/6-effort.png" })
  await page.keyboard.press("Escape")

  await mode("Full access").click()
  await page.getByRole("menuitemradio", { name: /Supervised/ }).click()
  await mode("Supervised").click()
  const brief = page.getByRole("menuitemcheckbox", { name: "Brief" })
  await brief.click()
  await expect(brief).toHaveAttribute("aria-checked", "true")
  await page.screenshot({ path: "test-results/6-modes.png" })
  await page.keyboard.press("Escape")
  await composer.fill("which settings now")
  await composer.press("Enter")
  await expect(
    thread.getByText("Mode default, model smart, brief true")
  ).toBeVisible()
  await composer.fill("which effort")
  await composer.press("Enter")
  await expect(thread.getByText("Effort max, fast true")).toBeVisible()

  // Plan shows only while it is on.
  const planMode = thread.getByRole("button", { name: "Plan", exact: true })
  await expect(planMode).toBeHidden()
  await composer.press("Shift+Tab")
  await expect(planMode).toBeVisible()
  await composer.fill("which settings in a plan")
  await composer.press("Enter")
  // A reply in plan mode is the plan.
  await expect(
    thread.getByRole("group", { name: "Proposed plan" })
  ).toContainText("Mode plan, model smart, brief true")
  await composer.fill("plan done")
  await composer.press("Enter")
  await expect(thread.getByText("The plan is ready.")).toBeVisible()
  await expect(mode("Auto-accept edits")).toBeVisible()
  await expect(planMode).toBeHidden()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/7-after-the-plan.png" })
})

test("a new Thread's Harness is chosen with its model", async () => {
  window = await startWindow({ other: true })
  const { page } = window
  await firstThread(page)
  // The tile, by its title: the box is named for the Harness it writes to.
  const thread = page.getByRole("region", { name: "New Thread" })
  // Before any Thread ran, each Harness is a row of its own.
  await thread.getByRole("button", { name: "Model: Fake AI" }).click()
  const models = page.getByRole("listbox", { name: "Model" })
  await expect(
    models.getByRole("option", { name: "Fake AI", selected: true })
  ).toBeVisible()
  await models.getByRole("option", { name: "Other AI" }).click()
  const toOther = thread.getByRole("textbox", { name: "Message to Other AI" })
  await expect(toOther).toBeVisible()
  await toOther.fill("hello")
  await toOther.press("Enter")
  await expect(page.getByText("You said: hello")).toBeVisible()

  // Once a Thread ran on it, a Harness's models are under its name.
  await page.keyboard.press("Alt+Enter")
  const next = page.getByRole("region", { name: "New Thread" })
  await next.getByRole("button", { name: "Model: Fake AI" }).click()
  const other = page
    .getByRole("listbox", { name: "Model" })
    .getByRole("group", { name: "Other AI" })
  await expect(other.getByRole("option")).toHaveText(["Fast", "Smart"])
  await expect(other).toBeVisible()
  await page.screenshot({ path: "test-results/6-every-harness.png" })
  await other.getByRole("option", { name: "Smart" }).click()
  await expect(
    next.getByRole("button", { name: "Model: Smart, Medium" })
  ).toBeVisible()
  const message = next.getByRole("textbox", { name: "Message to Other AI" })
  await message.fill("which settings")
  await message.press("Enter")
  await expect(
    page.getByText(/Mode bypassPermissions, model smart/)
  ).toBeVisible()
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
  await expect(question).toBeHidden()
  // Answered, it is one line, its answers opening from it.
  await thread.getByRole("button", { name: "Answered: Which colour?" }).click()
  await expect(thread.getByText("Colour", { exact: true })).toBeVisible()

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
  await expect(planMode).toBeVisible()
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
  await expect(planMode).toBeHidden()
  await expect(ready).toBeHidden()
})

test("a plan Claude Code asks to carry out shows in its card, answered on the composer", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer, planMode } = await planning(page)

  // The fake agent asks to leave plan mode with its plan, as Claude Code
  // does: the plan is the card, its answers on the composer.
  await composer.fill("propose")
  await composer.press("Enter")
  const proposed = thread.getByRole("group", { name: "Proposed plan" })
  await expect(
    proposed.getByRole("heading", { name: "Tidy the notes" })
  ).toBeVisible()
  await expect(proposed).toContainText("Sort them.")
  await expect(proposed).toContainText("Waiting for you: Approve Plan")
  await page.screenshot({ path: "test-results/7c-plan-asked.png" })
  await thread
    .getByRole("group", { name: "Approve Plan" })
    .getByRole("button", { name: "Yes, manually approve edits" })
    .click()
  await expect(thread.getByText("The notes are tidy.")).toBeVisible()
  await expect(proposed).toContainText("You chose: Yes, manually approve edits")
  // The Thread follows the Harness out of plan mode; nothing waits.
  await expect(planMode).toBeHidden()
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
    /^Answer above, or write to say no/
  )
  await composer.fill("something else instead")
  await composer.press("Enter")
  await expect(
    thread.getByText("You said: something else instead")
  ).toBeVisible()
  await openWork(thread)
  await expect(thread.getByText("I did not run the check.")).toBeVisible()
})

test("a Question's keys answer it from the composer: Esc says no, Enter allows", async () => {
  window = await startWindow()
  const { thread, composer } = await firstThread(window.page)

  await composer.fill("please ask first")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "Run a check" })
  await expect(question).toBeVisible()
  await composer.press("Escape")
  await expect(question).toBeHidden()
  await openWork(thread)
  await expect(thread.getByText("Declined: Run a check")).toBeVisible()

  // Asked again, Enter in the empty composer gives the main answer.
  await composer.fill("please ask first")
  await composer.press("Enter")
  await expect(question).toBeVisible()
  await composer.press("Enter")
  await expect(thread.getByText("The check passed.")).toBeVisible()
  await expect(question).toBeHidden()
})

test("a tool call opens on what it changed and what it printed", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)

  await composer.fill("edit the notes")
  await composer.press("Enter")
  await expect(thread.getByText("I edited notes.md.")).toBeVisible()
  await openWork(thread)
  // In the past tense once done (ADR 0058, decision 4).
  const edit = thread.getByRole("button", { name: /Edited notes\.md/ })
  await expect(edit).toHaveText(/\+2\s*−1/)
  await edit.click()
  const change = thread.locator("[data-slot=diff]")
  await expect(change).toBeVisible()
  await expect(change.locator("[data-kind=removed]")).toHaveText("−two")
  await expect(change.locator("[data-kind=added]")).toHaveText(["+2", "+four"])

  // Under the reply, the turn's changed files; one opens the Diff beside
  // the Thread, on that turn and open at that file (ADR 0034).
  const changed = thread.getByRole("region", { name: "Changed files" })
  // A card with a verb (ADR 0058, decision 7).
  await expect(changed).toContainText("Edited 1 file")
  await changed.getByRole("button", { name: /notes\.md/ }).click()
  const diff = page.getByRole("region", { name: "Diff" })
  const scope = diff.getByRole("button", { name: "Scope" })
  await expect(scope).toHaveText("edit the notes")
  await expect(diff.getByText("two", { exact: true })).toBeVisible()
  await page.screenshot({ path: "test-results/10-diff-pane.png" })
  // Its menu offers the Thread's turns that changed files.
  await scope.click()
  await page.getByRole("menuitem", { name: "Turns" }).hover()
  await expect(
    page.getByRole("menuitem", { name: /edit the notes/ })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await diff.getByRole("button", { name: "Close Diff" }).click()

  await composer.fill("run the tests")
  await composer.press("Enter")
  await expect(thread.getByText("The tests passed.")).toBeVisible()
  await openWork(thread)
  await thread.getByRole("button", { name: /Ran the tests/ }).click()
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
  await expect(plan.getByText("3 of 3", { exact: true })).toBeVisible()
  await expect(plan.getByRole("listitem")).toHaveText([
    /Read the notes/,
    /Fix the typo/,
    /Check the result/,
  ])
  // How full the context is shows from half full (ADR 0031).
  const meter = thread.getByRole("meter", { name: "Context used" })
  await expect(meter).toBeHidden()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: "test-results/11-plan.png" })
  await composer.fill("later")
  await composer.press("Enter")
  await expect(meter).toHaveAttribute("aria-valuetext", /^75% of the context/)
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
  ).toBeVisible()
  await expect(composer).toBeFocused()

  await composer.fill("/default")
  await expect(commands).toBeVisible()
  await composer.press("Escape")
  await expect(commands).toBeHidden()
  await composer.press("Enter")
  await expect(composer).toHaveText("")
  await expect(
    thread.getByRole("button", { name: "Plan", exact: true })
  ).toBeHidden()
  await expect(thread.getByText("You said: /default")).toBeHidden()

  // A command starts any line, not only the message.
  await composer.pressSequentially("first")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("/rev")
  await expect(commands).toBeVisible()
  await composer.press("Enter")
  await expect(composer.locator("p")).toHaveText(["first", "/review"])
})

test("a message names a skill its Agent has with $, anywhere in it", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const skills = thread.getByRole("listbox", { name: "Skills" })

  // Before its Harness says its skills, `$` is text, as in a price, and a
  // draft's name of one stays text.
  await composer.pressSequentially("costs $")
  await expect(skills).toBeHidden()
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    "Write to Fake AI. @ files, / commands, $ skills"
  )

  // Its skills are not slash commands.
  await composer.fill("/")
  await expect(
    thread.getByRole("listbox", { name: "Slash commands" }).getByRole("option")
  ).not.toContainText(["$explain"])

  await composer.fill("")
  await composer.pressSequentially("then $exp")
  await expect(skills.getByRole("option")).toHaveText([/^\$explain/])
  await expect(skills).toContainText("Explain the code it is pointed at")
  await page.screenshot({ path: "test-results/12-skills.png" })
  await composer.press("Enter")
  await expect(skills).toBeHidden()
  const chip = composer.locator('[data-chip="skill"]')
  await expect(chip).toHaveText("explain")
  await composer.pressSequentially("this")
  await composer.press("Enter")
  await expect(thread.getByText("You said: then $explain this")).toBeVisible()

  // A skill's name pasted is a chip, as a file's path is.
  await composer.evaluate((box) => {
    const data = new DataTransfer()
    data.setData("text/plain", "$explain again")
    const paste = { clipboardData: data, bubbles: true, cancelable: true }
    box.dispatchEvent(new ClipboardEvent("paste", paste))
  })
  await expect(chip).toHaveText("explain")
  await expect(composer).toHaveText("explain again")
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

  // Any other file is kept in the Project and named, as when dropped.
  await files.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  })
  await expect(composer.locator("[data-chip=file]")).toContainText("notes.txt")

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

  // An image added waits in the Thread's draft, as its text does, and
  // comes back with the window.
  await files.setInputFiles(shot)
  await expect(waiting.getByRole("img", { name: "shot.png" })).toBeVisible()
  await composer.fill("kept")
  await page.reload()
  await expect(composer).toHaveText("kept")
  await expect(waiting.getByRole("img", { name: "shot.png" })).toBeVisible()

  // An image alone is a message too.
  await composer.press("ControlOrMeta+a")
  await composer.press("Backspace")
  await expect(composer).toHaveText("")
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
  // fill("") can leave the text, the editor's selection behind the page's.
  await composer.press("ControlOrMeta+a")
  await composer.press("Backspace")
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
  const tool = thread.getByRole("button", { name: /Ran the tests/ })
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

test("@ names a file in the Project's folder, picked from a list", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const project = join(dir, "root", "Work")
  mkdirSync(join(project, "src"), { recursive: true })
  writeFileSync(join(project, "src", "main.ts"), "")
  writeFileSync(join(project, "notes.md"), "")

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
  // Undo brings it back with what it pointed at, and redo takes it again.
  await composer.press("ControlOrMeta+z")
  await expect(chip).toHaveAttribute("title", "src/main.ts")
  await composer.press("ControlOrMeta+Shift+z")
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

test("markdown is styled as it is typed, and sent as it was written", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)

  // A pair of delimiters styles what is between them as it closes.
  await composer.pressSequentially("make **this** bold, `npm i` code and ")
  await expect(composer.locator("strong")).toHaveText("this")
  await expect(composer.locator("code")).toHaveText("npm i")
  // Mod+B writes bold from here on, until it is pressed again; a name with
  // _ in it stays as it is.
  await composer.pressSequentially("snake_case_name ")
  await composer.press("ControlOrMeta+b")
  await composer.pressSequentially("this too")
  await composer.press("ControlOrMeta+b")
  await composer.pressSequentially("!")
  await expect(composer.locator("strong")).toHaveText(["this", "this too"])
  await page.screenshot({ path: "test-results/18f-markdown.png" })
  // It is sent as the markdown it was written as.
  await composer.press("Enter")
  const written =
    "make **this** bold, `npm i` code and snake_case_name **this too**!"
  await expect(thread.getByText(written, { exact: true })).toBeVisible()

  // Walked back to, it is styled again.
  await composer.press("ArrowUp")
  await expect(composer.locator("strong")).toHaveText(["this", "this too"])
  await expect(composer.locator("code")).toHaveText("npm i")
})

test("a line's start makes it a heading, a list, a task, a quote or a rule", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const items = composer.locator("[data-item]")

  await composer.pressSequentially("# Plan")
  await expect(composer.locator("h1")).toHaveText("Plan")
  // After a heading comes text; a list goes on with Shift+Enter, and an
  // empty item ends it, the line text again.
  await composer.press("Shift+Enter")
  await composer.pressSequentially("- one")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("two")
  await expect(items).toHaveText(["•one", "•two"])
  await composer.press("Shift+Enter")
  await composer.press("Shift+Enter")
  // Numbers go on; Tab takes an item in.
  await composer.pressSequentially("1. first")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("second")
  await expect(items.nth(3)).toHaveText("2.second")
  await composer.press("Shift+Enter")
  await composer.press("Shift+Enter")
  // A task's box ticks with a click.
  await composer.pressSequentially("- [ ] ship it")
  const box = composer.getByRole("checkbox", { name: "To do" })
  await box.click()
  await expect(composer.getByRole("checkbox", { name: "Done" })).toBeChecked()
  await composer.press("End")
  await composer.press("Shift+Enter")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("> said so")
  await expect(composer.locator("blockquote")).toHaveText("said so")
  await composer.press("Shift+Enter")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("---")
  await expect(composer.locator("hr")).toHaveCount(1)
  await composer.pressSequentially("end")
  await page.screenshot({ path: "test-results/18g-blocks.png" })

  // It is sent as the markdown it was written as.
  await composer.press("Enter")
  const written = [
    "# Plan",
    "- one",
    "- two",
    "1. first",
    "2. second",
    "- [x] ship it",
    "> said so",
    "---",
    "end",
  ].join("\n")
  const said = thread.locator("[data-slot=bubble]").filter({ hasText: "Plan" })
  await expect(said).toHaveJSProperty("textContent", written)

  // Backspace at an item's start makes it text again.
  await composer.pressSequentially("- gone")
  await composer.press("Home")
  // Keys outrun the selection's news to the editor; let it arrive.
  await page.evaluate(() => new Promise((done) => setTimeout(done)))
  await composer.press("Backspace")
  await expect(items).toHaveCount(0)
  await expect(composer.locator("p")).toHaveText("gone")
})

test("``` and Enter starts code: coloured, its language picked, left by its fence", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  const block = composer.locator("[data-code]")

  await composer.pressSequentially("```ts")
  await composer.press("Enter")
  await expect(block).toHaveCount(1)
  const language = composer.getByRole("combobox", { name: "Language" })
  await expect(language).toHaveValue("typescript")
  // In code, Enter starts a line as far in as the one before; Shift+Tab
  // moves it out.
  await composer.pressSequentially("if (a) {")
  await composer.press("Enter")
  await composer.pressSequentially("  go()")
  await composer.press("Enter")
  await composer.pressSequentially("}")
  await composer.press("Shift+Tab")
  // Shiki colours it.
  await expect(block.locator("span[style*='--sdm-c']").first()).toBeVisible()
  // Enter after the closing fence leaves the code.
  await composer.press("Enter")
  await composer.pressSequentially("```")
  await composer.press("Enter")
  await composer.pressSequentially("done")
  await language.selectOption("python")
  await page.screenshot({ path: "test-results/18h-code.png" })

  await composer.getByText("done").click()
  await composer.press("End")
  await composer.press("Enter")
  const written = "```python\nif (a) {\n  go()\n}\n```\ndone"
  const said = thread.locator("[data-slot=bubble]").filter({ hasText: "go()" })
  await expect(said).toHaveJSProperty("textContent", written)
})

test("typed over chosen text, * styles it and ( goes round it; Shift+Tab takes an item out, then is plan mode's", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const project = join(dir, "root", "Work", "src")
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, "main.ts"), "")
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  // Keys outrun the selection's news to the editor; let it arrive.
  const settle = () =>
    page.evaluate(() => new Promise((done) => setTimeout(done)))
  const choose = async (
    start: "Home" | "End",
    move: number,
    length: number
  ) => {
    await composer.press(start)
    const away = start === "Home" ? "ArrowRight" : "ArrowLeft"
    for (let at = 0; at < move; at += 1) await composer.press(away)
    for (let at = 0; at < length; at += 1) await composer.press(`Shift+${away}`)
    await settle()
  }

  await composer.pressSequentially("say word now")
  await choose("Home", 4, 4)
  await composer.press("*")
  await expect(composer.locator("em")).toHaveText("word")
  // Again, and it is bold.
  await composer.press("*")
  await expect(composer.locator("strong")).toHaveText("word")
  await expect(composer.locator("em")).toHaveCount(0)
  await choose("End", 0, 3)
  await composer.press("(")
  await expect(composer.locator("p")).toHaveText("say word (now)")

  // In a list, Shift+Tab takes an item out; at the start, it is plan
  // mode's, as everywhere else.
  await composer.press("End")
  await settle()
  await composer.press("Shift+Enter")
  await composer.pressSequentially("- item")
  const item = composer.locator("[data-item]")
  await composer.press("Tab")
  await expect(item).toHaveCSS("padding-inline-start", /^[1-9]/)
  await composer.press("Shift+Tab")
  await expect(item).toHaveCSS("padding-inline-start", "0px")
  const planMode = thread.getByRole("button", { name: "Plan", exact: true })
  await expect(planMode).toBeHidden()
  await composer.press("Shift+Tab")
  await expect(planMode).toBeVisible()
  // With a file's name being typed, Tab picks it, as the list says.
  await composer.pressSequentially(" @mai")
  const files = page.getByRole("listbox", { name: "Files" })
  await expect(files.getByRole("option")).toHaveCount(1)
  await composer.press("Tab")
  await expect(composer.locator("[data-chip=file]")).toHaveText("main.ts")
  await expect(item).toHaveCSS("padding-inline-start", "0px")
  await page.screenshot({ path: "test-results/18i-wrap.png" })

  await composer.press("Enter")
  const said = thread.locator("[data-slot=bubble]").filter({ hasText: "item" })
  await expect(said).toHaveJSProperty(
    "textContent",
    "say **word** (now)\n- item @src/main.ts "
  )
})

test("the box behaves: words typed or pasted in the Thread reach it, a long message waits, an IME's Enter is its own", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toHaveAttribute(
    "aria-placeholder",
    /^Write to Fake AI\. @ files, \/ commands$/
  )
  await composer.fill("hello")
  await composer.press("Enter")
  const said = thread.getByText("You said: hello")
  await expect(said).toBeVisible()

  // A key typed after a click in the Thread goes into the box, and so
  // does text pasted there.
  await said.click()
  await expect(composer).not.toBeFocused()
  await page.keyboard.type("more")
  await expect(composer).toBeFocused()
  await expect(composer).toHaveText("more")
  await said.click()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData("text/plain", " words")
    const paste = { clipboardData: data, bubbles: true, cancelable: true }
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", paste))
  })
  await expect(composer).toHaveText("more words")

  // Enter while an IME composes is the IME's.
  await composer.evaluate((field) =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      })
    )
  )
  await expect(composer).toHaveText("more words")

  // A message longer than a Harness takes says so, and is not sent.
  await composer.fill("x".repeat(120_001))
  const long = page.getByRole("alert").filter({ hasText: "limit" })
  await expect(long).toHaveText(
    "The message is 1 character over the 120,000-character limit. Shorten or split it before sending."
  )
  await expect(thread.getByRole("button", { name: "Send" })).toBeDisabled()
  await composer.press("End")
  await composer.press("Backspace")
  await expect(long).toBeHidden()
  await composer.fill("more words")
  await composer.press("Enter")
  await expect(thread.getByText("You said: more words")).toBeVisible()
})

test("a file dropped is kept and named in the message, a long paste is a file, and Mod+Shift+V pastes it as text", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  const said = thread.getByText("You said: hello")
  await expect(said).toBeVisible()

  // A file dropped on the Thread is kept in the Project and named, as `@`
  // names a file.
  await said.evaluate((where) => {
    const data = new DataTransfer()
    data.items.add(
      new File(["# notes"], "my notes.md", { type: "text/markdown" })
    )
    const drop = { dataTransfer: data, bubbles: true, cancelable: true }
    where.dispatchEvent(new DragEvent("dragover", drop))
    where.dispatchEvent(new DragEvent("drop", drop))
  })
  const chips = composer.locator("[data-chip=file]")
  await expect(chips).toHaveText(["my-notes.md"])
  const path = await chips.first().getAttribute("title")
  // In the Project's data, not its folder (ADR 0026).
  expect(path!.startsWith(join(dir, "data", "projects"))).toBe(true)
  expect(path).toMatch(/\/files\/[^/]+\/my-notes\.md$/)
  expect(readFileSync(path!, "utf8")).toBe("# notes")

  // A text of 32 KiB or more pasted is kept as a file; Mod+Shift+V
  // pastes it as text.
  const long = "word ".repeat(7000)
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), long)
  await composer.press("ControlOrMeta+v")
  await expect(chips).toHaveText(["my-notes.md", "pasted-text-1.txt"])
  const pasted = await chips.nth(1).getAttribute("title")
  expect(readFileSync(pasted!, "utf8")).toBe(long)
  await composer.press("ControlOrMeta+Shift+v")
  await expect
    .poll(async () => (await composer.textContent())?.length ?? 0)
    .toBeGreaterThan(long.length - 10)
  await expect(chips).toHaveCount(2)
  // The next is named on from those the message names.
  await composer.press("ControlOrMeta+v")
  await expect(chips.nth(2)).toHaveText("pasted-text-2.txt")
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

test("an Agent starts a Thread, its answer comes back, and each names the other's Thread, which opens it", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()

  // The Agent of "hello" calls `send`, as its Harness would.
  await agentSays(window, "send", { harness: "fake", text: "look around" })
  const answer = thread.getByRole("button", {
    name: "Answered by look around",
  })
  await expect(answer).toBeVisible()
  await page.screenshot({ path: "test-results/18j-answer-from.png" })
  await answer.click()
  const asked = page.getByRole("region", { name: "look around" })
  await asked.getByRole("button", { name: "Asked by hello" }).click()
  const hello = page.getByRole("region", { name: "hello" })
  await expect(hello).toHaveAttribute("data-focused", "true")
})

test("an Agent shows a Visual in its Thread: its page runs apart from Banda, in the look's colours, as tall as it is", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("wait")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()

  // A page with a script, the look's colour, and a height of its own.
  const html = `<!doctype html><html><head><style>
    .box { height: 260px; background: var(--primary); border-radius: var(--radius) }
  </style></head><body><div class="box"></div><p id="said">…</p><script>
    let cookies = "cookies"
    try { document.cookie } catch { cookies = "no cookies" }
    document.getElementById("said").textContent =
      "ran, " + typeof window.bandaEngine + ", " + cookies
  </script></body></html>`
  // The frame's height as it first shows, before its page loads.
  await page.evaluate(() => {
    const seen = new MutationObserver(() => {
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[title="A mockup"]'
      )
      if (!frame) return
      ;(globalThis as { firstHeight?: string }).firstHeight = frame.style.height
      seen.disconnect()
    })
    seen.observe(document.body, { childList: true, subtree: true })
  })
  const said = await agentSays(window, "show_visual", {
    html,
    title: "A mockup",
    height: 120,
  })
  expect(said).toContain("Shown to your Person above your reply.")

  const frame = thread.locator('iframe[title="A mockup"]')
  await expect(frame).toBeVisible()
  const inside = frame.contentFrame()
  await expect(inside.locator("#said")).toHaveText("ran, undefined, no cookies")
  // It is an origin of its own, sandboxed: opaque to Banda's page.
  expect(await inside.locator("html").evaluate(() => origin)).toBe("null")
  // The look's primary colour, as Banda's page has it.
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim()
  )
  const painted = await inside
    .locator(".box")
    .evaluate((box) =>
      getComputedStyle(box).getPropertyValue("--primary").trim()
    )
  expect(painted).toBe(primary)
  // The frame fits the page, not the height the Agent guessed: from its
  // first paint, as the window laid it out at the frame's width.
  await expect
    .poll(async () => (await frame.boundingBox())?.height ?? 0)
    .toBeGreaterThan(280)
  const first = await page.evaluate(
    () => (globalThis as { firstHeight?: string }).firstHeight
  )
  expect(parseInt(first ?? "0")).toBeGreaterThan(280)
  await page.screenshot({ path: "test-results/18m-visual.png" })
})

test("a Visual opens over the window, zoomed, or as a Pane of its own beside its Thread", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("wait")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()
  const html = `<!doctype html><html><head><style>
    .box { height: 200px; background: var(--chart-1); border-radius: var(--radius) }
  </style></head><body><div class="box"></div></body></html>`
  await agentSays(window, "show_visual", { html, title: "Sales", height: 200 })

  const shown = thread.locator("figure").filter({
    has: page.locator('iframe[title="Sales"]'),
  })
  await expect(shown.locator("figcaption")).toHaveText("Sales")
  // Its ways to open it larger show on hover, and to the keyboard (the
  // test's window has no pointer that hovers).
  const preview = shown.getByRole("button", { name: "Preview" })
  const tools = preview.locator("..")
  await expect(tools).toHaveCSS("opacity", "0")
  const frame = shown.locator('iframe[title="Sales"]')
  await expect(frame.contentFrame().locator(".box")).toBeVisible()
  const before = await frame.boundingBox()
  await preview.focus()
  await expect(tools).toHaveCSS("opacity", "1")
  // The controls sit above the HTML, never covering its first content.
  // Revealing them does not move or resize the page.
  const controls = await tools.boundingBox()
  const after = await frame.boundingBox()
  expect(controls).not.toBeNull()
  expect(after).toEqual(before)
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(after!.y)
  await page.screenshot({ path: "test-results/18o-visual-hover.png" })

  // Preview: over the window, zoomed as a browser zooms.
  await preview.click()
  const over = page.getByRole("dialog", { name: "Sales" })
  const big = over.locator('iframe[title="Sales"]')
  await expect(big.contentFrame().locator(".box")).toBeVisible()
  // As wide as it lays out, which the dialog's opening scale leaves be.
  const wide = await big.evaluate((frame) => frame.clientWidth)
  await over.getByRole("button", { name: "Zoom in" }).click()
  await expect(over.getByText("110 %")).toBeVisible()
  await page.keyboard.press("Control+Equal")
  await expect(over.getByText("125 %")).toBeVisible()
  // Laid out narrower, drawn larger: as wide as before on screen.
  const zoomed = await big.evaluate((frame) => ({
    laid: frame.clientWidth,
    drawn: frame.getBoundingClientRect().width,
  }))
  expect(zoomed.laid).toBeCloseTo(wide / 1.25, -1)
  expect(zoomed.drawn).toBeCloseTo(wide, -1)
  await page.screenshot({ path: "test-results/18p-visual-preview.png" })
  // In its page too, the keys are the preview's.
  await big.contentFrame().locator(".box").click()
  // Transient user activation expires after five seconds.
  await page.waitForTimeout(5_100)
  await page.keyboard.press("Control+Minus")
  await expect(over.getByText("110 %")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(over).toBeHidden()

  // Open as Pane: a Pane of its own, beside the Thread, once.
  await shown.getByRole("button", { name: "Open as Pane" }).click()
  const pane = page.locator("section[data-tile]").filter({
    has: page.getByRole("heading", { name: "Sales" }),
  })
  await expect(pane).toHaveCount(1)
  await expect(
    pane.locator('iframe[title="Sales"]').contentFrame().locator(".box")
  ).toBeVisible()
  await page.screenshot({ path: "test-results/18q-visual-pane.png" })
})

test("an Agent checks a Visual before it shows: its picture, its height and its console, in a window never shown", async () => {
  window = await startWindow()
  const { page, app } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const windows = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const before = await windows()

  const html = `<!doctype html><html><head><style>
    .box { height: 300px; background: var(--primary) }
  </style></head><body><div class="box"></div><script>
    console.log("only said")
    console.warn("careful")
    console.error("boom")
    nope()
  </script></body></html>`
  const said = await agentCalls(window, "preview_visual", {
    html,
    width: 390,
    appearance: "dark",
  })
  expect(said.isError, said.content[0]?.text).toBeFalsy()
  const [text, picture] = said.content as {
    type: string
    text?: string
    data?: string
    mimeType?: string
  }[]
  const checked = JSON.parse(text!.text!)
  expect(checked.width).toBe(390)
  // The box and the 8px gutter above and below it.
  expect(checked.height).toBe(316)
  expect(checked.console.map((line: { level: string }) => line.level)).toEqual([
    "warning",
    "error",
    "error",
  ])
  expect(checked.console[2].text).toContain("nope is not defined")
  expect(picture).toMatchObject({ type: "image", mimeType: "image/png" })
  const png = Buffer.from(picture!.data!, "base64")
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  writeFileSync("test-results/18n-visual-checked.png", png)
  // The picture is as wide as asked and as tall as the page.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([390, 316])
  // A local image goes into the page, and loads there.
  const dot = join(window.dir, "dot.png")
  writeFileSync(
    dot,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOImHkHAAOAAg7PaQnHAAAAAElFTkSuQmCC",
      "base64"
    )
  )
  const inlined = await agentCalls(window, "preview_visual", {
    html: `<!doctype html><img src="${dot}" onload="console.warn('loaded ' + this.src.slice(0, 22))">`,
  })
  const loaded = JSON.parse(inlined.content[0]!.text)
  expect(loaded.console).toEqual([
    { level: "warning", text: "loaded data:image/png;base64," },
  ])
  expect(loaded.unread_images).toBeUndefined()
  // An image the page names that is not there is said; a page sized by
  // its frame is refused, with why.
  const gone = await agentCalls(window, "preview_visual", {
    html: '<!doctype html><img src="/nowhere/gone.png" alt="">',
  })
  expect(JSON.parse(gone.content[0]!.text).unread_images).toEqual([
    "/nowhere/gone.png: not found",
  ])
  const tall = await agentCalls(window, "preview_visual", {
    html: '<!doctype html><div style="height: 100vh"></div>',
  })
  expect(tall.isError).toBe(true)
  expect(tall.content[0]!.text).toContain("grow again and again")
  // The window it took is gone, and the Thread shows nothing.
  expect(await windows()).toBe(before)
  await expect(thread.locator("iframe")).toHaveCount(0)
})

test("an Agent opens a Pane beside its Thread without the focus, marked until the Person looks, and closes it", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const hello = page.getByRole("region", { name: "hello" })
  await expect(hello).toHaveAttribute("data-focused", "true")

  // It sees its Project's Panes, with what they show; it opened none.
  const seen = await agentAnswers(window, "panes", {})
  const mine = seen[0].columns[0].panes[0]
  expect(mine).toMatchObject({ kind: "agents.thread", yours: false })

  // A browser at a web address, as its tool says: its one tab shows it.
  const site = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<title>The Agent's page</title><p>Look</p>")
  })
  await new Promise<void>((done) => site.listen(0, "127.0.0.1", done))
  const port = (site.address() as AddressInfo).port
  const browser = {
    kind: "browser.browser",
    args: { url: `http://127.0.0.1:${port}/` },
  }
  const beside = { pane: mine.id, side: "right" }
  const { pane } = await agentAnswers(window, "open_pane", {
    ...browser,
    beside,
  })
  const opened = page.locator(`[data-tile="${pane}"]`)
  await expect(opened).toHaveAttribute("data-marked", "true")
  await expect(opened.getByText("The Agent's page")).toBeVisible()
  await expect(hello).toHaveAttribute("data-focused", "true")
  await page.screenshot({ path: "test-results/18l-agent-opened.png" })
  // A terminal would run as the Person: not an Agent's to open.
  const terminal = await agentCalls(window, "open_pane", {
    kind: "terminal.terminal",
    args: {},
  })
  expect(terminal.isError).toBe(true)
  // Nor is the Person's Pane its to close.
  expect(
    (await agentCalls(window, "close_pane", { pane: mine.id })).isError
  ).toBe(true)

  // Its page covers the tile; its tab is the tile's own.
  await opened.getByText("The Agent's page").click()
  await expect(opened).toHaveAttribute("data-focused", "true")
  await expect(opened).not.toHaveAttribute("data-marked")
  await agentAnswers(window, "close_pane", { pane })
  await expect(opened).toHaveCount(0)
  await expect(hello).toBeVisible()
  site.close()
})

test("an answer that comes while its Thread works waits in the queue, named by the Thread it comes from", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  // The Thread works on, so what comes into it waits its turn.
  await composer.fill("wait here")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()

  await agentSays(window, "send", { harness: "fake", text: "look around" })
  const queue = thread.getByRole("list", { name: "Waiting messages" })
  const answer = queue.getByRole("button", { name: "Answered by look around" })
  await expect(answer).toBeVisible()
  await page.screenshot({ path: "test-results/18k-answer-waits.png" })
  await answer.click()
  const asked = page.getByRole("region", { name: "look around" })
  await expect(asked).toHaveAttribute("data-focused", "true")
})

test("the sidebar is arranged by sidebar.toml, and its view menu writes the file", async () => {
  window = await startWindow({ sidebar: '# mine\npreset = "projects"\n' })
  const { page, dir } = window
  const file = join(dir, "config/sidebar.toml")
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const view = sidebar.getByRole("button", { name: /^View: / })
  await expect(view).toHaveAccessibleName("View: projects")
  // Each Project a section: the row sits under its Project's name.
  const work = sidebar.getByRole("group", { name: "Work" })
  await expect(work.getByRole("button", { name: /hello/ })).toBeVisible()
  await page.screenshot({ path: "test-results/22-sidebar-projects.png" })

  // The menu writes the preset into the file and keeps the rest; the
  // arrangement comes back from the file.
  await view.click()
  await page.getByRole("menuitemradio", { name: /^places/ }).click()
  await expect(view).toHaveAccessibleName("View: places")
  expect(readFileSync(file, "utf8")).toBe('# mine\npreset = "places"\n')
  await expect(sidebar.getByRole("group", { name: "Projects" })).toBeVisible()
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

test("keys.toml binds a key, frees one, and the bar names what is wrong", async () => {
  window = await startWindow({
    files: {
      "config/keys.toml":
        '[binds]\n"Alt+M" = "pane.new"\n"Alt+W" = "none"\n"Alt+J" = "pane.nothing"\n',
    },
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const problem = page.getByRole("status", { name: /^The look: / })
  await expect(problem).toHaveAttribute(
    "aria-label",
    /keys\.toml:4:1: Alt\+J: Banda has no action pane\.nothing/
  )
  // Alt+M opens a Pane, as Alt+N still does.
  await page.keyboard.press("Alt+KeyM")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  // Alt+W is the Pane's now: nothing closes.
  await page.keyboard.press("Alt+KeyW")
  await page.waitForTimeout(300)
  await expect(launcher).toBeVisible()
  await expect(thread).toBeVisible()
})

test("Alt+K is the key sheet: sections and families, and Tab binds or frees a key in keys.toml", async () => {
  window = await startWindow()
  const { page, dir } = window
  const file = join(dir, "config/keys.toml")
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })

  // Every action by section; a family is one row, which Enter goes into.
  await page.keyboard.press("Alt+KeyK")
  for (const section of ["Threads", "Panes", "Columns", "Workspaces", "Banda"])
    await expect(menu.getByRole("group", { name: section })).toBeVisible()
  // Sideways; up and down are the family that goes on past a column.
  const focus = menu.getByRole("option", { name: /^Focus a Pane(?!,)/ })
  await expect(focus).toContainText("←")
  await expect(
    menu.getByRole("option", { name: /^Go to a workspace/ })
  ).toContainText("1–9")
  await page.screenshot({ path: "test-results/36-key-sheet.png" })
  await focus.click()
  await expect(menu.getByRole("option")).toHaveCount(4)
  await search.press("Backspace")

  // Tab, then Add a key: the next key pressed is bound, Alt+K too, and
  // written to keys.toml; the row shows it beside its own.
  await search.fill("column the whole screen")
  await search.press("Tab")
  const acts = menu.getByRole("listbox", { name: "Actions" })
  await acts.getByRole("option", { name: "Add a key…" }).click()
  await expect(search).toHaveAttribute("placeholder", /^Press the keys for/)
  await search.press("KeyM")
  await expect(menu.getByRole("status")).toContainText(
    "hold Alt, Ctrl or Super"
  )
  await search.press("Alt+KeyK")
  await expect(menu.getByRole("status")).toContainText(
    "Alt+K runs “The column the whole screen wide, or back” now, not “Every action and its key”"
  )
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain('"Alt+K" = "column.maximize"')
  await search.fill("column the whole screen")
  const row = menu.getByRole("option").first()
  const keys = row.locator("[data-slot=kbd-group]")
  await expect(keys).toHaveCount(2)
  await expect(keys.last()).toHaveAttribute("title", /^keys\.toml, line \d+$/)

  // Free Alt+K: it goes to the Pane.
  await search.press("Tab")
  await acts.getByRole("option", { name: "Free Alt+K" }).click()
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain('"Alt+K" = "none"')
  await expect(keys).toHaveCount(1)
})

test("columns and the text size come from look.toml", async () => {
  window = await startWindow({
    look: '[columns]\npresets = ["1/4", "3/4"]\ndefault = "1/4"\nalone = "1/4"\nmin = 0\n[font]\nsize = 16\n',
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
    column.evaluate((e: HTMLElement) => {
      // The room beside the sidebar, which floats over the Strip's left.
      const strip = getComputedStyle(e.parentElement!)
      const room =
        e.parentElement!.clientWidth -
        parseFloat(strip.paddingLeft) -
        parseFloat(strip.paddingRight)
      return e.offsetWidth / room
    })
  // A new column opens at the look's default, a quarter.
  await expect.poll(share).toBeLessThan(0.3)
  await page.keyboard.press("Alt+Control+ArrowRight")
  await expect.poll(share).toBeGreaterThan(0.7)
})

test("no column is narrower than columns.min; Alt+R goes round, Alt+F fills", async () => {
  // 50 rem is more than 2/3 of this window's Strip and less than all of it.
  window = await startWindow({
    look: '[columns]\nmin = 50\nalone = "1/2"\n',
  })
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

test("a column alone fills its workspace, and a second halves it", async () => {
  window = await startWindow()
  const { page } = window
  const { thread } = await firstThread(page)
  const shares = () =>
    page.locator("[data-column]").evaluateAll((columns) =>
      columns.map((e) => {
        const strip = e.parentElement!
        const style = getComputedStyle(strip)
        const gap = parseFloat(style.columnGap) || 0
        const room =
          strip.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) +
          gap
        return Math.round((((e as HTMLElement).offsetWidth + gap) / room) * 100)
      })
    )
  await expect.poll(shares).toEqual([100])
  await page.keyboard.press("Alt+KeyN")
  await expect.poll(shares).toEqual([50, 50])
  await page.keyboard.press("Alt+KeyW")
  await expect(thread).toBeVisible()
  await expect.poll(shares).toEqual([100])
})

test("niri's keys: a launcher's letters, heights, the Strip's edges, the room left, the middle and the zoom", async () => {
  // Narrow columns, so a third of this window is a third.
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const launcher = page.getByRole("region", { name: "New Pane" })
  const terminal = terminalTile(page)
  const x = async (tile: Locator) => (await tile.boundingBox())!.x
  const high = async (tile: Locator) => (await tile.boundingBox())!.height

  // Alt+N, then a letter: T makes the launcher a terminal.
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher.locator("kbd", { hasText: "T" })).toBeVisible()
  await page.screenshot({ path: "test-results/4a-launcher-letters.png" })
  await page.keyboard.press("KeyT")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await expect(launcher).toHaveCount(0)

  // Heights, in a column of two: the next, even again, a step lower.
  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+BracketLeft")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const ratio = async () => (await high(launcher)) / (await high(terminal))
  await expect.poll(ratio).toBeCloseTo(1, 1)
  await page.keyboard.press("Alt+Shift+KeyR")
  await expect.poll(ratio).toBeGreaterThan(1.8)
  await page.screenshot({ path: "test-results/4b-heights.png" })
  await page.keyboard.press("Alt+Control+KeyR")
  await expect.poll(ratio).toBeCloseTo(1, 1)
  await page.keyboard.press("Alt+Control+ArrowUp")
  await expect.poll(ratio).toBeLessThan(0.6)
  await page.keyboard.press("Alt+KeyW")
  await expect(launcher).toHaveCount(0)

  // Home and End: the first and the last column; with Shift, there.
  await page.keyboard.press("Alt+Home")
  await expect(thread).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+End")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Shift+Home")
  await expect
    .poll(async () => (await x(terminal)) < (await x(thread)))
    .toBe(true)

  // The room the others leave: the Thread a third, the terminal the rest.
  const shares = () =>
    page.locator("[data-column]").evaluateAll((columns) =>
      columns.map((e) => {
        const strip = e.parentElement!
        const style = getComputedStyle(strip)
        const gap = parseFloat(style.columnGap) || 0
        const room =
          strip.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) +
          gap
        return Math.round((((e as HTMLElement).offsetWidth + gap) / room) * 100)
      })
    )
  await page.keyboard.press("Alt+End")
  await page.keyboard.press("Alt+Control+ArrowLeft")
  await page.keyboard.press("Alt+Home")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Control+KeyF")
  await expect.poll(shares).toEqual([67, 33])

  // Alt+C: the column in the middle of the screen.
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const strip = page.locator("[data-column]").first().locator("xpath=..")
  const scrolled = () => strip.evaluate((element) => element.scrollLeft)
  await page.waitForTimeout(500)
  const least = await scrolled()
  await page.keyboard.press("Alt+KeyC")
  await expect.poll(scrolled).toBeGreaterThan(least + 50)

  // Shift and a letter: one more beside it, and the launcher stays.
  await page.keyboard.press("Shift+KeyH")
  const fresh = page.getByRole("region", { name: "New Thread" })
  await expect(fresh).toHaveAttribute("data-focused", "true")
  await expect(launcher).toHaveCount(1)

  // The zoom: over the whole window, the sidebar away, and back.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const main = page.locator("main")
  await page.keyboard.press("Alt+Shift+KeyF")
  await expect(fresh).toHaveAttribute("data-zoomed", "true")
  await expect(sidebar).toBeHidden()
  await expect(launcher).toBeHidden()
  await expect
    .poll(async () => (await fresh.boundingBox())!.width)
    .toBeCloseTo((await main.boundingBox())!.width, 0)
  await page.screenshot({ path: "test-results/4c-zoom.png" })
  await fresh.getByRole("button", { name: "Zoomed" }).click()
  await expect(fresh).not.toHaveAttribute("data-zoomed")
  await expect(sidebar).toBeVisible()
  // The focus elsewhere brings it back too.
  await page.keyboard.press("Alt+Shift+KeyF")
  await expect(fresh).toHaveAttribute("data-zoomed", "true")
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect(fresh).not.toHaveAttribute("data-zoomed")
})

/** Each column's share of the room, in hundredths, as the Strip draws it. */
function sharesOf(page: Page) {
  return page.locator("[data-column]").evaluateAll((columns) =>
    columns.map((e) => {
      const strip = e.parentElement!
      const style = getComputedStyle(strip)
      const gap = parseFloat(style.columnGap) || 0
      const room =
        strip.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) +
        gap
      return Math.round((((e as HTMLElement).offsetWidth + gap) / room) * 100)
    })
  )
}

/** Where the right edge of the first column is drawn at `at` of the room,
 * the middle of the gap after it, and the room's scale, in pixels. */
async function edgeAt(page: Page, at: number) {
  return page
    .locator("[data-column]")
    .first()
    .evaluate((column, at) => {
      const strip = column.parentElement!
      const style = getComputedStyle(strip)
      const gap = parseFloat(style.columnGap) || 0
      const inner =
        strip.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      const left = column.getBoundingClientRect().left
      return { x: left + at * (inner + gap) - gap / 2, scale: inner + gap }
    }, at)
}

/** Waits until `tiles` stand still: each where and as big as it was. */
async function settled(...tiles: Locator[]) {
  let was = ""
  await expect
    .poll(async () => {
      const boxes = await Promise.all(tiles.map((tile) => tile.boundingBox()))
      const now = JSON.stringify(
        boxes.map((box) => box && [box.x, box.y, box.width, box.height])
      )
      const still = now === was
      was = now
      return still
    })
    .toBe(true)
}

/** A Pane's share of its column's height, in hundredths. */
function heightOf(tile: Locator) {
  return tile.evaluate((element: HTMLElement) => {
    const column = element.parentElement!
    const gap = parseFloat(getComputedStyle(column).rowGap) || 0
    return Math.round(
      ((element.offsetHeight + gap) / (column.clientHeight + gap)) * 100
    )
  })
}

test("the mouse sizes as niri's: the gaps, Alt and the right button, a double click", async () => {
  // Narrow columns, so a third of this window is a third.
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  // The Thread out of its Group, so every gap is the inner one.
  await page.keyboard.press("Alt+Shift+BracketRight")
  await expect(page.locator("[data-group-plate]")).toHaveCount(0)
  const launcher = page.getByRole("region", { name: "New Pane" })
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("KeyT")
  const terminal = terminalTile(page)
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await expect.poll(() => sharesOf(page)).toEqual([50, 50])
  const { y } = await within(thread, 0.5, 0.5)

  // The gap right of the Thread, dragged near a third, holds there; the
  // focus stays where it was.
  const half = await edgeAt(page, 1 / 2)
  const third = await edgeAt(page, 1 / 3)
  await page.mouse.move(half.x, y)
  await page.mouse.down()
  await page.mouse.move(third.x + 4, y, { steps: 6 })
  await expect.poll(() => sharesOf(page)).toEqual([33, 50])
  await page.screenshot({ path: "test-results/5a-gap-drag.png" })
  await page.mouse.up()
  await expect.poll(() => sharesOf(page)).toEqual([33, 50])
  await expect(terminal).toHaveAttribute("data-focused", "true")

  // Between the steps, it is as dragged; Esc puts it back.
  await page.mouse.move(third.x, y)
  await page.mouse.down()
  await page.mouse.move((await edgeAt(page, 0.42)).x, y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => sharesOf(page)).toEqual([42, 50])
  const at42 = await edgeAt(page, 0.42)
  await page.mouse.move(at42.x, y)
  await page.mouse.down()
  await page.mouse.move(at42.x + 120, y, { steps: 6 })
  await expect.poll(() => sharesOf(page)).not.toEqual([42, 50])
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect.poll(() => sharesOf(page)).toEqual([42, 50])

  // A double click on the gap: the column the whole screen wide, and back.
  await page.mouse.dblclick(at42.x, y)
  await expect.poll(() => sharesOf(page)).toEqual([100, 50])
  await expect(thread).toHaveAttribute("data-focused", "true")
  await settled(page.locator("[data-column]").first())
  const whole = await edgeAt(page, 1)
  await page.mouse.dblclick(whole.x, y)
  await expect.poll(() => sharesOf(page)).toEqual([42, 50])
  await settled(page.locator("[data-column]").first())

  // Alt and the right button, anywhere on the Thread: sideways its width,
  // held at a half; the Thread takes the focus.
  const on = await within(thread, 0.5, 0.5)
  await page.keyboard.down("Alt")
  await page.mouse.move(on.x, on.y)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(on.x + (0.5 - 0.42) * at42.scale + 4, on.y, {
    steps: 6,
  })
  await page.mouse.up({ button: "right" })
  await page.keyboard.up("Alt")
  await expect.poll(() => sharesOf(page)).toEqual([50, 50])
  await expect(thread).toHaveAttribute("data-focused", "true")

  // A column of two: the gap between them sizes their heights.
  await page.keyboard.press("Alt+ArrowRight")
  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+BracketLeft")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect.poll(() => heightOf(terminal)).toBe(50)
  await settled(terminal, launcher)
  const top = (await terminal.boundingBox())!
  const under = (await launcher.boundingBox())!
  const [upper, lower] =
    top.y < under.y ? [terminal, launcher] : [launcher, terminal]
  const a = (await upper.boundingBox())!
  const b = (await lower.boundingBox())!
  const gapY = (a.y + a.height + b.y) / 2
  const column = a.height + b.height + (b.y - a.y - a.height)
  await page.mouse.move(a.x + 40, gapY)
  await page.mouse.down()
  await page.mouse.move(a.x + 40, gapY + column / 6 + 3, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => heightOf(upper)).toBe(67)
  await page.screenshot({ path: "test-results/5b-heights.png" })

  // Alt and the right button on the lower one: up makes it shorter.
  await settled(upper, lower)
  const low = await within(lower, 0.5, 0.5)
  await page.keyboard.down("Alt")
  await page.mouse.move(low.x, low.y)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(low.x, low.y - column / 4, { steps: 6 })
  await page.mouse.up({ button: "right" })
  await page.keyboard.up("Alt")
  await expect.poll(() => heightOf(lower)).toBeLessThan(20)

  // A double click on that gap: even again.
  await settled(upper, lower)
  const c = (await upper.boundingBox())!
  const d = (await lower.boundingBox())!
  await page.mouse.dblclick(c.x + 40, (c.y + c.height + d.y) / 2)
  await expect.poll(() => heightOf(upper)).toBe(50)
})

/** The workspace on screen: each column's tiles, top down, by ID. */
/** Expects the top bar to mark workspace `n` as the one on screen. */
function onWorkspace(page: Page, n: string) {
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  return expect(
    numbers.getByRole("button", { name: `Workspace ${n}` })
  ).toHaveAttribute("aria-current", "true")
}

function layoutOf(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[role="group"]:not([aria-hidden="true"]) [data-column]'
      ),
    ].map((column) =>
      [...column.querySelectorAll<HTMLElement>(":scope > [data-tile]")].map(
        (tile) => tile.dataset.tile
      )
    )
  )
}

/** Where to take `tile` by its header: left of its middle, past its
 * buttons. */
async function headerOf(tile: Locator) {
  const box = (await tile.locator("header[data-handle]").boundingBox())!
  return { x: box.x + box.width / 3, y: box.y + box.height / 2 }
}

/** Where in `tile`, as shares of its width and height. */
async function within(tile: Locator, x: number, y: number) {
  const box = (await tile.boundingBox())!
  return { x: box.x + box.width * x, y: box.y + box.height * y }
}

test("the mouse moves Panes as niri's: a header, Alt and the left button, the bar's numbers", async () => {
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  // Two New Panes; the last one, a terminal.
  const launchers = page.getByRole("region", { name: "New Pane" })
  await page.keyboard.press("Alt+KeyN")
  await expect(launchers).toHaveCount(1)
  await expect(launchers.first()).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+KeyN")
  await expect(launchers).toHaveCount(2)
  await expect(launchers.nth(1)).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("KeyT")
  const terminal = terminalTile(page)
  await expect(terminal).toHaveAttribute("data-focused", "true")
  const launcher = launchers.first()
  const [t, term, l] = await Promise.all(
    [thread, terminal, launcher].map((tile) => tile.getAttribute("data-tile"))
  )
  await expect.poll(() => layoutOf(page)).toEqual([[t], [l], [term]])
  const hint = page.locator("body > .bg-focus")
  const bar = page.locator("[data-workspace]")

  // The New Pane's header, dragged under the terminal: the hint shows
  // where, the Pane lifted looks it, and it lands there, focused.
  await settled(terminal, launcher)
  const from = await headerOf(launcher)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const under = await within(terminal, 0.5, 0.8)
  await page.mouse.move(under.x, under.y, { steps: 8 })
  await expect(page.locator('html[data-drag="move"]')).toHaveCount(1)
  await expect(launcher).toHaveAttribute("data-lifted", "")
  await expect(hint).toBeVisible()
  await page.screenshot({ path: "test-results/6a-carried.png" })
  await page.mouse.up()
  await expect.poll(() => layoutOf(page)).toEqual([[t], [term, l]])
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect(page.locator("html[data-drag], [data-lifted]")).toHaveCount(0)
  await expect(hint).toHaveCount(0)

  // Alt and the left button, from anywhere on it, to the column's left
  // edge: a column of its own there.
  await settled(terminal, launcher)
  const on = await within(launcher, 0.5, 0.5)
  const edge = await within(terminal, 0.05, 0.5)
  await page.keyboard.down("Alt")
  await page.mouse.move(on.x, on.y)
  await page.mouse.down()
  await page.mouse.move(edge.x, edge.y, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up("Alt")
  await expect.poll(() => layoutOf(page)).toEqual([[t], [l], [term]])

  // Esc puts it back.
  await page.keyboard.press("Alt+ArrowRight")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await settled(terminal, launcher)
  const back = await headerOf(terminal)
  await page.mouse.move(back.x, back.y)
  await page.mouse.down()
  const there = await within(launcher, 0.5, 0.8)
  await page.mouse.move(there.x, there.y, { steps: 8 })
  await expect(hint).toBeVisible()
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(page.locator("html[data-drag], [data-lifted]")).toHaveCount(0)
  await expect.poll(() => layoutOf(page)).toEqual([[t], [l], [term]])

  // Onto the empty workspace's number: it lands there, and the view goes
  // with it.
  await expect(bar).toHaveCount(2)
  const second = (await bar.nth(1).boundingBox())!
  await page.mouse.move(back.x, back.y)
  await page.mouse.down()
  await page.mouse.move(second.x + second.width / 2, second.y + 4, {
    steps: 8,
  })
  await expect(bar.nth(1)).toHaveAttribute("data-drop", "")
  await page.mouse.up()
  await expect.poll(() => layoutOf(page)).toEqual([[term]])
  await expect(bar).toHaveCount(3)
  await expect(bar.nth(1)).toHaveAttribute("aria-current", "true")

  // Held over the first workspace's number, it goes there; let go under
  // the New Pane, it lands under it.
  await settled(terminal)
  const alone = await headerOf(terminal)
  const first = (await bar.nth(0).boundingBox())!
  await page.mouse.move(alone.x, alone.y)
  await page.mouse.down()
  await page.mouse.move(first.x + first.width / 2, first.y + 4, { steps: 8 })
  await expect(bar.nth(0)).toHaveAttribute("aria-current", "true")
  await settled(launcher)
  const below = await within(launcher, 0.5, 0.8)
  await page.mouse.move(below.x, below.y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => layoutOf(page)).toEqual([[t], [l, term]])
  await expect(bar).toHaveCount(2)

  // Alt and the middle button: sideways the Strip follows, and a column
  // most in view takes the focus; up, the next workspace.
  await page.keyboard.press("Alt+KeyN")
  await expect(launchers).toHaveCount(2)
  const third = launchers.nth(1)
  await expect(third).toHaveAttribute("data-focused", "true")
  await settled(third)
  const strip = page.locator('[role="group"][aria-hidden="false"] [data-strip]')
  await expect
    .poll(() => strip.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(0)
  const view = await within(third, 0.5, 0.5)
  await page.keyboard.down("Alt")
  await page.mouse.move(view.x, view.y)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(view.x + 600, view.y, { steps: 10 })
  await page.mouse.up({ button: "middle" })
  await expect(third).toHaveAttribute("data-focused", "false")
  await expect.poll(() => strip.evaluate((e) => e.scrollLeft)).toBe(0)
  await page.mouse.move(view.x, view.y)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(view.x, view.y - 100, { steps: 6 })
  await page.mouse.up({ button: "middle" })
  await page.keyboard.up("Alt")
  await expect(bar.nth(1)).toHaveAttribute("aria-current", "true")
})

test("the overview shows every column of a workspace, and a middle click or a cross closes a Pane", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const launchers = page.getByRole("region", { name: "New Pane" })
  for (const count of [1, 2, 3]) {
    await page.keyboard.press("Alt+KeyN")
    await expect(launchers).toHaveCount(count)
  }
  const [t, a, b, c] = await Promise.all(
    [thread, ...[0, 1, 2].map((n) => launchers.nth(n))].map((tile) =>
      tile.getAttribute("data-tile")
    )
  )
  await expect.poll(() => layoutOf(page)).toEqual([[t], [a], [b], [c]])
  const strip = page.locator("[data-strip]").first()
  const scrolled = () => strip.evaluate((s) => s.scrollLeft)
  // Four half-screen columns: the screen shows the last two, once the
  // Strip has scrolled there.
  let before = -1
  await expect
    .poll(async () => {
      const [was, now] = [before, await scrolled()]
      before = now
      return now > 0 && now === was
    })
    .toBe(true)

  await page.keyboard.press("Alt+KeyO")
  const overview = page.getByRole("dialog", { name: "Overview" })
  const tileOf = (id: string | null) => overview.locator(`[data-tile="${id}"]`)
  const row = overview.getByRole("group", { name: "Workspace 1" })
  // Every column shows in its row, and each Pane itself under its tile,
  // the ones off the screen too.
  const ids = [t, a, b, c]
  await expect
    .poll(async () => {
      const box = (await row.boundingBox())!
      const boxes = await Promise.all(
        ids.flatMap((id) => [
          tileOf(id).boundingBox(),
          page.locator(`section[data-tile="${id}"]`).boundingBox(),
        ])
      )
      return boxes.every(
        (one, i) =>
          one !== null &&
          one.x >= box.x - 1 &&
          one.x + one.width <= box.x + box.width + 1 &&
          (i % 2 === 0 ||
            Math.abs(one.x - boxes[i - 1]!.x) +
              Math.abs(one.width - boxes[i - 1]!.width) <
              2)
      )
    })
    .toBe(true)
  await page.screenshot({ path: "test-results/7d-overview-whole.png" })
  // Closed, the Strip is scrolled as it was.
  await page.keyboard.press("Escape")
  await expect(overview).toBeHidden()
  await expect.poll(scrolled).toBe(before)

  // A middle click closes the Pane under it.
  await page.keyboard.press("Alt+KeyO")
  await expect(overview).toBeVisible()
  await tileOf(c).click({ button: "middle" })
  await expect.poll(() => layoutOf(page)).toEqual([[t], [a], [b]])

  // Its cross, shown as the mouse is over it, closes it too.
  await tileOf(a).hover()
  await tileOf(a).getByRole("button", { name: "Close New Pane" }).click()
  await expect.poll(() => layoutOf(page)).toEqual([[t], [b]])
  await expect(overview).toBeVisible()
})

test("in the overview a workspace's number carries it up or down, Esc puts it back, and a click goes there", async () => {
  // Small enough that every workspace shows at once.
  window = await startWindow({ look: "[overview]\nzoom = 0.2\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  // The Thread on workspace 1, a launcher on 2 and one on 3.
  const t = await thread.getAttribute("data-tile")
  const launcher = page.getByRole("region", { name: "New Pane" })
  const opened: (string | null)[] = []
  for (const n of [2, 3]) {
    await page.keyboard.press("Alt+KeyN")
    await expect(launcher).toHaveCount(n - 1)
    const fresh = launcher.and(page.locator('[data-focused="true"]'))
    await expect(fresh).not.toHaveAttribute("data-tile", opened[0] ?? "")
    opened.push(await fresh.getAttribute("data-tile"))
    await page.keyboard.press(`Alt+Shift+Digit${n}`)
    await onWorkspace(page, String(n))
  }
  const [a, b] = opened
  await page.keyboard.press("Alt+KeyO")
  const overview = page.getByRole("dialog", { name: "Overview" })
  const order = () =>
    overview
      .locator("[data-row]")
      .evaluateAll((rows) =>
        rows.map(
          (row) => row.querySelector<HTMLElement>("[data-tile]")?.dataset.tile
        )
      )
  await expect.poll(order).toEqual([t, a, b, undefined])
  const number = (n: number) =>
    overview.getByRole("button", { name: `Move workspace ${n}` })
  // The empty one at the bottom has no handle.
  await expect(number(4)).toHaveCount(0)
  const drag = async (n: number, to: number) => {
    const from = (await number(n).boundingBox())!
    const over = (await overview
      .getByRole("group", { name: `Workspace ${to}` })
      .boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, over.y + 4, { steps: 8 })
  }

  // Carried over the first, the one it passes steps aside, its Panes along.
  await drag(3, 1)
  const stack = page.locator(`[data-stack]:has([data-tile="${b}"])`)
  const row = overview.getByRole("group", { name: "Workspace 3" })
  await expect
    .poll(async () => {
      const [s, r] = [await stack.boundingBox(), await row.boundingBox()]
      return Math.abs(s!.y - r!.y) < 2
    })
    .toBe(true)
  // Once the ones passed have stepped aside.
  await page.waitForTimeout(300)
  await page.screenshot({ path: "test-results/7e-overview-reorder.png" })
  // Esc puts it back, and the overview stays.
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(overview).toBeVisible()
  await expect.poll(order).toEqual([t, a, b, undefined])
  await expect(overview.locator("li[data-lifted]")).toHaveCount(0)

  // Dropped there, it is first, and the numbers count again.
  await drag(3, 1)
  await page.mouse.up()
  await expect.poll(order).toEqual([b, t, a, undefined])
  await expect(overview).toBeVisible()

  // A click on a number goes to its workspace.
  await number(3).click()
  await expect(overview).toBeHidden()
  await onWorkspace(page, "3")
  await expect(page.locator(`section[data-tile="${a}"]`)).toHaveAttribute(
    "data-focused",
    "true"
  )
})

test("the overview zooms out as far as [overview] zoom says", async () => {
  window = await startWindow({ look: "[overview]\nzoom = 0.2\n" })
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyO")
  const row = page
    .getByRole("dialog", { name: "Overview" })
    .getByRole("group", { name: "Workspace 1" })
  await expect(row).toBeVisible()
  const width = (await row.boundingBox())!.width
  const room = await page.evaluate(() => innerWidth)
  // A fifth of the screen it copies, which is the window less the sidebar.
  expect(width / room).toBeGreaterThan(0.1)
  expect(width / room).toBeLessThan(0.2)
})

test("the overview: the arrows and Enter, the window's keys, the drag", async () => {
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const launcher = page.getByRole("region", { name: "New Pane" })
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const [t, l] = await Promise.all(
    [thread, launcher].map((tile) => tile.getAttribute("data-tile"))
  )
  const overview = page.getByRole("dialog", { name: "Overview" })
  const picked = overview.locator("[data-tile][aria-current]")
  const tileOf = (id: string | null) => overview.locator(`[data-tile="${id}"]`)
  const bar = page.locator("[data-workspace]")
  // Each workspace's columns as the overview draws them.
  const drawn = () =>
    overview
      .locator("[data-row]")
      .evaluateAll((rows) =>
        rows.map((row) =>
          [...row.querySelectorAll("[data-column]")].map((column) =>
            [...column.querySelectorAll<HTMLElement>("[data-tile]")].map(
              (tile) => tile.dataset.tile
            )
          )
        )
      )

  // The arrows pick a Pane; Enter goes to it.
  await page.keyboard.press("Alt+KeyO")
  await expect(overview).toBeFocused()
  await expect(picked).toHaveAttribute("data-tile", l!)
  // The Panes themselves, zoomed out under it, each where its tile is.
  const real = page.locator(`section[data-tile="${l}"]`)
  await expect
    .poll(async () => {
      const [over, under] = await Promise.all([
        tileOf(l).boundingBox(),
        real.boundingBox(),
      ])
      return Math.abs(over!.x - under!.x) + Math.abs(over!.width - under!.width)
    })
    .toBeLessThan(2)
  await page.screenshot({ path: "test-results/7a-overview.png" })
  await page.keyboard.press("ArrowLeft")
  await expect(picked).toHaveAttribute("data-tile", t!)
  await page.keyboard.press("Enter")
  await expect(overview).toBeHidden()
  await expect(thread).toHaveAttribute("data-focused", "true")

  // Typing does nothing here: the overview has no search.
  await page.keyboard.press("Alt+KeyO")
  await page.keyboard.type("new p")
  await expect(overview.getByRole("status")).toHaveCount(0)
  await expect(picked).toHaveAttribute("data-tile", t!)
  await page.keyboard.press("ArrowRight")
  await expect(picked).toHaveAttribute("data-tile", l!)
  await expect(overview).toBeVisible()

  // The window's keys work here: Alt+Shift+Arrows move the Pane picked.
  await page.keyboard.press("Alt+Shift+ArrowLeft")
  await expect.poll(drawn).toEqual([[[l], [t]], []])
  await page.keyboard.press("Alt+Shift+ArrowRight")
  await expect.poll(drawn).toEqual([[[t], [l]], []])

  // Dragged between two workspaces, a Pane makes one of its own there,
  // and the overview stays.
  await settled(tileOf(l))
  const from = await within(tileOf(l), 0.5, 0.5)
  const between = (await overview.locator('[data-between="1"]').boundingBox())!
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(between.x + between.width / 2, between.y + 8, {
    steps: 8,
  })
  await expect(page.locator("body > .bg-focus")).toBeVisible()
  await page.screenshot({ path: "test-results/7b-overview-carried.png" })
  await page.mouse.up()
  await expect.poll(drawn).toEqual([[[t]], [[l]], []])
  await expect(bar).toHaveCount(3)
  await expect(overview).toBeVisible()

  // Back beside the Thread, under it.
  await settled(tileOf(l), tileOf(t))
  const back = await within(tileOf(l), 0.5, 0.5)
  const under = await within(tileOf(t), 0.5, 0.8)
  await page.mouse.move(back.x, back.y)
  await page.mouse.down()
  await page.mouse.move(under.x, under.y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(drawn).toEqual([[[t, l]], []])
  await expect(bar).toHaveCount(2)
  await page.keyboard.press("Escape")
  await expect(overview).toBeHidden()
  await expect.poll(() => layoutOf(page)).toEqual([[t, l]])
  // And back at its size, filling the window.
  await expect(real).toBeInViewport({ ratio: 0.99 })
  await expect
    .poll(async () => (await real.boundingBox())!.width)
    .toBeGreaterThan((await page.evaluate(() => innerWidth)) * 0.3)
})

test("Alt+[ takes a Pane into a column, Alt+T shows it as a Deck", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const columns = page.locator("[data-column]")
  await expect(columns).toHaveCount(2)

  // Into the Thread's column, under it.
  await page.keyboard.press("Alt+BracketLeft")
  await expect(columns).toHaveCount(1)
  await expect(thread).toBeVisible()
  await expect(launcher).toBeVisible()

  // As a Deck: one shows, the other waits behind its tab.
  await page.keyboard.press("Alt+KeyT")
  const tabs = page.getByRole("tab")
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(launcher).toBeVisible()
  await expect(thread).toBeHidden()
  // Over the tile, which keeps its own header.
  const bar = await page.getByRole("tablist").boundingBox()
  const tile = await launcher.boundingBox()
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(tile!.y)
  await expect(
    launcher.getByRole("heading", { name: "New Pane" })
  ).toBeVisible()
  await tabs.nth(0).click()
  await expect(thread).toBeVisible()
  await expect(launcher).toBeHidden()
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Alt+ArrowDown")
  await expect(launcher).toBeVisible()
  await page.screenshot({ path: "test-results/tabs.png" })

  // Back to one above another, and out to a column of its own.
  await page.keyboard.press("Alt+KeyT")
  await expect(tabs).toHaveCount(0)
  await expect(thread).toBeVisible()
  await page.keyboard.press("Alt+BracketRight")
  await expect(columns).toHaveCount(2)
})

test("Alt+G starts a Group, Alt+Shift+[ takes a column in, and the Group moves whole", async () => {
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const launcher = page.getByRole("region", { name: "New Pane" })
  const terminal = terminalTile(page)
  const x = async (tile: Locator) => (await tile.boundingBox())!.x
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher.locator("kbd", { hasText: "T" })).toBeVisible()
  await page.keyboard.press("KeyT")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const plates = page.locator("[data-group-plate]")

  // A Group of the Thread alone, then the terminal joins it.
  await page.keyboard.press("Alt+Home")
  await page.keyboard.press("Alt+KeyG")
  await expect(plates).toHaveCount(1)
  await page.keyboard.press("Alt+ArrowRight")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Shift+BracketLeft")
  await expect(plates).toHaveCount(2)
  await expect(plates.first()).toHaveAttribute("data-first", "")
  await expect(plates.last()).toHaveAttribute("data-last", "")
  await page.screenshot({ path: "test-results/group.png" })

  // The launcher passes the Group whole; the Group moves back whole.
  await page.keyboard.press("Alt+End")
  await page.keyboard.press("Alt+Shift+ArrowLeft")
  await expect
    .poll(async () => (await x(launcher)) < (await x(thread)))
    .toBe(true)
  await expect
    .poll(async () => (await x(thread)) < (await x(terminal)))
    .toBe(true)
  await page.keyboard.press("Alt+End")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Shift+ArrowLeft")
  await expect
    .poll(async () => (await x(thread)) < (await x(launcher)))
    .toBe(true)
  await expect
    .poll(async () => (await x(terminal)) < (await x(launcher)))
    .toBe(true)

  // Alt+M: the Group, a third and a third, the whole screen wide, and back.
  await page.keyboard.press("Alt+Control+ArrowLeft")
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(thread).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Control+ArrowLeft")
  const wide = () =>
    page.locator("[data-group-plate]").evaluateAll((all) => {
      const strip = all[0].parentElement!.parentElement!
      const style = getComputedStyle(strip)
      const inner =
        strip.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      const widths = all.map((e) => e.parentElement!.offsetWidth)
      return widths.reduce((sum, w) => sum + w, 0) / inner
    })
  await expect.poll(wide).toBeLessThan(0.7)
  await page.keyboard.press("Alt+KeyM")
  await expect.poll(wide).toBeGreaterThan(0.9)
  await page.keyboard.press("Alt+KeyM")
  await expect.poll(wide).toBeLessThan(0.7)
  await page.keyboard.press("Alt+ArrowRight")

  // At its edge, Alt+Shift+] takes the terminal out.
  await page.keyboard.press("Alt+Shift+BracketRight")
  await expect(plates).toHaveCount(1)
})

test("a Thread is a Group from its opening, and its Agent's Diff joins it", async () => {
  window = await startWindow()
  const { page } = window
  const plates = page.locator("[data-group-plate]")
  // The first start's New Thread, and a Project's Thread, each a Group.
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  await expect(plates).toHaveCount(1)
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await expect(plates).toHaveCount(1)
  // No handle unless the look asks for one.
  await expect(page.locator("[data-group-handle]")).toHaveCount(0)
  await settled(thread)
  const before = (await thread.boundingBox())!

  // The Diff it opens joins that Group, and the Thread does not move.
  await composer.fill("edit the notes")
  await composer.press("Enter")
  await expect(thread.getByText("I edited notes.md.")).toBeVisible()
  const changed = thread.getByRole("region", { name: "Changed files" })
  await changed.getByRole("button", { name: /notes\.md/ }).click()
  await expect(page.getByRole("region", { name: "Diff" })).toBeVisible()
  await expect(plates).toHaveCount(2)
  const groups = await plates.evaluateAll((all) =>
    all.map((plate) => plate.getAttribute("data-group-plate"))
  )
  expect(new Set(groups).size).toBe(1)
  await settled(thread)
  expect((await thread.boundingBox())!.x).toBe(before.x)
})

test("a Group's handle carries it, and a Pane dropped inside its end joins it", async () => {
  // A third each, so the three fit in view; the handle, off by default.
  window = await startWindow({
    look: '[columns]\nmin = 10\ndefault = "1/3"\n[groups]\nhandle = true\n',
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const launcher = page.getByRole("region", { name: "New Pane" })
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveCount(1)
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveCount(2)
  await expect(launcher.nth(1)).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("KeyT")
  const terminal = terminalTile(page)
  await expect(terminal).toHaveAttribute("data-focused", "true")
  const x = async (tile: Locator) => (await tile.boundingBox())!.x
  // The Thread and the launcher, a Group; the terminal beside it.
  await page.keyboard.press("Alt+Home")
  await page.keyboard.press("Alt+KeyG")
  await page.keyboard.press("Alt+ArrowRight")
  await page.keyboard.press("Alt+Shift+BracketLeft")
  const plates = page.locator("[data-group-plate]")
  await expect(plates).toHaveCount(2)
  await settled(thread, launcher, terminal)

  // Under the pointer, the handle shows; dragged, the Group goes whole.
  const handle = page.locator("[data-group-handle]")
  const middle = await within(thread, 0.5, 0.5)
  await page.mouse.move(middle.x, middle.y)
  await expect(handle).toHaveAttribute("data-hover", "")
  await expect(handle).toHaveAccessibleName("Group · 2 Panes")
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + 8, grip.y + grip.height / 2)
  await page.mouse.down()
  // Past the terminal's middle.
  const past = await within(terminal, 0.7, 0.5)
  await page.mouse.move(past.x, past.y, { steps: 10 })
  await page.mouse.up()
  await expect
    .poll(async () => (await x(terminal)) < (await x(thread)))
    .toBe(true)
  await expect
    .poll(async () => (await x(thread)) < (await x(launcher)))
    .toBe(true)
  await settled(thread, launcher, terminal)
  await page.screenshot({ path: "test-results/group-handle.png" })

  // The terminal, dropped just inside the Group's left end, joins it.
  const from = await headerOf(terminal)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Lifted, the Strip may still shift a little: the Group's end is where
  // it is once that has settled.
  await page.mouse.move(from.x + 20, from.y + 40, { steps: 4 })
  await settled(thread, terminal)
  const edge = (await thread.boundingBox())!
  await page.mouse.move(edge.x - 2, edge.y + edge.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(plates).toHaveCount(3)
})

test("a Thread picked in the sidebar comes to the Strip's left, beside it", async () => {
  // A third each, so four columns are wider than the screen.
  window = await startWindow({
    look: '[columns]\nmin = 10\ndefault = "1/3"\n',
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const launcher = page.getByRole("region", { name: "New Pane" })
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveCount(1)
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveCount(2)
  await page.keyboard.press("KeyT")
  const terminal = terminalTile(page)
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveCount(2)
  // The Thread second: a New Pane, it, the terminal and another.
  await page.keyboard.press("Alt+Home")
  await page.keyboard.press("Alt+Shift+ArrowRight")
  await page.keyboard.press("Alt+Home")
  await expect(launcher.first()).toHaveAttribute("data-focused", "true")
  await settled(thread, terminal)
  const strip = page.locator("[data-strip]").first()
  const left = () =>
    strip.evaluate(
      (e) =>
        e.getBoundingClientRect().left +
        parseFloat(getComputedStyle(e).paddingLeft)
    )
  const x = async () => (await thread.boundingBox())!.x
  expect((await x()) - (await left())).toBeGreaterThan(50)

  // Picked, it comes to the left, though it was in view already.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await sidebar.getByRole("button", { name: /hello/ }).click()
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect
    .poll(async () => Math.abs((await x()) - (await left())))
    .toBeLessThan(3)
})

test("a Project's Agents open in a row on its workspace, from wherever the Person is", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  const threads = page.getByRole("textbox", { name: "Message to Fake AI" })

  // On an empty workspace, a new Thread of the Project goes to its own.
  await page.getByRole("button", { name: "New workspace" }).click()
  await expect(numbers.locator("[aria-current]:not([inert])")).toHaveText("")
  await page.keyboard.press("Alt+Enter")
  // Its sign, the Project's letter (ADR 0070).
  await expect(numbers.locator("[aria-current]:not([inert])")).toHaveText("W")
  await expect(threads).toHaveCount(2)
  // The bar shows it as the Project's: its sign, and its name on it.
  await expect(
    numbers.getByRole("button", { name: "Workspace 1" })
  ).toHaveAttribute("title", "Work: Overview (Alt+O)")
  const strip = page.locator("[data-strip]").first()
  await expect(
    strip.getByRole("textbox", { name: "Message to Fake AI" })
  ).toHaveCount(2)
})

test('agents.toml\'s workspaces = "off" keeps a new Thread where the Person is', async () => {
  window = await startWindow({
    files: { "config/agents.toml": 'workspaces = "off"\n' },
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  await page.getByRole("button", { name: "New workspace" }).click()
  await page.keyboard.press("Alt+Enter")
  await expect(numbers.locator("[aria-current]:not([inert])")).toHaveText("2")
  // Only workspace 2 shows: the new Thread alone.
  await expect(
    page.getByRole("textbox", { name: "Message to Fake AI" })
  ).toHaveCount(1)
})

test("a tab in a Deck's bar carries its Pane", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const [t, l] = await Promise.all(
    [thread, launcher].map((tile) => tile.getAttribute("data-tile"))
  )
  await page.keyboard.press("Alt+BracketLeft")
  await page.keyboard.press("Alt+KeyT")
  const tabs = page.getByRole("tab")
  await expect(tabs).toHaveCount(2)

  // The Thread's tab, to the right edge of the tile: a column of its own.
  await settled(launcher)
  const from = await tabs.nth(0).boundingBox()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  const edge = await within(launcher, 0.95, 0.5)
  await page.mouse.move(edge.x, edge.y, { steps: 8 })
  await expect(tabs.nth(0)).toHaveAttribute("data-lifted", "")
  await page.mouse.up()
  await expect.poll(() => layoutOf(page)).toEqual([[l], [t]])
  await expect(thread).toBeVisible()
})

test("columns grow and go to their new places on the look's motion", async () => {
  const slow = 'easing = { duration-ms = 1500, curve = "linear" }'
  window = await startWindow({
    look: `[columns]\nalone = "1/2"\n[motion.resize]\n${slow}\n[motion.move]\n${slow}\n`,
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const column = thread.locator("xpath=ancestor::*[@data-column][1]")
  const share = () =>
    column.evaluate((e: HTMLElement) => {
      // The room beside the sidebar, which floats over the Strip's left.
      const strip = getComputedStyle(e.parentElement!)
      const room =
        e.parentElement!.clientWidth -
        parseFloat(strip.paddingLeft) -
        parseFloat(strip.paddingRight)
      return e.offsetWidth / room
    })

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
  // It grows from half its size, as niri's.
  const scale = (tile: Locator) =>
    tile.evaluate((e: HTMLElement) => Number(e.style.scale || 1))
  expect(await scale(launcher)).toBeLessThan(0.75)
  await expect.poll(() => opacity(launcher)).toBe(1)

  // Closed, it is gone from the window at once, and its look fades out
  // where it was, though the Thread left alone widens at once.
  const column = launcher.locator("xpath=..")
  const left = await column.evaluate((e: HTMLElement) => e.offsetLeft)
  await page.keyboard.press("Alt+KeyW")
  await expect(launcher).toBeHidden()
  const ghost = page.locator("[aria-hidden=true][inert]", {
    hasText: "What should this tile show?",
  })
  await expect(ghost).toHaveCount(1)
  expect(await ghost.evaluate((e: HTMLElement) => e.style.left)).toBe(
    `${left}px`
  )
  // It shrinks to four fifths, as niri's.
  await expect.poll(() => scale(ghost)).toBeLessThan(0.9)
  expect(await scale(ghost)).toBeGreaterThanOrEqual(0.8)
  await expect(ghost).toHaveCount(0)

  // One that goes stays where it was on the screen as the Strip scrolls.
  await page.keyboard.press("Alt+KeyN")
  await page.keyboard.press("Alt+KeyN")
  await expect(launcher).toHaveCount(2)
  const middle = (e: Element) => {
    const { left, right } = e.getBoundingClientRect()
    return (left + right) / 2
  }
  // Where it shows once the Strip has scrolled to it.
  const newest = launcher.last().locator("xpath=..")
  let shown = NaN
  await expect
    .poll(async () => {
      const was = shown
      shown = await newest.evaluate(middle)
      return Math.abs(shown - was) < 0.5
    })
    .toBe(true)
  await page.keyboard.press("Alt+KeyW")
  await expect(ghost).toHaveCount(1)
  await ghost.evaluate((e) => (e.parentElement!.scrollLeft = 0))
  await expect
    .poll(async () => Math.round((await ghost.evaluate(middle)) - shown))
    .toBe(0)
  await expect(ghost).toHaveCount(0)
  await page.keyboard.press("Alt+KeyW")
  await expect(launcher).toHaveCount(0)

  // A terminal fades out with its screen on it.
  await page.keyboard.press("Alt+KeyN")
  await launcher.getByRole("button", { name: "Terminal" }).click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await page.keyboard.type("echo drawn\n")
  await page.waitForTimeout(300)
  await page.keyboard.press("Alt+KeyW")
  const still = page.locator("[aria-hidden=true][inert] canvas")
  await expect(still.first()).toBeAttached()
  const drawn = await still.evaluateAll((canvases: HTMLCanvasElement[]) =>
    canvases.some((canvas) => {
      const { data } = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height)
      return new Set(data).size > 2
    })
  )
  expect(drawn).toBe(true)
  await expect(still).toHaveCount(0)

  // The last Pane of a workspace fades out too, over the empty workspace.
  await page.keyboard.press("Alt+KeyW")
  await expect(page.getByText("This workspace is empty.")).toBeVisible()
  const last = page.locator("[aria-hidden=true][inert]", {
    hasText: "Write to Fake AI",
  })
  await expect(last).toHaveCount(1)
  await expect(last).toHaveCount(0)
})

test("the desk is Banda's own glass, made of the wallpaper", async () => {
  window = await startWindow({ look: GLASS })
  const { page, dir } = window
  const root = page.locator("html")
  // No picture yet: the desk is solid.
  await expect(root).toHaveAttribute("data-material", "banda")
  await expect(root).not.toHaveAttribute("data-glass")
  wallpaper(dir)
  await expect(root).toHaveAttribute("data-glass", "")
  const drawn = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.documentElement, "::before").backgroundImage
    )
  await expect.poll(drawn).toContain("app://banda/desk/wallpaper")
  // The desktop serves the look's picture, and no other file, whatever the
  // address asks for.
  const served = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const image = new Image()
        image.onload = () => done(image.naturalWidth)
        image.onerror = () => done(-1)
        image.src = "app://banda/desk/wallpaper?of=%2Fetc%2Fpasswd"
      })
  )
  expect(served).toBe(1)
  await page.screenshot({ path: "test-results/19b-banda-glass.png" })

  // What floats over the window is glass too: the Banda menu frosts what is
  // under it.
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  // The mark under the current workspace's number is the text's colour,
  // thinned, not a grey made for a solid page: it takes the glass's
  // colour under it and shows on any wallpaper (ADR 0036).
  const mark = page
    .getByRole("navigation", { name: "Workspaces" })
    .locator(":scope > span[aria-hidden]")
  const fill = () =>
    mark.evaluate((under) => getComputedStyle(under).backgroundColor)
  const thinned = /\/ 0\.1\)$/
  await expect.poll(fill).toMatch(thinned)
  // Menus stay solid over glass, with no blur under them (ADR 0075).
  await page.keyboard.press("Alt+Space")
  await expect(menu).toHaveCSS("backdrop-filter", "none")
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()

  // Dark, the desk is made of the dark picture (ADR 0030).
  copyFileSync(join(dir, "config/wall.png"), join(dir, "config/night.png"))
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "dark"\n${GLASS}wallpaper-dark = "night.png"\n`
  )
  await expect.poll(drawn).toContain("night.png")
  await expect(root).toHaveAttribute("data-glass", "")

  writeFileSync(join(dir, "config/look.toml"), `${GLASS}glass = false\n`)
  await expect(root).not.toHaveAttribute("data-glass")
  // Solid, it is shadcn's own grey again.
  await expect.poll(fill).not.toMatch(thinned)
  await page.keyboard.press("Alt+Space")
  await expect(menu).toHaveCSS("backdrop-filter", "none")
})

test("the system's glass is its material, with Banda's grain over it", async () => {
  window = await startWindow({ look: '[desk]\nmaterial = "system"\n' })
  const { page } = window
  const root = page.locator("html")
  // On Linux the window lets the desktop through for the compositor to
  // blur; Banda draws no picture, and lays its tint and grain over it.
  await expect(root).toHaveAttribute("data-material", "system")
  await expect(root).toHaveAttribute("data-glass", "")
  const drawn = await page.evaluate(() => ({
    picture: getComputedStyle(document.documentElement, "::before")
      .backgroundImage,
    grain: getComputedStyle(document.body, "::before").opacity,
  }))
  expect(drawn.picture).toBe("none")
  expect(drawn.grain).toBe("0.04")
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
  // One stroke over the 1px border and 3px past it.
  await expect(thread).toHaveCSS("outline-width", "4px")
  await expect(thread).toHaveCSS("outline-offset", "-1px")
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

test("the overview shows how each Thread is, rings the one that calls, and draws an empty workspace slim", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")
  await page.keyboard.press("Alt+KeyO")
  const overview = page.getByRole("dialog", { name: "Overview" })
  // Only what is there: no search, and a workspace's number alone.
  await expect(overview.getByRole("status")).toHaveCount(0)
  const tile = overview.getByRole("button", { name: "slow hello in Work" })
  // Done out of sight, it calls: its mark says so, and it is ringed.
  await expect(tile).toHaveAttribute("data-called", "")
  await expect(tile.getByRole("img", { name: "Done" })).toBeVisible()
  await expect(overview.getByText("1 Pane", { exact: true })).toHaveCount(0)
  const empty = overview.getByRole("group", { name: "Workspace 2" })
  await expect(empty).toHaveAttribute("data-empty", "true")
  expect((await empty.boundingBox())!.height).toBeLessThan(60)
  await page.screenshot({ path: "test-results/7c-overview-marks.png" })
})

test("a Thread that finishes out of sight shows a toast, and it goes there", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")

  const calls = page.getByRole("region", { name: "Notifications" })
  const toast = calls.getByRole("listitem").filter({ hasText: "slow hello" })
  await expect(toast).toContainText("Done")
  await page.screenshot({ path: "test-results/23-toast.png" })

  await toast.getByRole("button", { name: "Open" }).click()
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

test("a click anywhere on a toast does what its button does (ADR 0056)", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")

  const calls = page.getByRole("region", { name: "Notifications" })
  const toast = calls.getByRole("listitem").filter({ hasText: "slow hello" })
  await toast.getByText("Done").click()
  const thread = page.getByRole("region", { name: "slow hello" })
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(toast).toBeHidden()
})

test("the bell shows the last toasts again, and Esc or a button closes them (ADR 0048)", async () => {
  window = await startWindow()
  const { page } = window
  const bell = page
    .getByRole("banner")
    .getByRole("button", { name: "The last notifications" })
  const last = page.getByRole("region", { name: "Shown again" })
  const { composer } = await firstThread(page)
  // Nothing yet.
  await bell.click()
  await expect(last).toContainText("Nothing yet")
  await page.keyboard.press("Escape")
  await expect(last).toBeHidden()

  await sendAndGoBelow(page, composer, "slow hello")
  const calls = page.getByRole("region", { name: "Notifications" })
  await expect(calls).toContainText("slow hello")
  // Shown again, it shows once: in the bell's stack, not in the window's.
  await bell.click()
  const again = last.getByRole("listitem").filter({ hasText: "slow hello" })
  await expect(again).toContainText("Done")
  await expect(calls).toBeHidden()
  await page.screenshot({ path: "test-results/23-bell.png" })
  await bell.click()
  await expect(last).toBeHidden()

  await bell.click()
  await again.getByRole("button", { name: "Open" }).click()
  await expect(last).toBeHidden()
  const thread = page.getByRole("region", { name: "slow hello" })
  await expect(thread).toHaveAttribute("data-focused", "true")
})

test("the bell shows a call told on the desktop too, and a [bar] without it hides it (ADR 0048)", async () => {
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("slow hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  await setInFront(page, false)
  await expect.poll(async () => (await desktopOf(app)).shown.length).toBe(1)
  await setInFront(page, true)
  await page
    .getByRole("banner")
    .getByRole("button", { name: "The last notifications" })
    .click()
  await expect(page.getByRole("region", { name: "Shown again" })).toContainText(
    "slow hello"
  )
  await window.close()

  window = await startWindow({ look: '[bar]\nright = ["terminal.ports"]\n' })
  await expect((await firstThread(window.page)).composer).toBeVisible()
  await expect(
    window.page.getByRole("button", { name: "The last notifications" })
  ).toBeHidden()
})

test("a Thread that finishes on screen makes its sound, and no toast", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  const notes = await countNotes(page)
  await sendAndLeave(page, composer, "slow hello")
  await expect.poll(notes).toBeGreaterThan(0)
  await expect(page.getByRole("region", { name: "Notifications" })).toBeHidden()
})

test("Alt+U goes to the Thread that calls", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await sendAndGoBelow(page, composer, "slow hello")
  const calls = page.getByRole("region", { name: "Notifications" })
  await expect(
    calls.getByRole("listitem").filter({ hasText: "slow hello" })
  ).toBeVisible()

  await page.keyboard.press("Alt+U")
  const thread = page.getByRole("region", { name: "slow hello" })
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(calls).toBeHidden()
})

test("the bar's middle counts who works and who waits while the sidebar is closed, and a row opens its Thread", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  const bar = page.getByRole("banner")
  const counts = bar.getByRole("button", { name: /working|done/ })
  await sendAndGoBelow(page, composer, "slow hello")
  // The sidebar shows the same, so the bar leaves it out.
  await expect(
    page.getByRole("complementary", { name: "Sidebar" })
  ).toBeVisible()
  await expect(counts).toBeHidden()

  await bar.getByRole("button", { name: /^Sidebar/ }).click()
  await expect(bar.getByRole("button", { name: "1 working" })).toBeVisible()
  const done = bar.getByRole("button", { name: "1 done" })
  await expect(done).toBeVisible()
  await page.screenshot({ path: "test-results/25-bar-counts.png" })

  await done.click()
  const row = page.getByRole("menuitem", { name: /slow hello/ })
  await expect(page.getByRole("group", { name: "Wait for you" })).toContainText(
    "slow hello"
  )
  await page.screenshot({ path: "test-results/25-bar-counts-list.png" })
  await row.click()
  const thread = page.getByRole("region", { name: "slow hello" })
  await expect(thread).toHaveAttribute("data-focused", "true")
  // Seen, it is counted no more; with nothing to count, the calm square
  // stays where the counts were.
  await expect(counts).toBeHidden()
  await expect(
    bar.getByRole("img", { name: "Nothing waits for you, nothing works" })
  ).toBeVisible()
})

test("the bar's widgets stand where look.toml's [bar] lists them, and an id it has no widget for is named at its line", async () => {
  window = await startWindow({
    look: '[bar]\ncenter = []\nright = ["sidebar.counts", "git.brnch"]\n',
  })
  const { page } = window
  await firstThread(page)
  const bar = page.getByRole("banner")
  await bar.getByRole("button", { name: /^Sidebar/ }).click()
  // The counts' calm square stands on the right now, the middle empty.
  const calm = bar.getByRole("img", {
    name: "Nothing waits for you, nothing works",
  })
  await expect(calm).toBeVisible()
  const width = page.viewportSize()!.width
  expect((await calm.boundingBox())!.x).toBeGreaterThan(width * 0.75)
  await expect(
    bar.getByRole("status", {
      name: /^The look: .*look\.toml:3:1: bar\.right names "git\.brnch", and no module has that widget$/,
    })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/25-bar-widgets.png" })
})

test("with Alt held, the mouse moves a widget along the bar, the workspaces too, and writes [bar] (ADR 0064)", async () => {
  window = await startWindow()
  const { page, dir } = window
  const file = join(dir, "config/look.toml")
  const written = () => (existsSync(file) ? readFileSync(file, "utf8") : "")
  await firstThread(page)
  const bar = page.getByRole("banner")
  const mark = bar.getByRole("button", { name: /^Sidebar/ })
  await mark.click()
  const calm = bar.getByRole("img", {
    name: "Nothing waits for you, nothing works",
  })
  await expect(calm).toBeVisible()
  const width = page.viewportSize()!.width
  const drag = async (what: Locator, x: number) => {
    const box = (await what.boundingBox())!
    const y = box.y + box.height / 2
    await page.keyboard.down("Alt")
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 12 })
    await page.mouse.up()
    await page.keyboard.up("Alt")
  }
  // The counts go from the middle to the right's end.
  await drag(calm, width - 6)
  await expect.poll(written).toMatch(/^center = \[\]$/m)
  await expect.poll(written).toMatch(/^right = \[.*"sidebar\.counts"\]$/m)
  await expect
    .poll(async () => (await calm.boundingBox())!.x)
    .toBeGreaterThan(width * 0.75)
  // The workspaces go to the middle; the Mark stays at the left edge.
  const workspaces = bar.getByRole("navigation", { name: "Workspaces" })
  await drag(workspaces, width / 2)
  await expect.poll(written).toMatch(/^center = \["workspaces\.list"\]$/m)
  await expect.poll(written).toMatch(/^left = \[\]$/m)
  await expect
    .poll(async () => {
      const box = (await workspaces.boundingBox())!
      return Math.abs(box.x + box.width / 2 - width / 2)
    })
    .toBeLessThan(40)
  expect((await mark.boundingBox())!.x).toBeLessThan(40)
  // Without Alt, a click is a click: the Mark shows the sidebar again.
  await mark.click()
  await expect(
    page.getByRole("complementary", { name: "Sidebar" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/26-bar-arranged.png" })
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
  await expect(page.getByRole("region", { name: "Notifications" })).toBeHidden()
})

test("a Thread is archived from its row's menu, its Pane closes, and Alt+S brings it back", async () => {
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
  await page.getByRole("menuitem", { name: /Archive thread/ }).click()
  // On the Archive shelf, folded, with its count; its Pane is put away.
  const shelf = sidebar.getByRole("group", { name: "Archive" })
  const header = shelf.getByRole("button", { name: /Archive/ })
  await expect(header).toHaveAttribute("aria-expanded", "false")
  await expect(header).toContainText("1")
  await expect(row).toBeHidden()
  await expect(thread).toBeHidden()
  await header.click()
  const archived = shelf.getByRole("button", { name: /hello/ })
  await expect(archived).toBeVisible()
  await page.screenshot({ path: "test-results/25-archived.png" })

  // Its row opens it again, archived still; Alt+S on it brings it back.
  await archived.click()
  await expect(thread).toBeVisible()
  await expect(shelf).toBeVisible()
  await page.keyboard.press("Alt+S")
  await expect(row).toBeVisible()
  await expect(shelf).toBeHidden()
  await expect(thread).toBeVisible()

  // Alt+S archives the Thread in the focused Pane, and closes it.
  await page.keyboard.press("Alt+S")
  await expect(thread).toBeHidden()
  await expect(shelf).toBeVisible()
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
  await expect(menu.getByRole("group", { name: "Threads" })).toContainText(
    "Show or hide the sidebar"
  )
  await page.keyboard.press("Alt+K")
  await expect(menu).toBeHidden()
})

/** The tile of `thread` by its own mark, as another Thread's tile has
 * a composer too; and its composer. */
async function ownTile(page: Page, thread: Locator) {
  const tile = page.locator(
    `[data-tile="${await thread.getAttribute("data-tile")}"]`
  )
  return {
    thread: tile,
    composer: tile.getByRole("textbox", { name: "Message to Fake AI" }),
  }
}

test("the Person renames a Thread in place: a double click on its title, F2, and Rename… in its row (ADR 0077)", async () => {
  window = await startWindow()
  const { page } = window
  const first = await firstThread(page)
  await first.composer.fill("hello")
  await first.composer.press("Enter")
  await expect(first.thread).toHaveAccessibleName("hello")
  const { thread, composer } = await ownTile(page, first.thread)
  const header = thread.locator("header")
  const title = (name: string) =>
    header.getByRole("button", { name, exact: true })
  const field = header.getByRole("textbox", { name: "Title" })
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const list = sidebar.getByRole("group", { name: "Threads" })
  const width = async () => (await thread.boundingBox())?.width
  // Two columns, so a double click on the header would widen one.
  await page.keyboard.press("Alt+Enter")
  await composer.click()
  await settled(thread)
  const before = await width()

  // A double click on the title opens the field, its text selected; the
  // column stays as wide. Enter keeps it, in the header and the sidebar.
  await title("hello").dblclick()
  await expect(field).toBeFocused()
  await expect(field).toHaveValue("hello")
  expect(
    await field.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ])
  ).toEqual([0, 5])
  await page.screenshot({ path: "test-results/27-title-field.png" })
  await page.keyboard.type("Fix the   list ")
  await page.keyboard.press("Enter")
  await expect(title("Fix the list")).toBeVisible()
  await expect(list.getByRole("button", { name: /Fix the list/ })).toBeVisible()
  await settled(thread)
  expect(await width()).toBe(before)
  // The focus goes back where it was.
  await expect(composer).toBeFocused()

  // Esc leaves the old title.
  await title("Fix the list").dblclick()
  await field.fill("Not this")
  await field.press("Escape")
  await expect(field).toBeHidden()
  await expect(title("Fix the list")).toBeVisible()

  // F2 on the focused Thread, from its composer; an empty field gives
  // back the first message's title.
  await composer.click()
  await page.keyboard.press("F2")
  await expect(field).toBeFocused()
  await field.fill("")
  await field.press("Enter")
  await expect(title("hello")).toBeVisible()

  // Rename… in the row's menu opens the field in the row.
  await list.getByRole("button", { name: /hello/ }).click({ button: "right" })
  const menu = page.getByRole("menu", { name: "Thread menu" })
  await menu.getByRole("menuitem", { name: /Rename…/ }).click()
  const rowField = sidebar.getByRole("textbox", { name: "Title" })
  await expect(rowField).toBeFocused()
  await rowField.fill("From the row")
  await rowField.press("Enter")
  await expect(title("From the row")).toBeVisible()

  // A click on the title of the focused Pane opens the Thread menu, with
  // its keys; Previous title brings the one before back.
  await title("From the row").click()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem")).toHaveText([
    /Rename…\s*F2/,
    /Suggest a title\s*Shift\+F2/,
    /Previous title/,
    /Mark as unread\s*Alt\+Shift\+U/,
    /Snooze…\s*Alt\+Z/,
    /Archive thread\s*Alt\+S/,
  ])
  await page.screenshot({ path: "test-results/27-thread-menu.png" })
  await menu.getByRole("menuitem", { name: "Previous title" }).click()
  await expect(title("hello")).toBeVisible()

  // A click, then the second of a double click: the menu closes and the
  // field opens.
  await title("hello").click()
  await expect(menu).toBeVisible()
  await title("hello").dblclick()
  await expect(menu).toBeHidden()
  await expect(field).toBeFocused()
  await field.press("Escape")

  // On a Pane not focused, the first click on its title only focuses it.
  await page.keyboard.press("Alt+ArrowRight")
  await expect(thread).toHaveAttribute("data-focused", "false")
  await title("hello").click()
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(menu).toBeHidden()
})

test("Suggest a title renames in one press with Undo, and Mark as unread calls again (ADR 0077)", async () => {
  window = await startWindow()
  const { page } = window
  const first = await firstThread(page)
  await first.composer.fill("hello")
  await first.composer.press("Enter")
  await expect(first.thread).toHaveAccessibleName("hello")
  const { thread, composer } = await ownTile(page, first.thread)
  const header = thread.locator("header")
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const row = sidebar
    .getByRole("group", { name: "Threads" })
    .getByRole("button")
  const toasts = page.getByRole("region", { name: "Notifications" })

  // From the Thread menu: the Harness's model names it, and a toast says
  // so; Undo gives back the first message's title.
  await header.getByRole("button", { name: "hello", exact: true }).click()
  await page.getByRole("menuitem", { name: /Suggest a title/ }).click()
  const renamed = toasts.getByText(/^Renamed to /)
  await expect(renamed).toBeVisible()
  const suggested = (await renamed.textContent())!.replace("Renamed to ", "")
  await expect(thread).toHaveAccessibleName(suggested)
  await expect(row).toContainText(suggested)
  await page.screenshot({ path: "test-results/28-suggested.png" })
  await toasts.getByRole("button", { name: "Undo" }).click()
  await expect(thread).toHaveAccessibleName("hello")
  await expect(row).toContainText("hello")

  // Shift+F2 does it too; again, the title already says it.
  await composer.click()
  await page.keyboard.press("Shift+F2")
  await expect(thread).toHaveAccessibleName(suggested)
  await expect(row).toContainText(suggested)
  await page.keyboard.press("Shift+F2")
  await expect(toasts.getByText("The title already says it")).toBeVisible()
  await expect(thread).toHaveAccessibleName(suggested)

  // Mark as unread: the Thread is done again, in its row and its header,
  // while it has the focus; Alt+Shift+U again reads it.
  const done = (where: Locator) => where.getByRole("img", { name: "Done" })
  await expect(done(row)).toBeHidden()
  await page.keyboard.press("Alt+Shift+U")
  await expect(done(row)).toBeVisible()
  await expect(done(header)).toBeVisible()
  await page.keyboard.press("Alt+Shift+U")
  await expect(done(row)).toBeHidden()

  // From the menu; leaving the Thread and coming back reads it.
  await header.getByRole("button", { name: suggested, exact: true }).click()
  await page.getByRole("menuitem", { name: /Mark as unread/ }).click()
  await expect(done(row)).toBeVisible()
  await page.keyboard.press("Alt+Enter")
  await expect(thread).toHaveAttribute("data-focused", "false")
  await expect(done(row)).toBeVisible()
  await row.click()
  await expect(done(row)).toBeHidden()
})

test("the Banda menu goes into a Project and the sidebar's view, and Tab shows what a row can do", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })

  // Enter goes into a Project: its new Thread, then its Threads; Backspace
  // in the empty field comes back out.
  await page.keyboard.press("Alt+Space")
  await search.fill("work")
  await expect(menu.getByRole("option").first()).toContainText("Work")
  await search.press("Enter")
  await expect(menu.getByText("Work", { exact: true })).toBeVisible()
  await expect(menu.getByRole("option").first()).toContainText(
    "New Thread here"
  )
  await expect(menu.getByRole("group", { name: "Threads" })).toContainText(
    "hello"
  )
  await search.press("Backspace")
  await expect(
    menu.getByRole("group", { name: "Recent Threads" })
  ).toBeVisible()

  // Tab on a Thread shows its acts; Archive thread puts it away.
  await search.fill("hello")
  await search.press("Tab")
  const acts = menu.getByRole("listbox", { name: "Actions" })
  await expect(acts).toContainText("Open beside")
  // Esc shuts the act list, and the menu stays.
  await search.press("Escape")
  await expect(acts).toBeHidden()
  await expect(menu).toBeVisible()
  await search.press("Tab")
  await expect(acts).toContainText("Open beside")
  await page.screenshot({ path: "test-results/27-banda-menu-acts.png" })
  // Snooze… stands before it (ADR 0074): it is picked by its name.
  await expect(acts).toContainText("Snooze…")
  await acts.getByRole("option", { name: /Archive thread/ }).click()
  await expect(menu).toBeHidden()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(sidebar.getByRole("group", { name: "Archive" })).toBeVisible()
  await expect(thread).toBeHidden()

  // The sidebar's view: its presets, one picked writes the file.
  await page.keyboard.press("Alt+Space")
  await search.fill("view")
  await search.press("Enter")
  await expect(menu.getByRole("option", { name: /inbox/i })).toBeVisible()
  await search.fill("projects")
  await search.press("Enter")
  await expect(menu).toBeHidden()
  await expect(
    sidebar.getByRole("button", { name: "View: projects" })
  ).toBeVisible()
})

test("banda menu opens the Banda menu at a route, from outside the window", async () => {
  window = await startWindow()
  const { page, banda } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  // At its Actions: the key sheet.
  banda("menu", "actions")
  await expect(menu.getByRole("group", { name: "Threads" })).toContainText(
    "Show or hide the sidebar"
  )
  // In a Project, by its name, though the menu is open.
  banda("menu", "project.work")
  await expect(menu.getByText("Work", { exact: true })).toBeVisible()
  await expect(menu.getByRole("group", { name: "Threads" })).toContainText(
    "hello"
  )
  // Other words are typed in.
  banda("menu", "hello")
  await expect(search).toHaveValue("hello")
  await expect(menu.getByRole("option").first()).toContainText("hello")
  await page.screenshot({ path: "test-results/29-banda-menu-route.png" })

  // A settings route opens the settings Pane there, under the menu.
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  banda("menu", "settings.appearance")
  await expect(
    page
      .getByRole("region", { name: "Settings", exact: true })
      .getByRole("heading", { name: "Appearance" })
  ).toBeVisible()
})

test("Add Project adds a folder on disk from the Banda menu, and one banda project add made shows as the window comes back", async () => {
  window = await startWindow()
  const { page, dir, banda } = window
  await firstThread(page)
  const work = join(dir, "work")
  for (const folder of ["app", "api", "cli"])
    mkdirSync(join(work, folder), { recursive: true })
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })

  // The sidebar's folder button opens "Add Project"; "Local folder" starts
  // the path at ~ and lists the folders that fit what is typed.
  await sidebar.getByRole("button", { name: "Add Project" }).click()
  await expect(menu.getByRole("option", { name: /New Project/ })).toBeVisible()
  await search.fill("local")
  await search.press("Enter")
  await expect(search).toHaveValue("~/")
  await search.fill(`${work}/ap`)
  await expect(menu.getByRole("option").first()).toContainText("Create & Add")
  await expect(menu.getByRole("option", { name: "api" })).toBeVisible()
  await page.screenshot({ path: "test-results/30-add-project-folder.png" })
  await menu.getByRole("option", { name: "app" }).click()
  await expect(search).toHaveValue(`${work}/app/`)
  await expect(menu.getByRole("option").first()).toHaveText(/^Add/)

  // Enter adds it, and its new Thread opens.
  await search.press("Enter")
  await expect(menu).toBeHidden()
  await expect(page.getByRole("button", { name: "Project: app" })).toBeVisible()

  // A Project added from a terminal shows once the window comes back to
  // the front.
  banda("project", "add", join(work, "cli"))
  await setInFront(page, false)
  await setInFront(page, true)
  await page.keyboard.press("Alt+Space")
  await search.fill("cli")
  await expect(menu.getByRole("group", { name: "Projects" })).toContainText(
    "cli"
  )
})

test("Open in Files adds the folder picked in the system's picker, opened where the path points", async () => {
  window = await startWindow()
  const { page, dir, app } = window
  await firstThread(page)
  const work = join(dir, "work")
  const picked = join(work, "picked")
  mkdirSync(picked, { recursive: true })
  // The system's picker answers with the folder, and keeps where it opened.
  await app.evaluate(({ dialog }, folder) => {
    const at = globalThis as { pickedAt?: string }
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string }
      at.pickedAt = options.defaultPath
      return { canceled: false, filePaths: [folder] }
    }
  }, picked)
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })

  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: "Add Project" })
    .click()
  await search.fill("local")
  await search.press("Enter")
  await search.fill(`${work}/pi`)
  await expect(menu.getByRole("option", { name: "picked" })).toBeVisible()
  await page.screenshot({ path: "test-results/31-open-in-files.png" })
  await menu.getByRole("button", { name: "Open in Files" }).click()
  await expect(menu).toBeHidden()
  await expect(
    page.getByRole("button", { name: "Project: picked" })
  ).toBeVisible()
  expect(
    await app.evaluate(() => (globalThis as { pickedAt?: string }).pickedAt)
  ).toBe(work)
})

test("a Project is pinned, named, archived and removed from its row's menu and the settings, as in T3 Code", async () => {
  window = await startWindow()
  const { page, dir, app, banda } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread).not.toHaveAccessibleName("New Thread")
  const lab = join(dir, "lab")
  mkdirSync(lab)
  banda("project", "add", lab)
  await setInFront(page, false)
  await setInFront(page, true)
  // The places view lists every Project, each a row with its menu.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await sidebar.getByRole("button", { name: /^View: / }).click()
  await page.getByRole("menuitemradio", { name: /^places/ }).click()
  const projects = sidebar.getByRole("group", { name: "Projects" })
  const header = projects.getByRole("button", { name: /^Work/ })

  // The row's menu: Copy path, and Pin Project, which turns to Unpin.
  await header.click({ button: "right" })
  await page.screenshot({ path: "test-results/32-project-menu.png" })
  await page.getByRole("menuitem", { name: "Copy path" }).click()
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toMatch(/\/Work$/)
  await header.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Pin Project" }).click()
  await header.click({ button: "right" })
  await expect(
    page.getByRole("menuitem", { name: "Unpin Project" })
  ).toBeVisible()

  // Project settings opens the settings at the Project, pinned.
  await page.getByRole("menuitem", { name: "Project settings" }).click()
  const settings = page.getByRole("main").filter({ hasText: "Settings" })
  await expect(
    settings.getByRole("heading", { name: "Projects" })
  ).toBeVisible()
  const picker = settings.getByRole("combobox", { name: "Project" })
  await expect(picker).toContainText("Work")
  await expect(
    settings.getByRole("switch", { name: "Pin Project" })
  ).toBeChecked()

  // A new name shows in the sidebar.
  const name = settings.getByRole("textbox", { name: "Project name" })
  await name.fill("Home")
  await name.press("Enter")
  await expect(projects.getByRole("button", { name: /^Home/ })).toBeVisible()

  // Archived, lab stays only in the settings, where it can come back.
  await picker.click()
  await page.getByRole("option", { name: "lab" }).click()
  await settings.getByRole("button", { name: "Archive" }).click()
  await expect(picker).toContainText("lab (archived)")
  await expect(
    settings.getByRole("button", { name: "Unarchive" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/33-project-settings.png" })

  // Remove asks first, then the Project goes and its folder stays.
  await settings.getByRole("button", { name: "Remove Project" }).click()
  const ask = page.getByRole("dialog", {
    name: 'Remove Project "lab" and delete its 0 Threads?',
  })
  await expect(ask).toContainText(lab)
  await expect(ask).toContainText("This action cannot be undone.")
  await page.screenshot({ path: "test-results/34-remove-project.png" })
  await ask.getByRole("button", { name: "Remove Project" }).click()
  await expect(ask).toBeHidden()
  await expect(picker).toContainText("Home")
  await picker.click()
  await expect(page.getByRole("option", { name: /lab/ })).toBeHidden()
  await page.keyboard.press("Escape")
  expect(existsSync(lab)).toBe(true)
})

test("a Project whose folder is gone shows as missing, and Locate folder opens it where its work is now", async () => {
  // A Project from before, whose folder is no longer there.
  const id = "01a192e5-5e2b-76a7-931a-79a494cb1801"
  const manifest = {
    id,
    name: "old",
    folder: "/nonexistent/banda-old",
    author: { kind: "person", id: "01a192e5-416d-7657-825a-a16f9f43fba6" },
    command: "01a192e5-5e28-794a-b76c-76ef600978a9",
    created_at: 1,
  }
  window = await startWindow({
    files: { [`data/projects/${id}/project.json`]: JSON.stringify(manifest) },
  })
  const { page, dir } = window
  // It opens nothing, so the first screen asks for a Project of its own.
  await firstThread(page)
  const moved = join(dir, "moved")
  mkdirSync(moved)
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await sidebar.getByRole("button", { name: /^View: / }).click()
  await page.getByRole("menuitemradio", { name: /^places/ }).click()
  const old = sidebar
    .getByRole("group", { name: "Projects" })
    .getByRole("button", { name: /^old/ })
  await expect(old).toContainText("Missing")

  // Its row opens "Locate folder" where the folder was.
  await old.click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })
  await expect(search).toHaveValue("/nonexistent/")
  await search.fill(moved)
  await expect(menu.getByRole("option").first()).toHaveText(/^Locate/)
  await page.screenshot({ path: "test-results/35-locate-folder.png" })
  await search.press("Enter")
  await expect(menu).toBeHidden()
  await expect(old).not.toContainText("Missing")
  await expect(page.getByRole("button", { name: "Project: old" })).toBeVisible()
})

test("text selected in a reply is quoted in the composer, a line apart from what is written after it", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("quote me please")
  await composer.press("Enter")
  const reply = thread.getByText("You said: quote me please")
  await expect(reply).toBeVisible()

  // The button shows once text in one reply is selected.
  const quote = thread.getByRole("button", { name: "Quote", exact: true })
  await expect(quote).toBeHidden()
  await reply.evaluate((element) => {
    const text = element.firstChild!
    const range = document.createRange()
    range.setStart(text, "You said: ".length)
    range.setEnd(text, "You said: quote me".length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  })
  await expect(quote).toBeVisible()
  await page.screenshot({ path: "test-results/quote-button.png" })
  await quote.click()
  await expect(quote).toBeHidden()
  await expect(composer.locator("blockquote")).toHaveText("quote me")
  await expect(composer).toBeFocused()

  // What is written after it is a paragraph of its own.
  await page.keyboard.type("why?")
  const drafts = () =>
    page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("banda.agents.draft."))
        .map((key) => localStorage.getItem(key))
    )
  await expect.poll(drafts).toEqual(["> quote me\n\nwhy?"])
  await composer.press("Enter")
  // The message goes with its quote as markdown.
  await expect(thread.getByText("> quote me\n\nwhy?")).toBeVisible()
})

test("a reply forks its Thread, as in T3 Code: the fork opens in its Pane and names the Thread it came from", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("remember apples")
  await composer.press("Enter")
  const reply = thread.getByText("I will remember apples.")
  await expect(reply).toBeVisible()
  await composer.fill("remember pears")
  await composer.press("Enter")
  await expect(thread.getByText("I will remember pears.")).toBeVisible()

  // The first reply forks at the end of its turn; its button shows by
  // Copy on hover or focus.
  const fork = thread
    .getByRole("button", { name: "Fork from this response" })
    .first()
  await fork.focus()
  await expect(fork).toBeEnabled()
  await page.screenshot({ path: "test-results/fork-button.png" })
  await fork.click()
  const forked = page.getByRole("region", { name: "remember apples fork" })
  await expect(forked.getByText("I will remember apples.")).toBeVisible()
  await expect(forked.getByText("I will remember pears.")).toBeHidden()
  const from = forked.getByRole("button", {
    name: "Forked from remember apples",
  })
  await expect(from).toBeVisible()
  await page.screenshot({ path: "test-results/forked.png" })

  // Its Agent knows only what came before the fork.
  const box = forked.getByRole("textbox")
  await box.fill("what do you remember")
  await box.press("Enter")
  await expect(forked.getByText("I remember: apples.")).toBeVisible()

  // The line opens the Thread it was forked from.
  await from.click()
  const source = page.getByRole("region", {
    name: "remember apples",
    exact: true,
  })
  await expect(source).toHaveAttribute("data-focused", "true")
})

test("Edit from here takes the Thread back to before a message, as in T3 Code, and the message goes back to the composer", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("remember apples")
  await composer.press("Enter")
  await expect(thread.getByText("I will remember apples.")).toBeVisible()
  await composer.fill("remember pears")
  await composer.press("Enter")
  const pears = thread.getByText("I will remember pears.")
  await expect(pears).toBeVisible()

  // The pencil shows by Copy on hover or focus, and asks first.
  const edit = thread.getByRole("button", { name: "Edit from here" }).last()
  await edit.focus()
  await expect(edit).toBeEnabled()
  await page.screenshot({ path: "test-results/edit-from-here.png" })
  await edit.click()
  const asking = page.getByRole("dialog", { name: "Edit from here?" })
  await expect(asking).toContainText(
    "Files the Agent changed stay as they are."
  )
  await page.screenshot({ path: "test-results/edit-from-here-asks.png" })
  await asking.getByRole("button", { name: "Edit from here" }).click()

  // The message and what came after it leave; its text is in the box.
  await expect(pears).toBeHidden()
  // Only the composer has its text now.
  await expect(thread.getByText("remember pears", { exact: true })).toHaveCount(
    1
  )
  await expect(composer).toHaveText("remember pears")
  await expect(composer).toBeFocused()
  // The sidebar's row no longer says it was the latest message either.
  await expect(page.getByText("remember pears", { exact: true })).toHaveCount(1)

  // The Agent knows only what came before it.
  await composer.press("Control+a")
  await composer.press("Backspace")
  await page.keyboard.type("what do you remember")
  await composer.press("Enter")
  await expect(thread.getByText("I remember: apples.")).toBeVisible()
})

test("a narrow window hides the sidebar, and Alt+A shows it over the Strip", async () => {
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  await expect(sidebar).toBeVisible()

  const resize = async (width: number) => {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(width, 800),
      width
    )
    await page.setViewportSize({ width, height: 800 })
  }
  // Narrower than the sidebar and a column `[columns] min` (30rem) wide.
  await page.screenshot({ path: "test-results/8a-wide.png" })
  await resize(700)
  await expect(sidebar).toBeHidden()
  const left = async () => (await thread.boundingBox())?.x ?? 0
  await expect.poll(left).toBeLessThan(40)
  await page.screenshot({ path: "test-results/8a-narrow-hidden.png" })

  // Alt+A shows it over the Strip, which stays where it was.
  await page.keyboard.press("Alt+A")
  await expect(sidebar).toBeVisible()
  await expect.poll(left).toBeLessThan(40)
  await page.screenshot({ path: "test-results/8a-narrow.png" })
  // A click beside it, Esc in it, or a Pane opened from it hides it.
  await page.mouse.click(600, 400)
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+A")
  await sidebar.getByRole("button", { name: /hello/ }).focus()
  await page.keyboard.press("Escape")
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+A")
  await sidebar.getByRole("button", { name: /hello/ }).click()
  await expect(sidebar).toBeHidden()
  await expect(thread).toHaveAttribute("data-focused", "true")

  // Wide again, the sidebar is as the Person left it.
  await resize(1280)
  await expect(sidebar).toBeVisible()
  await expect.poll(left).toBeGreaterThan(200)
})

test("the sidebar's edge drags its width, which the Strip follows and the window keeps", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const sidebar = page.getByRole("complementary", { name: "Sidebar" })
  const edge = page.getByRole("separator", { name: "Sidebar width" })
  const width = async () => (await sidebar.boundingBox())?.width ?? 0
  const left = async () => (await thread.boundingBox())?.x ?? 0
  const drag = async (by: number, keep = true) => {
    const box = await edge.boundingBox()
    if (!box) throw new Error("no edge")
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + by, y, { steps: 8 })
    if (!keep) await page.keyboard.press("Escape")
    await page.mouse.up()
  }
  await expect.poll(width).toBe(256)
  const before = await left()

  // 100 pixels wider: the sidebar is, and the Strip starts past it.
  await drag(100)
  await expect.poll(width).toBe(356)
  await expect.poll(left).toBe(before + 100)
  await page.screenshot({ path: "test-results/8a-sidebar-wider.png" })
  // Esc while dragging puts it back as it was.
  await drag(-60, false)
  await expect.poll(width).toBe(356)
  // The window keeps it.
  await page.reload()
  await expect.poll(width).toBe(356)

  // Dragged past the narrowest, letting go hides it; Alt+A brings it
  // back as wide as it was.
  await drag(-300)
  await expect(sidebar).toBeHidden()
  await page.keyboard.press("Alt+A")
  await expect.poll(width).toBe(356)

  // A double-click puts 16rem back, and the keys size it a rem a time.
  await edge.dblclick()
  await expect.poll(width).toBe(256)
  await edge.focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(width).toBe(272)

  // Its foot, icons with no words beside them: the gear, the key sheet,
  // the theme, the view and Add Project.
  await sidebar
    .getByRole("button", { name: "Every action and its key" })
    .click()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await expect(menu.getByRole("group", { name: "Banda" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await sidebar.getByRole("button", { name: /^Theme/ }).click()
  await page.getByRole("menuitemradio", { name: "Dark" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect
    .poll(() => readFileSync(join(window.dir, "config/look.toml"), "utf8"))
    .toContain('mode = "dark"')
  await expect(sidebar.getByRole("button", { name: /^View: / })).toBeVisible()
  await expect(
    sidebar.getByRole("button", { name: "Add Project" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/8a-sidebar-foot.png" })
})

test("Alt+` drops the drawer: a Thread over the workspace that stays as it was, and its pin makes it a column", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const mine = page
    .getByRole("region", { name: "hello" })
    .getByRole("textbox", { name: "Message to Fake AI" })

  const drawer = page.getByRole("dialog", { name: "Drawer" })
  await page.keyboard.press("Alt+Backquote")
  await expect(drawer).toHaveAttribute("data-drawer")
  const ask = drawer.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(ask).toBeFocused()
  await ask.fill("quick one")
  await ask.press("Enter")
  await expect(drawer.getByText("You said: quick one")).toBeVisible()
  await page.screenshot({ path: "test-results/8b-drawer.png" })

  // Esc lifts it, and the focus goes back to the workspace.
  await page.keyboard.press("Escape")
  await expect(drawer).not.toHaveAttribute("data-drawer")
  await expect(mine).toBeFocused()
  // Dropped again, it is as it was.
  await page.keyboard.press("Alt+Backquote")
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(drawer.getByText("You said: quick one")).toBeVisible()
  // The key lifts it too.
  await page.keyboard.press("Alt+Backquote")
  await expect(drawer).not.toHaveAttribute("data-drawer")

  // Its pin makes it a column of the workspace; the next drop is a new
  // Thread.
  await page.keyboard.press("Alt+Backquote")
  await drawer.getByRole("button", { name: "Pin" }).click()
  await expect(drawer).toBeHidden()
  const pinned = page.getByRole("region", { name: "quick one" })
  await expect(pinned.getByText("You said: quick one")).toBeVisible()
  await page.keyboard.press("Alt+Backquote")
  await expect(drawer).toHaveAttribute("data-drawer")
  await expect(drawer.getByText("You said: quick one")).toBeHidden()
})

test("a Pane pops out into a window of its own, its place keeps a stand-in, and closing that window brings it back", async () => {
  window = await startWindow()
  const { page, app } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const tile = page.getByRole("region", { name: "hello" })
  // A row of the Pane menu (ADR 0066, decision 5).
  const popOut = async () => {
    await tile.getByRole("button", { name: "Pane menu" }).click()
    const [popped] = await Promise.all([
      app.waitForEvent("window"),
      page.getByRole("menuitem", { name: "In its own window" }).click(),
    ])
    await popped.waitForLoadState()
    return popped
  }
  const windows = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

  /** Sizes or closes the Pane's own window, as the Person would. */
  const inPopped = (how: "size" | "close") =>
    app.evaluate(({ BrowserWindow }, how) => {
      const popped = BrowserWindow.getAllWindows().find((one) =>
        one.webContents.getURL().includes("#pane/")
      )
      if (how === "size") popped?.setSize(640, 560)
      else popped?.close()
    }, how)

  // The same Thread, in its own window; its place keeps a stand-in.
  const popped = await popOut()
  await expect(popped.getByText("You said: hello")).toBeVisible()
  const ask = popped.getByRole("textbox", { name: "Message to Fake AI" })
  await ask.fill("again")
  await ask.press("Enter")
  await expect(popped.getByText("You said: again")).toBeVisible()
  const standIn = tile.getByRole("button", { name: "In its own window" })
  await expect(standIn).toBeVisible()
  await expect(composer).toBeHidden()
  // Headless, a second window keeps no size it was made with.
  await inPopped("size")
  await page.screenshot({ path: "test-results/8c-stand-in.png" })
  await popped.screenshot({ path: "test-results/8c-popped.png" })

  // Closing its window brings it back to its place, as it is now.
  await inPopped("close")
  await expect(standIn).toBeHidden()
  await expect(tile.getByText("You said: again")).toBeVisible()
  await expect.poll(windows).toBe(1)

  // Alt+W in its window closes the Pane, and the window with it.
  const again = await popOut()
  await expect(again.getByText("You said: again")).toBeVisible()
  await again
    .getByRole("textbox", { name: "Message to Fake AI" })
    .press("Alt+KeyW")
  await expect(tile).toBeHidden()
  await expect.poll(windows).toBe(1)
})

test("the Pane menu sizes a column, and the header's right, double and middle clicks work it", async () => {
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const tile = page.getByRole("region", { name: "hello" })
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await expect.poll(() => sharesOf(page)).toEqual([50, 50])

  // Its button at the header's end opens it; each row shows its key.
  await tile.getByRole("button", { name: "Pane menu" }).click()
  const menu = page.getByRole("menu")
  await expect(
    menu.getByRole("menuitem", { name: "Full width Alt+F" })
  ).toBeVisible()
  await page.screenshot({ path: "test-results/pane-menu.png" })
  await menu.getByRole("menuitem", { name: "Width 1/3" }).click()
  await expect(menu).toBeHidden()
  await expect.poll(() => sharesOf(page)).toEqual([33, 50])
  await expect(tile).toHaveAttribute("data-focused", "true")

  // A right click on the header opens it where the pointer is.
  const at = await headerOf(tile)
  await page.mouse.click(at.x, at.y, { button: "right" })
  await menu.getByRole("menuitem", { name: "Width 2/3" }).click()
  await expect.poll(() => sharesOf(page)).toEqual([67, 50])

  // A double click past the title, whose own renames it (ADR 0077): the
  // whole screen wide, and back.
  const title = (await tile.locator("header h2").boundingBox())!
  const past = { x: title.x + title.width + 24, y: at.y }
  await page.mouse.dblclick(past.x, past.y)
  await expect.poll(() => sharesOf(page)).toEqual([100, 50])
  await page.mouse.dblclick(past.x, past.y)
  await expect.poll(() => sharesOf(page)).toEqual([67, 50])

  // A middle click closes the Pane.
  const there = await headerOf(launcher)
  await page.mouse.click(there.x, there.y, { button: "middle" })
  await expect(launcher).toBeHidden()
})

test("a column moved along the Strip by Alt+Shift+Arrows stays in view", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  const thread = page.getByRole("region", { name: "hello" })
  await expect(thread.getByText("You said: hello")).toBeVisible()
  // Columns of one width, more than the Strip shows.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Alt+Enter")
    await expect(page.locator("[data-column]")).toHaveCount(i + 2)
  }
  await page.keyboard.press("Alt+Home")
  await expect(thread).toHaveAttribute("data-focused", "true")
  const id = await thread.getAttribute("data-tile")
  const place = async () =>
    (await layoutOf(page)).findIndex((column) => column.includes(id!))
  // To the far end and back, one column a step, the Strip following it.
  const steps = [
    ["ArrowRight", 1],
    ["ArrowRight", 2],
    ["ArrowRight", 3],
    ["ArrowLeft", 2],
    ["ArrowLeft", 1],
    ["ArrowLeft", 0],
  ] as const
  for (const [way, at] of steps) {
    await page.keyboard.press(`Alt+Shift+${way}`)
    await expect.poll(place).toBe(at)
    await expect(thread).toBeInViewport({ ratio: 0.99 })
  }
})

test("Alt+Up and Down go on past a column's end to the workspace there, and with Shift take the Pane along", async () => {
  window = await startWindow()
  const { page } = window
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  const thread = page.getByRole("region", { name: "hello" })
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const on = (n: string) => onWorkspace(page, n)
  // A launcher on the workspace below, the Thread alone on this one.
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Shift+Digit2")
  await on("2")
  await page.keyboard.press("Alt+PageUp")
  await on("1")
  await expect(thread).toHaveAttribute("data-focused", "true")

  // A key held stops at the column's end; a new press goes on.
  await page.keyboard.down("Alt")
  await page.keyboard.down("ArrowDown")
  await on("2")
  await page.keyboard.down("ArrowDown")
  await page.keyboard.down("ArrowDown")
  await page.keyboard.up("ArrowDown")
  await page.keyboard.up("Alt")
  await on("2")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+ArrowUp")
  await on("1")
  await expect(thread).toHaveAttribute("data-focused", "true")

  // With Shift the Thread goes along, as a column beside the launcher.
  await page.keyboard.press("Alt+Shift+ArrowDown")
  await on("2")
  await expect(thread).toHaveAttribute("data-focused", "true")
  await expect(launcher).toBeVisible()
})

test("Alt+Shift+PageUp and PageDown move the workspace on screen, never under the empty one", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const on = (n: string) => onWorkspace(page, n)
  // The Thread on workspace 1, a launcher on 2, the empty one under.
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+Shift+Digit2")
  await on("2")

  // Up, the launcher's workspace goes first, and stays on screen.
  await page.keyboard.press("Alt+Shift+PageUp")
  await on("1")
  await expect(launcher).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+PageDown")
  await on("2")
  await expect(thread).toHaveAttribute("data-focused", "true")

  // Down, the Thread's would go under the empty one: it stays.
  await page.keyboard.press("Alt+Shift+PageDown")
  await on("2")
  await page.keyboard.press("Alt+PageUp")
  await on("1")
  await expect(launcher).toHaveAttribute("data-focused", "true")
})

test("markdown shows local images, video and audio, with an image preview and working playback", async () => {
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  const folder = join(dir, "root", "Work")
  copyFileSync(
    resolve(import.meta.dirname, "shot.png"),
    join(folder, "a picture.png")
  )
  copyFileSync(
    resolve(import.meta.dirname, "media.webm"),
    join(folder, "clip.webm")
  )
  copyFileSync(
    resolve(import.meta.dirname, "media.wav"),
    join(folder, "sound.wav")
  )
  writeFileSync(join(folder, "corrupt.png"), "not an image")
  const markdown = [
    "![Sample picture](<./a picture.png>)",
    `![A video](${join(folder, "clip.webm")})`,
    "![A sound](sound.wav)",
    "![Missing](./absent.png)",
    "![Corrupt](./corrupt.png)",
    "![Notes](./notes.txt)",
  ].join("\n\n")
  await composer.fill(markdown)
  await composer.press("Enter")
  const picture = thread.getByRole("button", { name: "Open Sample picture" })
  await expect(picture).toBeVisible()
  await expect
    .poll(() =>
      picture
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth)
    )
    .toBeGreaterThan(0)
  await expect(
    thread.getByRole("link", { name: "Missing (unavailable)", exact: true })
  ).toBeVisible()
  await expect(
    thread.getByRole("link", { name: "Notes", exact: true })
  ).toBeVisible()
  await expect(
    thread.getByRole("link", { name: "Corrupt (unavailable)", exact: true })
  ).toBeVisible()
  const video = thread.locator("video")
  const audio = thread.locator("audio")
  for (const player of [video, audio]) {
    await expect(player).toHaveAttribute("controls", "")
    await expect
      .poll(() =>
        player.evaluate((media: HTMLMediaElement) => media.readyState)
      )
      .toBeGreaterThanOrEqual(1)
    expect(
      await player.evaluate((media: HTMLMediaElement) => media.paused)
    ).toBe(true)
    await player.evaluate(async (media: HTMLMediaElement) => {
      media.muted = true
      await media.play()
    })
    await expect
      .poll(() =>
        player.evaluate((media: HTMLMediaElement) => media.currentTime)
      )
      .toBeGreaterThan(0)
    await player.evaluate((media: HTMLMediaElement) => {
      media.pause()
      media.currentTime = 0.1
    })
    await expect
      .poll(() =>
        player.evaluate((media: HTMLMediaElement) => media.currentTime)
      )
      .toBeCloseTo(0.1)
  }
  await page.screenshot({ path: "test-results/19-markdown-media.png" })
  await picture.click()
  const preview = page.getByRole("dialog", { name: "Sample picture" })
  await expect(
    preview.getByRole("img", { name: "Sample picture" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(preview).toBeHidden()
})

test("a Pane gets a URL for any file the Person opens, served as what it is and never as a page; a reply's media stays media", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  await firstThread(page)
  const folder = join(dir, "root", "Work")
  writeFileSync(join(folder, "page.html"), "<script>alert(1)</script>")
  writeFileSync(join(folder, "data.bin"), "bytes")
  const project = (
    JSON.parse(window.banda("call", "projects.list")) as {
      ok: { id: string; folder: string }[]
    }
  ).ok.find((one) => one.folder === folder)!
  type Desktop = {
    files: { url: (project: string, path: string) => Promise<string | null> }
    agents: { media: (project: string, path: string) => Promise<string | null> }
  }
  const ask = (leaf: "files" | "agents", path: string) =>
    page.evaluate(
      ([leaf, project, path]) => {
        const { banda } = globalThis as unknown as { banda: Desktop }
        return leaf === "files"
          ? banda.files.url(project, path)
          : banda.agents.media(project, path)
      },
      [leaf, project.id, path] as const
    )
  const served = (url: string) =>
    app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url)
      return {
        type: response.headers.get("content-type"),
        sandbox: response.headers.get("content-security-policy"),
        text: await response.text(),
      }
    }, url)
  for (const [path, type, text] of [
    ["page.html", "text/plain; charset=utf-8", "<script>alert(1)</script>"],
    [join(folder, "data.bin"), "application/octet-stream", "bytes"],
  ]) {
    const url = await ask("files", path)
    expect(url, path).toMatch(/^app:\/\/files\//)
    expect(await served(url!), path).toEqual({
      type,
      sandbox: "default-src 'none'; sandbox",
      text,
    })
  }
  expect(await ask("files", "absent.txt")).toBeNull()
  expect(await ask("agents", "page.html")).toBeNull()
})

test("markdown renders Mermaid and math in the look's light and dark, keeping code and escaped currency as text", async () => {
  window = await startWindow({ look: 'mode = "light"\n' })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill(
    String.raw`Inline $E = mc^2$.

$$
\frac{1}{2} + \sqrt{4} = 2.5
$$

Price: \$10.

Code: \`$x$\`.

\`\`\`mermaid
flowchart LR
  A[Request] --> B[Check] --> C[Thread]
\`\`\`
`.replaceAll("\\`", "`")
  )
  await composer.press("Enter")
  const markdown = thread.locator('[data-slot="markdown"]')
  await expect(markdown.locator(".katex")).toHaveCount(2)
  await expect(markdown.locator(".katex-display")).toHaveCount(1)
  await expect(markdown.locator("annotation").first()).toHaveText("E = mc^2")
  await expect(
    markdown.locator("code").filter({ hasText: "$x$" })
  ).toBeVisible()
  await expect(
    markdown.getByText("Price: $10.", { exact: false })
  ).toBeVisible()
  const diagram = markdown
    .getByRole("img", { name: "Mermaid chart" })
    .locator("svg")
  await expect(diagram).toBeVisible()
  await expect(diagram).toContainText("Request")
  await expect(diagram).toContainText("Check")
  const light = await diagram
    .locator(".node rect")
    .first()
    .evaluate((rect) => getComputedStyle(rect).fill)
  await page.screenshot({ path: "test-results/20-diagrams-light.png" })
  writeFileSync(join(window.dir, "config/look.toml"), 'mode = "dark"\n')
  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect
    .poll(() =>
      diagram
        .locator(".node rect")
        .first()
        .evaluate((rect) => getComputedStyle(rect).fill)
    )
    .not.toBe(light)
  await expect(markdown.locator(".katex")).toHaveCount(2)
  await page.screenshot({ path: "test-results/20-diagrams-dark.png" })
  expect(
    await markdown
      .locator(".katex")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
  ).toContain("KaTeX_Main")
  await markdown.getByRole("button", { name: "View fullscreen" }).click()
  const full = page.getByRole("dialog", { name: "View fullscreen" })
  await expect(full.getByRole("img", { name: "Mermaid chart" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(full).toBeHidden()

  // An invalid diagram remains a readable error; the Thread stays usable.
  await composer.fill("Broken diagram:\n\n```mermaid\nnotARealDiagram\n```")
  await composer.press("Enter")
  await expect(thread.getByText(/Mermaid Error:/)).toBeVisible()
  await expect(composer).toBeEditable()
})

test("No Project creates a folder only on the first message", async () => {
  window = await startWindow()
  const { page, dir } = window
  const composer = page.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(composer).toBeVisible()
  expect(existsSync(join(dir, "root", "scratch"))).toBe(false)
  await composer.fill("scratch hello")
  await composer.press("Enter")
  await expect(page.getByText("You said: scratch hello")).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "Sidebar" })
  ).toContainText("scratch hello")
  expect(existsSync(join(dir, "root", "scratch"))).toBe(true)
  await expect(
    page.getByRole("group", { name: "No Project", exact: true })
  ).toHaveCount(0)
  const view = page.getByRole("button", { name: /^View: / })
  await view.click()
  await page.getByRole("menuitemradio", { name: /^projects/ }).click()
  await expect(
    page.getByRole("group", { name: "No Project", exact: true })
  ).toContainText("scratch hello")
  await view.click()
  await page.getByRole("menuitemradio", { name: /^places/ }).click()
  await expect(
    page.getByRole("group", { name: "No Project", exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole("complementary", { name: "Sidebar" })
  ).toContainText("scratch hello")
})

test("No Project keeps its first attachment and message in one folder", async () => {
  window = await startWindow()
  const { page, dir } = window
  const composer = page.getByRole("textbox", { name: "Message to Fake AI" })
  await expect(composer).toBeVisible()
  const shot = await page.screenshot()
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: shot })
  await expect.poll(() => existsSync(join(dir, "root", "scratch"))).toBe(true)
  await composer.fill("image from scratch")
  await composer.press("Enter")
  await openWork(page.getByRole("region", { name: "image from scratch" }))
  await expect(page.getByText("I see 1 image: image/png.")).toBeVisible()
  expect(readdirSync(join(dir, "root", "scratch"))).toHaveLength(1)
})

test("a No Project Thread becomes a Project and keeps working after its folder moves", async () => {
  window = await startWindow()
  const { page, dir } = window
  const composer = page.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("promote this")
  await composer.press("Enter")
  const thread = page.getByRole("region", { name: "promote this", exact: true })
  await expect(
    thread.getByRole("button", { name: /^Worked for/ })
  ).toBeVisible()
  const scratch = join(dir, "root", "scratch")
  const original = join(scratch, readdirSync(scratch)[0])
  writeFileSync(join(original, "notes.txt"), "keep my files")
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /promote this/ })
    .click({ button: "right" })
  await page.getByRole("menuitem", { name: "Make a Project from it…" }).click()
  const dialog = page.getByRole("dialog", {
    name: "Make a Project from this Thread",
  })
  await dialog.getByLabel("Name", { exact: true }).fill("Promoted")
  await dialog
    .getByRole("button", { name: "Make Project", exact: true })
    .click()
  await expect(dialog).toBeHidden()
  expect(existsSync(original)).toBe(false)
  expect(readFileSync(join(dir, "root", "Promoted", "notes.txt"), "utf8")).toBe(
    "keep my files"
  )
  await expect(
    page.getByRole("complementary", { name: "Sidebar" })
  ).toContainText("promote this")
  await composer.fill("after moving")
  await composer.press("Enter")
  await expect(thread.getByText("You said: after moving")).toBeVisible()
})

test("promotion can keep the folder where it is", async () => {
  window = await startWindow()
  const { page, dir } = window
  const composer = page.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("keep here")
  await composer.press("Enter")
  await expect(page.getByRole("button", { name: /^Worked for/ })).toBeVisible()
  const scratch = join(dir, "root", "scratch")
  const original = join(scratch, readdirSync(scratch)[0])
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /keep here/ })
    .click({ button: "right" })
  await page.getByRole("menuitem", { name: "Make a Project from it…" }).click()
  const dialog = page.getByRole("dialog", {
    name: "Make a Project from this Thread",
  })
  await dialog.getByLabel("Name", { exact: true }).fill("Kept")
  await dialog.getByRole("radio", { name: /Keep it where it is/ }).check()
  await dialog
    .getByRole("button", { name: "Make Project", exact: true })
    .click()
  await expect(dialog).toBeHidden()
  expect(existsSync(original)).toBe(true)
  expect(existsSync(join(dir, "root", "Kept"))).toBe(false)
})

test("moving a No Project folder waits for its Turn and terminals", async () => {
  window = await startWindow()
  const { page, dir } = window
  const composer = page.getByRole("textbox", { name: "Message to Fake AI" })
  await composer.fill("please ask first")
  await composer.press("Enter")
  const thread = page.getByRole("region", {
    name: "please ask first",
    exact: true,
  })
  const question = thread.getByRole("group", { name: "Run a check" })
  await expect(question).toBeVisible()
  const row = page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /please ask first/ })
  const dialog = page.getByRole("dialog", {
    name: "Make a Project from this Thread",
  })
  const openPromotion = async () => {
    await row.click({ button: "right" })
    await page
      .getByRole("menuitem", { name: "Make a Project from it…" })
      .click()
    await dialog.getByLabel("Name", { exact: true }).fill("Later")
    await dialog
      .getByRole("button", { name: "Make Project", exact: true })
      .click()
  }
  await openPromotion()
  await expect(dialog.getByRole("alert")).toContainText("Turn")
  expect(existsSync(join(dir, "root", "Later"))).toBe(false)
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await question.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(
    thread.getByRole("button", { name: /^Worked for/ })
  ).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const terminal = terminalTile(page)
  await expect(
    terminal.getByRole("region", { name: "Terminal screen" })
  ).toHaveAttribute("data-state", "running")
  await openPromotion()
  await expect(dialog.getByRole("alert")).toContainText("terminals")
  expect(existsSync(join(dir, "root", "Later"))).toBe(false)
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await terminal.getByRole("button", { name: /^Close / }).click()
  await openPromotion()
  await expect(dialog).toBeHidden()
  expect(existsSync(join(dir, "root", "Later"))).toBe(true)
})

test("a tool's images show when opened, enlarge on a click, and remain after a reload", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("tool images raw")
  await composer.press("Enter")
  await expect(thread.getByText("The screenshots are ready.")).toBeVisible()
  for (let pass = 0; pass < 2; pass++) {
    await openWork(thread)
    const tool = thread.getByRole("button", {
      name: "Screenshot result",
      exact: true,
    })
    const images = thread.getByRole("button", {
      name: "Open An image",
      exact: true,
    })
    await expect(images).toHaveCount(0)
    await tool.click()
    await expect(images).toHaveCount(2)
    await expect(thread.getByText("Before the screenshot.")).toBeVisible()
    await expect(thread.getByText("After the screenshot.")).toBeVisible()
    await expect(thread.getByText(/^Image could not be shown:/)).toBeVisible()
    await expect
      .poll(() =>
        images
          .first()
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth)
      )
      .toBeGreaterThan(0)
    await images.first().click()
    const preview = page.getByRole("dialog", { name: "An image", exact: true })
    await expect(
      preview.getByRole("img", { name: "An image", exact: true })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(preview).toBeHidden()
    await page.screenshot({ path: `test-results/21-tool-images-${pass}.png` })
    if (pass === 0) {
      await page.reload()
      await expect(thread.getByText("The screenshots are ready.")).toBeVisible()
    }
  }
})
