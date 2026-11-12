/**
 * Roma's day, as he works it: ten Agents in a row in one Project, the
 * Flow, Solo, Laters, Alt+U with the Sidebar hidden, keys pressed faster
 * than the Window draws. A net under the Window's split (ADR 0087): each
 * test holds what the Person sees today, so a move that changes it fails
 * here first. Two hold sight (ADR 0087, decision 9): an Agent that
 * finishes scrolled out of view, or behind the Group Solo fills the
 * screen with, gets its toast. One on screen gets none, in window.spec.ts.
 *
 * An Agent whose first message says "wait" works until the test ends its
 * turn, so what calls and when is the test's to say, never a clock's.
 */
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import {
  call,
  FREE,
  countNotes,
  finish,
  firstThread,
  fromLeft,
  layoutOf,
  leaveSidebar,
  ON_SCREEN,
  openTerminal,
  pickerOf,
  pressAtOnce,
  sharesOf,
  shownOf,
  sidebarOf,
  startWindow,
  TEN_KEYS,
  textOf,
  threadNamed,
  toastsOf,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Columns half the Strip wide, whatever Banda's default. */
const HALVES = '[columns]\ndefault = "1/2"\n'

/** The Flow's button, on the bar beside the workspaces (ADR 0098,
 * decision 20). */
const flowOf = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Flow: / })

/**
 * Sends `text` from the message `box`: the first message of its Thread,
 * which then names it. One that says "wait" starts a turn that goes on;
 * any other is answered, and its turn ends while the Person looks at it,
 * so it calls no one and makes no sound.
 */
async function say(window: Window, box: Locator, text: string) {
  const { page } = window
  await box.fill(text)
  await box.press("Enter")
  const thread = page.getByRole("region", { name: text, exact: true })
  if (text.includes("wait")) {
    await expect(thread.getByText("Waiting.")).toBeVisible()
    return thread
  }
  await expect(thread.getByText(`You said: ${text}`)).toBeVisible()
  // Its turn is over in the engine, and the Window took it in, seen: its
  // card's Mark has the open look (ADR 0099).
  await expect.poll(() => threadNamed(window, text)?.latest?.state).toBe("done")
  const row = sidebarOf(page).getByRole("option", { name: new RegExp(text) })
  await expect(row.getByRole("img", { name: "Open" })).toBeVisible()
  return thread
}

/** An Agent in the Project in front: a New Thread, started with `text`. */
async function startAgent(window: Window, text: string) {
  await window.page.keyboard.press("Alt+Enter")
  const box = window.page
    .getByRole("region", { name: "New Thread" })
    .getByRole("textbox", { name: "Message to Fake AI" })
  await expect(box).toBeFocused()
  return say(window, box, text)
}

/** Agents in the Project "Work", one a Thread started with each of
 * `texts`, in their order; the last is in front. */
async function agents(window: Window, ...texts: string[]) {
  const { composer: box } = await firstThread(window.page)
  const threads = [await say(window, box, texts[0])]
  for (const text of texts.slice(1))
    threads.push(await startAgent(window, text))
  return threads
}

