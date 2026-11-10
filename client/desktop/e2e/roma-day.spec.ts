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
  FREE,
  countNotes,
  firstThread,
  fromLeft,
  layoutOf,
  ON_SCREEN,
  pressAtOnce,
  projectId,
  sharesOf,
  startWindow,
  TEN_KEYS,
  textOf,
  type Window,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** Columns half the Strip wide, whatever Banda's default. */
const HALVES = '[columns]\ndefault = "1/2"\n'

const sidebarOf = (page: Page) =>
  page.getByRole("complementary", { name: "Sidebar" })
/** The Flow's button, in the Sidebar's header. */
const flowOf = (page: Page) =>
  sidebarOf(page).getByRole("button", { name: /^Flow: / })
/** The Later picker, Alt+Z's. */
const pickerOf = (page: Page) =>
  page.getByRole("dialog").filter({ hasText: "Later ·" })
const toastsOf = (page: Page) =>
  page.getByRole("region", { name: "Notifications" })

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
  // Its turn is over in the engine, and the Window took it in, seen.
  await expect.poll(() => threadNamed(window, text)?.latest.state).toBe("done")
  const row = sidebarOf(page).getByRole("button", { name: new RegExp(text) })
  await expect(row.getByRole("img", { name: "Nothing runs" })).toBeVisible()
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

/** The Bar's map of the workspace on screen: each column's share of the
 * screen, in hundredths, as `Map.tsx` draws it, the whole screen 2.5rem
 * wide. */
const mapOf = (page: Page) =>
  page
    .locator("[data-map]")
    .evaluateAll((bars) =>
      bars.map((bar) =>
        Math.round((parseFloat((bar as HTMLElement).style.width) / 2.5) * 100)
      )
    )

/** Work's id in each window, looked up once. */
const works = new WeakMap<Window, string>()

/** What the engine's `method` answers in the Project "Work", run as the
 * Person's `banda call`, from outside the Window. */
function call(window: Window, method: string, params?: object) {
  if (!works.has(window)) works.set(window, projectId(window, "Work"))
  const work = works.get(window)!
  const args = params ? ["--params", JSON.stringify(params)] : []
  return JSON.parse(window.banda("call", method, "--project", work, ...args)).ok
}

/** Work's Thread named `title`, as the engine lists it; none until it is
 * listed. */
function threadNamed(window: Window, title: string) {
  const { threads } = call(window, "agents.threads") as {
    threads: {
      id: string
      title: string
      latest: { turn: string; state: string }
      later?: { woke_seen?: string }
    }[]
  }
  return threads.find((thread) => thread.title === title)
}

/** The Agent at work in the Thread named `title` ends its turn, done: its
 * Person's word goes into the turn from outside the Window. */
