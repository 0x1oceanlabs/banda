/**
 * Later on asking, and Someday: the window half (ADR 0098, decisions 11
 * and 12). A Thread that asks may be put off by its Person: it sleeps with
 * its question, and comes back Woke with it. Someday keeps no time: its
 * turn's end does not wake it, a new question does.
 *
 * Screenshots go to test-results/sidebar-l1-*.png, dark and light, at
 * 1440×900: the picker on an asking card, with its Someday line, and a
 * row put off Someday.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import {
  agentSays,
  firstThread,
  leaveSidebar,
  pickerOf,
  sidebarOf,
  startWindow,
  threadNamed,
  toastsOf,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** The bar's Mark, named by what calls. */
const markOf = (page: Page) => page.getByRole("button", { name: /^Sidebar/ })

/** The window at 1440×900, the size the sidebar's screenshots share,
 * its marks in their still poses, as marks.spec.ts draws them: a picture
 * shows a look, not a frame of its motion. */
async function wide({ app, page }: Window) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900)
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: "reduce" })
}

/** What shows now, dark and then light, as `look.toml` turns it. */
async function shots({ page, dir }: Window, name: string) {
  for (const mode of ["dark", "light"]) {
    writeFileSync(join(dir, "config/look.toml"), `mode = "${mode}"\n`)
    if (mode === "dark") await expect(page.locator("html")).toHaveClass(/dark/)
    else await expect(page.locator("html")).not.toHaveClass(/dark/)
    await page.screenshot({
      path: `test-results/sidebar-l1-${name}-${mode}.png`,
      animations: "disabled",
    })
  }
}

test("a Thread that asks is put off for a minute, waits with its question, and comes back Woke with it (ADR 0098, decision 11)", async () => {
  // Its Later's minute passes in real time: the host wakes it then.
  test.setTimeout(150_000)
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await wide(window)
  const { thread, composer } = await firstThread(page)
  await composer.fill("please ask first")
  await composer.press("Enter")
  const question = thread.getByRole("group", { name: "Run a check" })
  await expect(question).toContainText("Allow Fake AI to run a command?")
  const sidebar = sidebarOf(page)
  const row = sidebar.getByRole("button", { name: /please ask first/ })
  await expect(row).toContainText("Asks Run a check")
  await expect(markOf(page)).toHaveAccessibleName(/Asks you/)

  // Alt+Z opens the picker on it, as on any Thread: no refusal, a note
  // that it waits, and Someday last, set apart.
  await page.keyboard.press("Alt+KeyZ")
  const picker = pickerOf(page)
  await expect(picker).toContainText("please ask first")
  await expect(picker).toContainText("It waits with its question")
  const lines = picker.getByRole("option")
  await expect(lines.last()).toContainText("Someday")
  await expect(lines.last()).toContainText("no time")
  // No line has an icon, so no line keeps room for one.
  await expect(lines.locator(".size-4")).toHaveCount(0)
  await shots(window, "picker-asking")

  const field = picker.getByRole("textbox", { name: "When it comes back" })
  await expect(field).toBeFocused()
  await field.fill("1m")
  await expect(picker).toContainText("in 1m")
  await field.press("Enter")

  // Put off, its Pane closes and it calls no one while it sleeps.
  await expect(picker).toBeHidden()
  await expect(thread).toBeHidden()
  await expect(toastsOf(page).getByText(/^Later, until /)).toBeVisible()
  await expect(row).toBeHidden()
  await expect(markOf(page)).toHaveAccessibleName("Sidebar")
  await leaveSidebar(page)

  // Its time comes: it is the Person's turn again, Woke, with the same
  // question. Its look is woke until it is seen, so the bar's Mark rings
  // that (ADR 0099, decision 9); seen, it is the question that calls.
  await expect(row).toBeVisible({ timeout: 90_000 })
  await expect(row.getByRole("img", { name: "Woke" })).toBeVisible()
  await expect(row).toContainText(
    /Woke You put it off \d+[sm] ago · Run a check/
  )
  await expect(markOf(page)).toHaveAccessibleName(/Woke/)
  await row.click()
  await expect(question).toContainText("Allow Fake AI to run a command?")
  await expect(markOf(page)).toHaveAccessibleName(/Asks you/)
  await question.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(thread.getByText("The check passed.")).toBeVisible()
})