/** Picks the Flow `name` in its menu, which Esc then closes. */
async function pickFlow(page: Page, name: "Free" | "Row" | "Solo") {
  await flowOf(page).click()
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^${name}`) })
    .click()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
  await expect(flowOf(page)).toHaveAccessibleName(`Flow: ${name}`)
}

/**
 * The Agent at work in the Thread named `title`, out of sight on the
 * workspace on screen, finishes: it calls with its sound and its toast,
 * as an Agent on another workspace does (ADR 0087, decision 9). Its toast's
 * region and its "Done" are pinned for that one, in window.spec.ts.
 */
async function toastedOutOfView(
  window: Window,
  title: string,
  others: string[]
) {
  const { page } = window
  const done = (one: string) =>
    sidebarOf(page)
      .getByRole("option", { name: new RegExp(one) })
      .getByRole("img", { name: "Done" })
  // The other Agents chimed as their turns ended, and a chime within
  // 1.5 s of the one before plays not at all (QUIET_FOR in
  // platform/notifications/pane/src/sound.ts): once their turns are done,
  // that much time goes by before this one ends.
  for (const other of others)
    await expect
      .poll(() => threadNamed(window, other)?.latest?.state)
      .toBe("done")
  await page.waitForTimeout(1_600)
  const notes = await countNotes(page)
  finish(window, title)
  await expect(done(title)).toBeVisible()
  await expect.poll(notes).toBeGreaterThan(0)
  // Its own toast, or the joined one it is in.
  await expect(
    toastsOf(page).getByRole("listitem").filter({ hasText: title })
  ).toContainText("Done")
}

test("the Flow is picked on the bar, after the workspaces, and kept in agents.toml, and Alt+Shift+M goes between the row and solo (ADR 0079, ADR 0098)", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const flow = flowOf(page)
  const file = join(dir, "config/agents.toml")
  const written = () => textOf(file).match(/^flow = "(\w+)"$/m)?.[1]
  // The row is the default, and nothing is written for it.
  await expect(flow).toHaveAccessibleName("Flow: Row")
  expect(written()).toBeUndefined()
  // It stands on the bar's left, after the workspaces, and the sidebar's
  // header has it no more: it arranges the desk, not the list.
  const left = page
    .getByRole("banner")
    .locator('[data-part="left"] > [data-widget]')
  await expect
    .poll(() =>
      left.evaluateAll((all) =>
        all.map((one) => one.getAttribute("data-widget"))
      )
    )
    .toEqual(["workspaces.list", "window.flow"])
  await expect(
    sidebarOf(page).getByRole("button", { name: /^Flow: / })
  ).toHaveCount(0)

  // Its menu names the three, in the prototype's words for Free and in
  // ADR 0102's for the row and solo, and in the row offers Arrange by
  // Project (ADR 0102, decision 9); a pick draws its icon and writes the
  // file, and Esc closes the menu.
  const arrange = page.getByRole("menuitem", { name: "Arrange by Project" })
  await flow.click()
  await expect(page.getByRole("menuitemradio")).toHaveText([
    /^Free\s*Windows stay where you put them/,
    /^Row\s*Each Project on its own workspace/,
    /^Solo\s*What has the focus, the whole screen wide/,
  ])
  await expect(arrange).toBeVisible()
  await page.keyboard.press("Escape")
  await pickFlow(page, "Solo")
  await expect.poll(written).toBe("solo")

  // Alt+Shift+M goes from solo to the row, and back.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flow).toHaveAccessibleName("Flow: Row")
  await expect.poll(written).toBe("row")
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flow).toHaveAccessibleName("Flow: Solo")
  await expect.poll(written).toBe("solo")

  // From free, it goes to solo; free's menu offers no Arrange.
  await pickFlow(page, "Free")
  await expect.poll(written).toBe("free")
  await flow.click()
  await expect(page.getByRole("menuitemradio")).toHaveCount(3)
  await expect(arrange).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flow).toHaveAccessibleName("Flow: Solo")
  await expect.poll(written).toBe("solo")
})

test("in the row and solo the Flow menu's Arrange by Project takes each Pane to its Project's workspace (ADR 0102, decision 9)", async () => {
  window = await startWindow({ files: FREE })
  const { page } = window
  await firstThread(page)
  const workspaces = page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("button", { name: /^Workspace \d/ })
  const arrange = page.getByRole("menuitem", { name: "Arrange by Project" })
  // Free put Work's New Thread on a workspace of no Project, and the row
  // leaves it there.
  await expect(workspaces).toHaveText(["1"])
  await pickFlow(page, "Row")
  await expect(workspaces).toHaveText(["1"])

  // The menu's Arrange takes it to Work's workspace, the focus with it,
  // and the free one, emptied, goes.
  await flowOf(page).click()
  await arrange.click()
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
  await expect(workspaces).toHaveText(["W"])

  // Solo's menu offers it too.
  await pickFlow(page, "Solo")
  await flowOf(page).click()
  await expect(arrange).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(arrange).toHaveCount(0)
})

test("in free a new Thread opens on the workspace the Person is on; in solo, as in the row, on its Project's (ADR 0065, ADR 0079)", async () => {
  window = await startWindow()
  const { page } = window
  await agents(window, "hello a")
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  const current = numbers.locator("[aria-current]:not([inert])")
  const threads = page
    .locator(`${ON_SCREEN} [data-strip]`)
    .getByRole("textbox", { name: "Message to Fake AI" })
  await expect(current).toHaveText("W")

  // Free, picked in the menu: from an empty workspace, the new Thread
  // stays there.
  await pickFlow(page, "Free")
  await page.getByRole("button", { name: "New workspace" }).click()
  await expect(current).toHaveText("")
  await page.keyboard.press("Alt+Enter")
  await expect(current).toHaveText("2")
  await expect(threads).toHaveCount(1)

  // Solo places as the row does: from an empty workspace, the new Thread
  // goes to its Project's, beside its Agent.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")
  await page.getByRole("button", { name: "New workspace" }).click()
  await expect(current).toHaveText("")
  await page.keyboard.press("Alt+Enter")
  await expect(current).toHaveText("W")
  await expect(threads).toHaveCount(2)
})

test("in solo every Agent is the whole screen wide at once, and the Strip scrolls from one to the next (ADR 0079)", async () => {
  window = await startWindow({ look: HALVES })
  const { page } = window
  const [a, b, c] = await agents(window, "hello a", "hello b", "hello c")
  const shares = () => sharesOf(a, b, c)
  // In the row each Agent takes half the Strip; the last is in front.
  await expect.poll(shares).toEqual([50, 50, 50])
  await expect(c).toHaveAttribute("data-focused", "true")

  // Solo: every Agent fills the screen, not only the one in front.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(shares).toEqual([100, 100, 100])
  await expect(c).toBeInViewport({ ratio: 0.99 })

  // The focus past its Group's edge scrolls to the next Agent, already
  // as wide: nothing grows or shrinks.
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(b).toHaveAttribute("data-focused", "true")
  await expect(b).toBeInViewport({ ratio: 0.99 })
  expect(await shares()).toEqual([100, 100, 100])
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(a).toHaveAttribute("data-focused", "true")
  await expect(a).toBeInViewport({ ratio: 0.99 })
  expect(await shares()).toEqual([100, 100, 100])

  // Alt+M shows the row for a while, the focus where it was, and again
  // goes back to solo; agents.toml keeps solo.
  await page.keyboard.press("Alt+KeyM")
  await expect.poll(shares).toEqual([50, 50, 50])
  await expect(a).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+KeyM")
  await expect.poll(shares).toEqual([100, 100, 100])

  // Back to the row, the room comes back.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(shares).toEqual([50, 50, 50])
})

test("in solo the focus past a Group's edge shows the next Group whole, from its first column, and Alt+R leaves an Agent alone the screen wide as it is (ADR 0102, decision 8)", async () => {
  window = await startWindow({ look: HALVES })
  const { page } = window
  const [a, b] = await agents(window, "hello a", "hello b")
  // A terminal opened at b joins its Group, right of it; a new Agent comes
  // last, a Group of its own.
  const screen = await openTerminal(page)
  const terminal = page.locator("section[data-tile]").filter({ has: screen })
  const c = await startAgent(window, "hello c")
  const groupOf = (tile: Locator) =>
    tile.evaluate(
      (element) => element.closest<HTMLElement>("[data-column]")!.dataset.group
    )
  expect(await groupOf(terminal)).toBe(await groupOf(b))
  expect(await groupOf(c)).not.toBe(await groupOf(b))
  const shown = () =>
    Promise.all([a, b, terminal, c].map((one) => shownOf(page, one)))

  // Solo: the Agent in front fills the screen.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(c).toHaveAttribute("data-focused", "true")
  await expect.poll(shown).toEqual([0, 0, 0, 100])

  // Past its edge, into the last column of b's Group: that Group shows
  // whole, from b, and nothing of the Agents beside it.
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(terminal).toHaveAttribute("data-focused", "true")
  await expect.poll(shown).toEqual([0, 100, 100, 0])
  await expect.poll(() => fromLeft(page, b)).toBeLessThan(3)
  // Inside the Group, nothing moves.
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(b).toHaveAttribute("data-focused", "true")
  expect(await shown()).toEqual([0, 100, 100, 0])
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(a).toHaveAttribute("data-focused", "true")
  await expect.poll(shown).toEqual([100, 0, 0, 0])
  // From the left, into its first column, the Group shows whole too.
  await page.keyboard.press("Alt+ArrowRight")
  await expect(b).toHaveAttribute("data-focused", "true")
  await expect.poll(shown).toEqual([0, 100, 100, 0])
  await page.keyboard.press("Alt+ArrowRight")
  await page.keyboard.press("Alt+ArrowRight")
  await expect(c).toHaveAttribute("data-focused", "true")
  await expect.poll(shown).toEqual([0, 0, 0, 100])

  // Alt+R on the Agent that fills the screen alone shows nothing, and
  // does nothing: back in the row it is as wide as it was.
  await page.keyboard.press("Alt+KeyR")
  await page.keyboard.press("Alt+KeyR")
  expect(await sharesOf(c)).toEqual([100])
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(() => sharesOf(a, c)).toEqual([50, 50])
})

test("ten Agents of a Project work side by side on its workspace, and a pick brings one to the Strip's left, filled in solo (ADR 0065, ADR 0079)", async () => {
  window = await startWindow({ look: HALVES })
  const { page } = window
  const names = "one two three four five six seven eight nine ten"
    .split(" ")
    .map((n) => `wait ${n}`)
  const threads = await agents(window, ...names)
  const [one, , , , five, six, , , , ten] = threads

  // One workspace holds them all, the Project's, in the order they
  // started, each a Group of its own; all ten at work at once.
  const numbers = page.getByRole("navigation", { name: "Workspaces" })
  const workspaces = numbers.getByRole("button", { name: /^Workspace \d/ })
  await expect(workspaces).toHaveText(["W"])
  const ids = await Promise.all(threads.map((t) => t.getAttribute("data-tile")))
  expect(await layoutOf(page)).toEqual(ids.map((id) => [id]))
  const plates = page.locator(`${ON_SCREEN} [data-group-plate]`)
  const groups = await plates.evaluateAll((all) =>
    all.map((plate) => plate.getAttribute("data-group-plate"))
  )
  expect(new Set(groups).size).toBe(10)
  const sidebar = sidebarOf(page)
  const rows = sidebar.locator("[data-row]")
  // Nothing waits for the Person: the Working shelf shows the first six,
  // and "+ 4 more" the rest (ADR 0098, decision 3).
  await expect(sidebar.getByText("Nothing waits for you")).toBeVisible()
  await expect(rows).toHaveCount(6)
  await sidebar.getByRole("option", { name: "+ 4 more" }).click()
  await expect(rows).toHaveCount(10)
  await expect(rows.getByRole("img", { name: "Working" })).toHaveCount(10)
  // Each Group's plate takes its Agent's state: at work, all ten.
  await expect
    .poll(() =>
      plates.evaluateAll((all) =>
        all.map((plate) => plate.getAttribute("data-state"))
      )
    )
    .toEqual(Array(10).fill("working"))

  // The last is in front; the first is far out of view, and a pick in the
  // sidebar list brings it to the Strip's left. The others keep their
  // order.
  await expect(ten).toHaveAttribute("data-focused", "true")
  await expect(one).not.toBeInViewport()
  const row = (name: string) =>
    sidebar.getByRole("option", { name: new RegExp(name) })
  await row("wait one").click()
  await expect(one).toHaveAttribute("data-focused", "true")
  await expect.poll(() => fromLeft(page, one)).toBeLessThan(3)
  await row("wait five").click()
  await expect(five).toHaveAttribute("data-focused", "true")
  await expect.poll(() => fromLeft(page, five)).toBeLessThan(3)
  expect(await layoutOf(page)).toEqual(ids.map((id) => [id]))

  // In solo every Agent is the screen wide; the focus and a pick scroll
  // to one.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(() => sharesOf(five, six)).toEqual([100, 100])
  await page.keyboard.press("Alt+ArrowRight")
  await expect(six).toHaveAttribute("data-focused", "true")
  await expect(six).toBeInViewport({ ratio: 0.99 })
  await row("wait one").click()
  await expect(one).toHaveAttribute("data-focused", "true")
  await expect.poll(() => sharesOf(one, six)).toEqual([100, 100])
  await expect(one).toBeInViewport({ ratio: 0.99 })
})

test("with the Sidebar hidden, Alt+U goes down what calls in the sidebar list's order, the count beside the logo says whose turn it is and who works, and the small inbox lists the calls in that order (ADR 0079, ADR 0087, ADR 0098 decision 22)", async () => {
  window = await startWindow()
  const { page } = window
  const [a, b, c] = await agents(
    window,
    "wait a",
    "wait b",
    "wait c",
    "hello d"
  )
  const bar = page.getByRole("banner")
  const count = bar.locator("[data-inbox-count]")
  const logo = bar.getByRole("button", { name: /^Banda(:|$)/ })
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebarOf(page)).toBeHidden()
  // Nothing calls, so no count shows; the logo says who works.
  await expect(logo).toHaveAccessibleName("Banda: 3 at work")
  await expect(count).toHaveCount(0)

  // They finish one after another.
  finish(window, "wait a")
  await expect(count).toHaveAccessibleName("Inbox: 1 your turn, 2 at work")
  await expect(count).toHaveText("1·2")
  finish(window, "wait b")
  await expect(count).toHaveAccessibleName("Inbox: 2 your turn, 1 at work")
  finish(window, "wait c")
  await expect(count).toHaveAccessibleName("Inbox: 3 your turn")
  await expect(count).toHaveText("3")
  await expect(logo).toHaveAccessibleName("Banda: Done, 3 your turn")

  // The small inbox goes in the sidebar list's order, the one order of
  // what calls (ADR 0087, decision 8): Your turn oldest first, so no one
  // waits forever (ADR 0098, decision 3).
  await count.click()
  const inbox = page.getByRole("dialog", { name: "Inbox" })
  await expect(inbox.getByRole("option")).toHaveText([
    /wait a/,
    /wait b/,
    /wait c/,
  ])
  await page.keyboard.press("Escape")
  await expect(inbox).toBeHidden()

  // Alt+U takes the next below, as the sidebar list orders them though it
  // is hidden: down the small inbox's list.
  await page.keyboard.press("Alt+KeyU")
  await expect(a).toHaveAttribute("data-focused", "true")
  await expect(count).toHaveAccessibleName("Inbox: 2 your turn")
  await page.keyboard.press("Alt+KeyU")
  await expect(b).toHaveAttribute("data-focused", "true")
  await expect(count).toHaveAccessibleName("Inbox: 1 your turn")

  // A card of the small inbox goes there too, by Enter.
  await count.click()
  await expect(inbox.getByRole("listbox")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(c).toHaveAttribute("data-focused", "true")
  await expect(inbox).toBeHidden()
  await expect(count).toHaveCount(0)
  await expect(logo).toHaveAccessibleName("Banda")
})

test("Alt+Z puts the Thread in front off until the time typed, its Pane closes, Undo wakes it, and so do Wake on its shelf and on its picker (ADR 0074)", async () => {
  window = await startWindow()
  const { page } = window
  const [, b] = await agents(window, "hello a", "hello b")
  const sidebar = sidebarOf(page)
  const toasts = toastsOf(page)
  const picker = pickerOf(page)
  const row = sidebar.getByRole("option", { name: /hello b/ })
  // Later is a tab of its own (ADR 0098, decision 2), the Inbox another.
  const tab = sidebar.getByRole("tab", { name: /^Later/ })
  const inbox = sidebar.getByRole("tab", { name: /^Inbox/ })
  await expect(tab).toHaveAccessibleName("Later")

  // The Pane menu's Later… opens the same picker, for its Pane's Thread
  // (ADR 0087, decision 12); Esc leaves it awake.
  await b.getByRole("button", { name: "Pane menu" }).click()
  await page.getByRole("menuitem", { name: /^Later…/ }).click()
  await expect(picker).toContainText("hello b")
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()
  await expect(b).toBeVisible()

  // The picker names the Thread, and reads what is typed as a time.
  await page.keyboard.press("Alt+KeyZ")
  await expect(picker).toContainText("hello b")
  const field = picker.getByRole("textbox", { name: "When it comes back" })
  await expect(field).toBeFocused()
  // A Thread done is not at work: it waits for no turn's end.
  await expect(picker).not.toContainText("When it's done")
  await field.fill("2h")
  await expect(picker).toContainText("in 2h")
  await field.press("Enter")

  // Its Pane closes, a toast says until when, and its row goes to Later,
  // whose tab counts it. A time past midnight reads with its weekday
  // (`clock`).
  await expect(picker).toBeHidden()
  await expect(b).toBeHidden()
  const later = toasts.getByText(/^Later, until (\S+ )?\d/)
  await expect(later).toBeVisible()
  // A toast goes after a few seconds, but not under the pointer: Undo
  // stays there to click.
  await later.hover()
  await expect(tab).toHaveAccessibleName("Later, 1")
  await expect(row).toBeHidden()

  // Undo wakes it: back in the list.
  await toasts.getByRole("button", { name: "Undo" }).click()
  await expect(row).toBeVisible()
  await expect(tab).toHaveAccessibleName("Later")

  // The clock on its row puts it off too: it shows under the pointer.
  const actions = sidebar.locator("[data-row]").filter({ hasText: "hello b" })
  await row.hover()
  await actions.locator('[data-act="later"]').click()
  await expect(field).toBeFocused()
  // Woken by Undo, its Pane stayed closed.
  await expect(b).toBeHidden()
  await field.fill("45m")
  await field.press("Enter")
  await expect(tab).toHaveAccessibleName("Later, 1")
  await expect(row).toBeHidden()

  // The Later tab lists it with when it wakes, by the clock; Wake brings
  // it back to the Inbox, where its time is how long ago it changed.
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(row).toContainText(/\d:\d\d/)
  await row.hover()
  await actions.locator('[data-act="wake"]').click()
  await leaveSidebar(page)
  await expect(tab).toHaveAccessibleName("Later")
  await expect(row).toBeHidden()
  await inbox.click()
  await expect(row).toBeVisible()
  await expect(row).not.toContainText(/\d:\d\d/)

  // Its row's Thread menu puts it off too, and in Later, wakes it.
  const menu = page.getByRole("menu", { name: "Thread menu" })
  await row.click({ button: "right" })
  await menu.getByRole("menuitem", { name: /^Later…/ }).click()
  await expect(field).toBeFocused()
  await field.fill("45m")
  await field.press("Enter")
  await expect(row).toBeHidden()
  await tab.click()
  await expect(row).toContainText(/\d:\d\d/)
  await row.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Wake now" }).click()
  await leaveSidebar(page)
  await expect(tab).toHaveAccessibleName("Later")
  await inbox.click()
  await expect(row).toBeVisible()
  await expect(row).not.toContainText(/\d:\d\d/)

  // Opened while it sleeps, its picker wakes it too: its first line is
  // Wake now, so Z then Enter does it.
  await row.click()
  await page.keyboard.press("Alt+KeyZ")
  await field.fill("45m")
  await field.press("Enter")
  await tab.click()
  await expect(row).toContainText(/\d:\d\d/)
  await row.click()
  await page.keyboard.press("Alt+KeyZ")
  await expect(picker.getByRole("option").first()).toContainText("Wake now")
  await field.press("Enter")
  await expect(picker).toBeHidden()
  await leaveSidebar(page)
  await expect(tab).toHaveAccessibleName("Later")
  await inbox.click()
  await expect(row).not.toContainText(/\d:\d\d/)
})

test("a Thread at work put off until it's done comes back as its turn ends, with a toast that opens it (ADR 0074)", async () => {
  window = await startWindow()
  const { page } = window
  const [a] = await agents(window, "wait a")
  const sidebar = sidebarOf(page)
  const toasts = toastsOf(page)
  const row = sidebar.getByRole("option", { name: /wait a/ })
  const tab = sidebar.getByRole("tab", { name: /^Later/ })

  // At work, it may sleep until its turn ends.
  await page.keyboard.press("Alt+KeyZ")
  await pickerOf(page).getByText("When it's done").click()
  await expect(a).toBeHidden()
  await expect(toasts.getByText("Later, until it's done")).toBeVisible()
  await tab.click()
  await expect(row).toContainText("when done")
  await sidebar.getByRole("tab", { name: /^Inbox/ }).click()
  await leaveSidebar(page)

  // Its turn ends. A word from its Person would wake it by itself (ADR
  // 0074, decision 3), so the turn is stopped from outside: any end of it
  // wakes it.
  const { turn } = threadNamed(window, "wait a")!.latest!
  call(window, "agents.stop", { turn })
  // It woke by itself, calling for nothing: a toast says so, and its row
  // is back in the list with a clock.
  const woke = toasts
    .getByRole("listitem")
    .filter({ hasText: "Woke from Later" })
  await expect(woke).toContainText("wait a")
  await expect(tab).toHaveAccessibleName("Later")
  await expect(row.getByRole("img", { name: "Woke" })).toBeVisible()

  // Open goes there, and the clock goes once its Person looks: its host
  // keeps that they saw it, for every window and machine (ADR 0096).
  await woke.getByRole("button", { name: "Open" }).click()
  await expect(a).toHaveAttribute("data-focused", "true")
  await expect(row.getByRole("img", { name: "Woke" })).toBeHidden()
  await expect
    .poll(() => threadNamed(window, "wait a")!.later?.woke_seen)
    .toBe("seen")
})

test("ten tiling keys pressed faster than the Window draws land in order, each on what the one before did", async () => {
  window = await startWindow({ files: FREE })
  const { page } = window
  // The keys go to the Window once the New Thread has the focus.
  const { composer: box } = await firstThread(page)
  await expect(box).toBeFocused()
  const launchers = page.getByRole("region", { name: "New Pane" })
  for (let n = 1; n <= 3; n++) {
    await page.keyboard.press("Alt+KeyN")
    await expect(launchers).toHaveCount(n)
    await expect(launchers.nth(n - 1)).toHaveAttribute("data-focused", "true")
  }
  // The New Thread, a Group of its own, then three launchers.
  const [[thread], [one], [two], [three]] = await layoutOf(page)

  // A Pane opened, moved first, the focus beside it, the Group moved
  // last, the first Pane closed, another moved twice, the focus left,
  // that one moved first. The ten go in at once, in one task of the
  // page, as the Window's keys hear them: each lands before the one
  // before is drawn, however fast the machine.
  await pressAtOnce(page, TEN_KEYS)

  await expect
    .poll(() => layoutOf(page))
    .toEqual([[three], [two], [one], [thread]])
  await expect(page.locator(`[data-tile="${three}"]`)).toHaveAttribute(
    "data-focused",
    "true"
  )
})

test("an Agent that finishes scrolled out of view on its workspace gets its toast (ADR 0087, decision 9)", async () => {
  window = await startWindow({ look: HALVES })
  const [a] = await agents(window, "wait a", "hello b", "hello c", "hello d")
  // In the row the Strip follows the last Agent: the first is out of view,
  // on the workspace on screen.
  await expect(a).not.toBeInViewport()
  await toastedOutOfView(window, "wait a", ["hello b", "hello c", "hello d"])
})

test("an Agent that finishes behind the Group that fills the screen in solo gets its toast (ADR 0087, decision 9)", async () => {
  window = await startWindow({ look: HALVES })
  const { page } = window
  const [a, b] = await agents(window, "wait a", "hello b")
  // In the row both show. In solo each Agent fills the Strip: the one in
  // front from its left edge, and the other past that edge, on the
  // workspace on screen.
  await expect(a).toBeInViewport({ ratio: 0.99 })
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(() => sharesOf(a, b)).toEqual([100, 100])
  await expect.poll(() => fromLeft(page, b)).toBeLessThan(3)
  await toastedOutOfView(window, "wait a", ["hello b"])
})