function finish(window: Window, title: string) {
  const thread = threadNamed(window, title)!.id
  call(window, "agents.send", { thread, text: "go", steer: true })
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

/** The pointer leaves the Sidebar for the Strip: its list holds still
 * under the pointer, and moves once it leaves. */
async function leaveSidebar(page: Page) {
  const box = (await sidebarOf(page).boundingBox())!
  await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2)
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
      .getByRole("button", { name: new RegExp(one) })
      .getByRole("img", { name: "Done" })
  // The other Agents chimed as their turns ended, and a chime within
  // 1.5 s of the one before plays not at all (QUIET_FOR in
  // platform/notifications/pane/src/sound.ts): once their turns are done,
  // that much time goes by before this one ends.
  for (const other of others)
    await expect
      .poll(() => threadNamed(window, other)?.latest.state)
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

test("the Flow is picked in the Sidebar's header and kept in agents.toml, and Alt+Shift+M goes between the row and solo (ADR 0079)", async () => {
  window = await startWindow()
  const { page, dir } = window
  await firstThread(page)
  const flow = flowOf(page)
  const file = join(dir, "config/agents.toml")
  const written = () => textOf(file).match(/^flow = "(\w+)"$/m)?.[1]
  // The row is the default, and nothing is written for it.
  await expect(flow).toHaveAccessibleName("Flow: Row")
  expect(written()).toBeUndefined()

  // Its menu names the three; a pick draws its icon and writes the file,
  // and Esc closes the menu.
  await flow.click()
  await expect(page.getByRole("menuitemradio")).toHaveText([
    /^Free/,
    /^Row/,
    /^Solo/,
  ])
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

  // From free, it goes to solo.
  await pickFlow(page, "Free")
  await expect.poll(written).toBe("free")
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flow).toHaveAccessibleName("Flow: Solo")
  await expect.poll(written).toBe("solo")
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
  // The Bar's map draws them as the Strip does.
  await expect.poll(shares).toEqual([50, 50, 50])
  await expect.poll(() => mapOf(page)).toEqual([50, 50, 50])
  await expect(c).toHaveAttribute("data-focused", "true")

  // Solo: every Agent fills the screen, not only the one in front.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(shares).toEqual([100, 100, 100])
  await expect.poll(() => mapOf(page)).toEqual([100, 100, 100])
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
  expect(await mapOf(page)).toEqual([100, 100, 100])

  // Alt+M shows the row for a while, the focus where it was, and again
  // goes back to solo; agents.toml keeps solo.
  await page.keyboard.press("Alt+KeyM")
  await expect.poll(shares).toEqual([50, 50, 50])
  await expect.poll(() => mapOf(page)).toEqual([50, 50, 50])
  await expect(a).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+KeyM")
  await expect.poll(shares).toEqual([100, 100, 100])
  await expect.poll(() => mapOf(page)).toEqual([100, 100, 100])

  // Back to the row, the room comes back.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(shares).toEqual([50, 50, 50])
  await expect.poll(() => mapOf(page)).toEqual([50, 50, 50])
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
    sidebar.getByRole("button", { name: new RegExp(name) })
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

test("with the Sidebar hidden, Alt+U goes down what calls in the sidebar list's order, the bar's counts list it in that order, and they are the switcher (ADR 0065, ADR 0079, ADR 0087)", async () => {
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
  const counts = bar.getByRole("button", { name: /working|done/ })
  await page.keyboard.press("Alt+KeyA")
  await expect(sidebarOf(page)).toBeHidden()
  // The bar names the Agent in front, and counts the ones at work.
  await expect(counts).toHaveAccessibleName("3 working")
  await expect(counts).toContainText("hello d")

  // They finish one after another.
  finish(window, "wait a")
  await expect(counts).toHaveAccessibleName("1 done · 2 working")
  finish(window, "wait b")
  await expect(counts).toHaveAccessibleName("2 done · 1 working")
  finish(window, "wait c")
  await expect(counts).toHaveAccessibleName("3 done")

  // The counts' list goes in the sidebar list's order, the one order of
  // what calls (ADR 0087, decision 8): the `inbox` preset puts the last
  // done first.
  await counts.click()
  const waiting = page.getByRole("group", { name: "Wait for you" })
  await expect(waiting.getByRole("menuitem")).toHaveText([
    /wait c/,
    /wait b/,
    /wait a/,
  ])
  await page.keyboard.press("Escape")
  await expect(waiting).toBeHidden()

  // Alt+U takes the next below, as the sidebar list orders them though it
  // is hidden: down the counts' list. The bar names each as it comes.
  await page.keyboard.press("Alt+KeyU")
  await expect(c).toHaveAttribute("data-focused", "true")
  await expect(counts).toHaveAccessibleName("2 done")
  await expect(counts).toContainText("wait c")
  await page.keyboard.press("Alt+KeyU")
  await expect(b).toHaveAttribute("data-focused", "true")
  await expect(counts).toHaveAccessibleName("1 done")
  await expect(counts).toContainText("wait b")

  // A row of the counts' list goes there too.
  await counts.click()
  await page.getByRole("menuitem", { name: /wait a/ }).click()
  await expect(a).toHaveAttribute("data-focused", "true")
  await expect(counts).toBeHidden()
  await expect(
    bar.getByRole("img", { name: "Nothing waits for you, nothing works" })
  ).toBeVisible()
})

test("Alt+Z puts the Thread in front off until the time typed, its Pane closes, Undo wakes it, and so do Wake on its shelf and on its picker (ADR 0074)", async () => {
  window = await startWindow()
  const { page } = window
  const [, b] = await agents(window, "hello a", "hello b")
  const sidebar = sidebarOf(page)
  const toasts = toastsOf(page)
  const picker = pickerOf(page)
  const row = sidebar.getByRole("button", { name: /hello b/ })
  const shelf = sidebar.getByRole("button", { name: /^Later/ })
  await expect(shelf).toBeHidden()

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

  // Its Pane closes, a toast says until when, and its row goes to the
  // folded shelf, which says when the next one wakes. A time past
  // midnight reads with its weekday (`clock`).
  await expect(picker).toBeHidden()
  await expect(b).toBeHidden()
  const later = toasts.getByText(/^Later, until (\S+ )?\d/)
  await expect(later).toBeVisible()
  // A toast goes after a few seconds, but not under the pointer: Undo
  // stays there to click.
  await later.hover()
  await expect(shelf).toHaveAttribute("aria-expanded", "false")
  await expect(shelf).toContainText(/next (\S+ )?\d/)
  await expect(shelf).toContainText(/1$/)
  await expect(row).toBeHidden()

  // Undo wakes it: back in the list.
  await toasts.getByRole("button", { name: "Undo" }).click()
  await expect(row).toBeVisible()
  await expect(shelf).toBeHidden()

  // The clock on its row puts it off too. A row shows its clock under the
  // pointer, or with the focus in it: headless, nothing hovers.
  const actions = sidebar.locator("[data-row]").filter({ hasText: "hello b" })
  await row.focus()
  await actions.getByRole("button", { name: "Later" }).click()
  await expect(field).toBeFocused()
  // Woken by Undo, its Pane stayed closed.
  await expect(b).toBeHidden()
  await field.fill("45m")
  await field.press("Enter")
  await expect(shelf).toBeVisible()
  await expect(row).toBeHidden()

  // Open, the shelf lists it with when it wakes; Wake brings it back.
  await shelf.click()
  await expect(shelf).toHaveAttribute("aria-expanded", "true")
  await expect(row).toContainText(/ · 4\dm/)
  await row.focus()
  await actions.getByRole("button", { name: "Wake" }).click()
  await leaveSidebar(page)
  await expect(shelf).toBeHidden()
  await expect(row).toBeVisible()
  await expect(row).not.toContainText("·")

  // Its row's Thread menu puts it off too, and on the shelf, wakes it.
  const menu = page.getByRole("menu", { name: "Thread menu" })
  await row.click({ button: "right" })
  await menu.getByRole("menuitem", { name: /^Later…/ }).click()
  await expect(field).toBeFocused()
  await field.fill("45m")
  await field.press("Enter")
  // The shelf stays open, as the Person left it.
  await expect(shelf).toHaveAttribute("aria-expanded", "true")
  await expect(row).toContainText(/ · 4\dm/)
  await row.click({ button: "right" })
  await menu.getByRole("menuitem", { name: "Wake now" }).click()
  await leaveSidebar(page)
  await expect(shelf).toBeHidden()
  await expect(row).toBeVisible()
  await expect(row).not.toContainText("·")

  // Opened while it sleeps, its picker wakes it too.
  await row.click()
  await page.keyboard.press("Alt+KeyZ")
  await field.fill("45m")
  await field.press("Enter")
  await expect(row).toContainText(/ · 4\dm/)
  await row.click()
  await page.keyboard.press("Alt+KeyZ")
  await picker.getByText("Wake now").click()
  await expect(picker).toBeHidden()
  await leaveSidebar(page)
  await expect(shelf).toBeHidden()
  await expect(row).not.toContainText("·")
})

test("a Thread at work put off until it's done comes back as its turn ends, with a toast that opens it (ADR 0074)", async () => {
  window = await startWindow()
  const { page } = window
  const [a] = await agents(window, "wait a")
  const sidebar = sidebarOf(page)
  const toasts = toastsOf(page)
  const row = sidebar.getByRole("button", { name: /wait a/ })
  const shelf = sidebar.getByRole("button", { name: /^Later/ })

  // At work, it may sleep until its turn ends.
  await page.keyboard.press("Alt+KeyZ")
  await pickerOf(page).getByText("When it's done").click()
  await expect(a).toBeHidden()
  await expect(toasts.getByText("Later, until it's done")).toBeVisible()
  await shelf.click()
  await expect(row).toContainText("when done")
  await leaveSidebar(page)

  // Its turn ends. A word from its Person would wake it by itself (ADR
  // 0074, decision 3), so the turn is stopped from outside: any end of it
  // wakes it.
  const { turn } = threadNamed(window, "wait a")!.latest
  call(window, "agents.stop", { turn })
  // It woke by itself, calling for nothing: a toast says so, and its row
  // is back in the list with a clock.
  const woke = toasts
    .getByRole("listitem")
    .filter({ hasText: "Woke from Later" })
  await expect(woke).toContainText("wait a")
  await expect(shelf).toBeHidden()
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