test("a Thread put off Someday sleeps on as its turn ends, until a new question wakes it (ADR 0098, decision 12)", async () => {
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { page } = window
  await wide(window)
  const sidebar = sidebarOf(page)

  // "pages 1" works until the file `go` is in Work's folder; "hello c"
  // opens last, so its Agent is the one `agentSays` speaks for.
  const { composer } = await firstThread(page)
  await composer.fill("pages 1")
  await composer.press("Enter")
  const a = page.getByRole("region", { name: "pages 1", exact: true })
  await expect(a).toBeVisible()
  await expect
    .poll(() => threadNamed(window, "pages 1")?.latest?.state)
    .toBe("running")
  await page.keyboard.press("Alt+Enter")
  const box = page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  await expect(box).toBeFocused()
  await box.fill("hello c")
  await box.press("Enter")
  await expect(
    page
      .getByRole("region", { name: "hello c", exact: true })
      .getByText("You said: hello c")
  ).toBeVisible()

  // At work, the picker's first line is the end of its turn; Someday is
  // picked instead.
  const row = sidebar.getByRole("button", { name: /pages 1/ })
  await row.click({ button: "right" })
  await page
    .getByRole("menu", { name: "Thread menu" })
    .getByRole("menuitem", { name: /^Later…/ })
    .click()
  const picker = pickerOf(page)
  await expect(picker.getByRole("option").first()).toContainText(
    "When it's done"
  )
  await picker.getByRole("option", { name: /Someday/ }).click()
  await expect(picker).toBeHidden()
  await expect(toastsOf(page).getByText("Later, someday")).toBeVisible()
  await expect(a).toBeHidden()
  await expect
    .poll(() => threadNamed(window, "pages 1")?.later?.someday)
    .toBe(true)
  // Its turn runs on, but put off it is away: the bar leaves it out, and
  // nothing else works or calls.
  await expect(markOf(page)).toHaveAccessibleName("Sidebar")

  // Its card in Later says it keeps no time.
  const tab = (name: string) =>
    sidebar.getByRole("tab", { name: new RegExp(`^${name}`) })
  await tab("Later").click()
  await expect(tab("Later")).toHaveAttribute("aria-selected", "true")
  await expect(row).toContainText("someday")
  await shots(window, "someday-row")
  await leaveSidebar(page)

  // Its turn ends by itself, done: Someday sleeps on. It is not stopped:
  // a stop holds the Thread's queue until its Person's word, and the
  // message below would wait in it, never asked.
  writeFileSync(join(window.dir, "root/Work/go"), "")
  await expect
    .poll(() => threadNamed(window, "pages 1")?.latest?.state)
    .toBe("done")
  await expect(row).toContainText("someday")
  const { id, later } = threadNamed(window, "pages 1")!
  expect(later?.woke).toBeUndefined()

  // Another Agent writes to it, which is not its Person's word and wakes
  // nothing; the turn it opens runs, its Agent asks, and the question
  // wakes it: the Person's turn, said as the question, not as woke.
  await agentSays(window, "send", { thread: id, text: "please ask first" })
  await expect
    .poll(() => threadNamed(window, "pages 1")?.later?.woke?.by)
    .toBe("question")
  // It has left Later for the Inbox's Your turn.
  await expect(row).toBeHidden()
  await tab("Inbox").click()
  await expect(row).toContainText("Asks Run a check")
  await expect(row).not.toContainText("someday")
  await expect(row.getByRole("img", { name: "Woke" })).toHaveCount(0)
  await expect(markOf(page)).toHaveAccessibleName(/Asks you/)
})
