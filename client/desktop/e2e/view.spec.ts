/**
 * The view is the device's (ADR 0127, decision 3; WS5): two windows on one
 * engine share the work and the arrangement, and nothing of what each one
 * shows. Solo is turned on and off in the window it is done in and writes
 * no file and no arrangement, and only the window in front tidies.
 *
 * A browser tab does not come in at the door yet (it pairs with SE5), so
 * the second client here is a second window of the same app: the same
 * page on the same engine, with a controller and a view of its own. It
 * shares the first one's storage, as two windows of one device do.
 */
import { join } from "node:path"
import {
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test"
import {
  firstThread,
  FREE,
  openTerminal,
  sharesOf,
  startAgent,
  startWindow,
  textOf,
  type Window,
  workspaceNames,
  widths,
} from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** The look whose new column takes half the screen, so the row and Solo
 * draw two Threads apart. */
const HALVES = widths('default = "1/2"')

/** The Flow's button on the bar. */
const flowOf = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Flow: / })

/** A second window on the same engine: the same page, opened as the first
 * was, once it drew its bar. */
async function another(app: ElectronApplication): Promise<Page> {
  const opened = app.waitForEvent("window")
  await app.evaluate(({ app, BrowserWindow }) => {
    const first = BrowserWindow.getAllWindows()[0]!.webContents
    const second = new BrowserWindow({
      // Shown, as main's own: a window never shown draws no frame, and
      // takes what the engine says only as something else draws it.
      width: 1280,
      height: 800,
      // As main opens a window that shows the page (`pageWindow`).
      webPreferences: {
        preload: `${app.getAppPath()}/out/preload.cjs`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    void second.loadURL(first.getURL())
  })
  const page = await opened
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(flowOf(page)).toBeVisible()
  return page
}

/** The Person is in front of `page`'s window, or not: a headless window
 * says it has the desktop's focus whatever the others do, so the test
 * says which one has. */
async function setFront(page: Page, front: boolean) {
  await page.evaluate((front) => {
    Document.prototype.hasFocus = () => front
    globalThis.dispatchEvent(new Event(front ? "focus" : "blur"))
  }, front)
}

type Kept = { id: string; columns: { panes: { kind: string }[] }[] }

/** The workspaces as the engine keeps them, with all it says of them. */
function arrangement(window: Window): string {
  return window.banda("call", "workspaces.list")
}

/** Each workspace's kinds of Pane, from the top, as the engine keeps
 * them. */
function kept(window: Window): string[][] {
  const { ok } = JSON.parse(arrangement(window)) as {
    ok: { workspaces: Kept[] }
  }
  return ok.workspaces.map((workspace) =>
    workspace.columns.flatMap((column) => column.panes.map((one) => one.kind))
  )
}

test("Solo turned on in one window leaves a second window on the same engine as it was, writes no file and no arrangement, and is there after a restart (ADR 0127, decision 3)", async () => {
  window = await startWindow({ files: HALVES })
  const { app, page, dir } = window
  const { composer } = await firstThread(page)
  await composer.fill("hello a")
  await composer.press("Enter")
  await expect(page.getByText("You said: hello a")).toBeVisible()
  await startAgent(page, "hello b")
  await expect(page.getByText("You said: hello b")).toBeVisible()
  /** The two Threads' shares of the screen, as `page` draws them. */
  const shares = (page: Page) =>
    sharesOf(
      page.getByRole("region", { name: "hello a", exact: true }),
      page.getByRole("region", { name: "hello b", exact: true })
    )
  const other = await another(app)
  await expect(other.getByText("You said: hello b")).toBeVisible()
  // The row in both: each Thread takes its half.
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Row")
  await expect(flowOf(other)).toHaveAccessibleName("Flow: Row")
  await expect.poll(() => shares(page)).toEqual([50, 50])
  await expect.poll(() => shares(other)).toEqual([50, 50])
  const file = join(dir, "config/tiling.toml")
  const before = arrangement(window)

  // Solo by its key in the first: each Thread fills its screen, and the
  // second is as it was.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")
  await expect.poll(() => shares(page)).toEqual([100, 100])
  await expect(flowOf(other)).toHaveAccessibleName("Flow: Row")
  expect(await shares(other)).toEqual([50, 50])

  // Solo by the bar's menu in the second, and the row again in the
  // first: each window its own, both ways.
  await flowOf(other).click()
  await other.getByRole("menuitemradio", { name: /^Solo/ }).click()
  await expect(flowOf(other)).toHaveAccessibleName("Flow: Solo")
  await expect.poll(() => shares(other)).toEqual([100, 100])
  await other.keyboard.press("Escape")
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Row")
  await expect.poll(() => shares(page)).toEqual([50, 50])
  await expect(flowOf(other)).toHaveAccessibleName("Flow: Solo")
  expect(await shares(other)).toEqual([100, 100])

  // Nothing of it was written: the file says no Flow, and the engine's
  // arrangement is as it was, to the letter.
  expect(textOf(file)).not.toMatch(/^flow\s*=/m)
  expect(arrangement(window)).toBe(before)

  // Solo once more, and Banda started again: this device has the Solo it
  // had, with the file still saying none.
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")
  // Both windows' starts went well, as the test says: it is over before
  // Banda does (ADR 0039).
  await page.evaluate(() => localStorage.removeItem("banda.starts"))
  await app.close()
  window = await startWindow({ files: HALVES, dir })
  await expect(flowOf(window.page)).toHaveAccessibleName("Flow: Solo")
  await expect.poll(() => shares(window.page)).toEqual([100, 100])
  expect(textOf(file)).not.toMatch(/^flow\s*=/m)
})

test('`flow = "solo"` in tiling.toml is the Person\'s default: a window that has not chosen starts in Solo, the row chosen in one leaves the other in Solo, and a window back at the default follows the file again (ADR 0127, decision 3)', async () => {
  window = await startWindow({
    files: { "config/tiling.toml": 'flow = "solo"\n' },
  })
  const { app, page, dir } = window
  await firstThread(page)
  const other = await another(app)
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")
  await expect(flowOf(other)).toHaveAccessibleName("Flow: Solo")

  // The row here, by the key: the file keeps the Person's default, and
  // the other window is in Solo still.
  const file = join(dir, "config/tiling.toml")
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Row")
  await expect(flowOf(other)).toHaveAccessibleName("Flow: Solo")
  expect(textOf(file)).toMatch(/^flow = "solo"$/m)
  // Its own choice holds over the default written again.
  window.banda("settings", "set", "tiling.toml", "flow", "solo")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Row")

  // Back in Solo, the window is at the default and follows it again: the
  // row written as Settings' row and `banda settings set` write it is
  // its row, and Solo its Solo. (Main tells a change of a settings file
  // to its own window, so only the first is read here.)
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")
  expect(textOf(file)).toMatch(/^flow = "solo"$/m)
  window.banda("settings", "set", "tiling.toml", "flow", "row")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Row")
  window.banda("settings", "set", "tiling.toml", "flow", "solo")
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")

  // Free is how the engine places, the Person's: picked on the bar, it
  // is written, and from free Solo's key takes the row with it.
  await flowOf(page).click()
  await page.getByRole("menuitemradio", { name: /^Free/ }).click()
  await page.keyboard.press("Escape")
  await expect.poll(() => textOf(file)).toMatch(/^flow = "free"$/m)
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Free")
  await page.keyboard.press("Alt+Shift+KeyM")
  await expect.poll(() => textOf(file)).toMatch(/^flow = "row"$/m)
  await expect(flowOf(page)).toHaveAccessibleName("Flow: Solo")
})

test("only the window in front tidies: the empty workspace the Person looks at stays while a window behind shows another, and that window tidies once it comes to the front (ADR 0087, decision 10)", async () => {
  window = await startWindow({ files: FREE })
  const { app, page } = window
  const { composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(page.getByText("You said: hello")).toBeVisible()
  // A terminal on a workspace of its own, under the Thread's.
  const bar = (page: Page) =>
    page.getByRole("navigation", { name: "Workspaces" })
  await bar(page).getByRole("button", { name: "New workspace" }).click()
  await openTerminal(page)
  await expect
    .poll(() => kept(window))
    .toEqual([["agents.thread"], ["terminal.terminal"], []])

  // A second window shows the Thread's workspace, behind the first.
  const other = await another(app)
  await bar(other).getByRole("button", { name: "Workspace 1" }).click()
  await expect(other.getByText("You said: hello")).toBeInViewport()
  const below = other
    .getByRole("group", { name: "Workspace 2", includeHidden: true })
    .locator("[data-tile]")
  await expect(below).toHaveCount(1)
  await setFront(other, false)
  await setFront(page, true)

  // The Person closes the terminal: its workspace is empty, and they
  // look at it still. The window behind lets it be, though it shows
  // another: its tidy would keep its own and take this one away.
  await page.keyboard.press("Alt+KeyW")
  await expect.poll(() => kept(window)).toEqual([["agents.thread"], [], []])
  // It heard the terminal go, and has had the time to send its own.
  await expect(below).toHaveCount(0)
  await page.waitForTimeout(600)
  expect(kept(window)).toEqual([["agents.thread"], [], []])
  expect(await workspaceNames(page)).toEqual([
    "Workspace 1",
    "Workspace 2",
    "New workspace",
  ])

  // The Person goes to the second window: in front, it tidies then.
  await setFront(page, false)
  await setFront(other, true)
  await expect.poll(() => kept(window)).toEqual([["agents.thread"], []])
})
