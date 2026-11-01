import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import {
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

/** Serves `pages` on 127.0.0.1; returns its address. */
async function serve(pages: Record<string, string>): Promise<string> {
  site = createServer((request, response) => {
    const body = pages[request.url ?? "/"]
    response.writeHead(body === undefined ? 404 : 200, {
      "content-type": "text/html",
    })
    response.end(body ?? "<title>Missing</title>")
  })
  await new Promise<void>((done) => site!.listen(0, "127.0.0.1", done))
  return `http://127.0.0.1:${(site.address() as AddressInfo).port}`
}

/** Runs `code` in each browser page; returns what each gave. */
function inPages(app: ElectronApplication, code: string): Promise<unknown[]> {
  return app.evaluate(({ webContents }, code) => {
    const pages = webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === "webview")
    // As the Person's own act: Chromium skips pages left without one when
    // it goes back.
    return Promise.all(pages.map((page) => page.executeJavaScript(code, true)))
  }, code)
}

/**
 * Presses a key in the browser page as the keyboard does. Playwright's own
 * keys skip Electron's `before-input-event`, where the desktop takes
 * Banda's keys from a page.
 */
async function pressInPage(
  app: ElectronApplication,
  keyCode: string,
  modifiers: ("alt" | "shift" | "control")[]
) {
  await app.evaluate(
    ({ webContents }, { keyCode, modifiers }) => {
      const page = webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview")!
      page.sendInputEvent({ type: "keyDown", keyCode, modifiers })
      page.sendInputEvent({ type: "keyUp", keyCode, modifiers })
    },
    { keyCode, modifiers }
  )
}

/** Opens a browser beside the first Thread; returns its address bar. */
async function openBrowser(page: Page): Promise<Locator> {
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Browser" })
    .click()
  // One browser here: its row's address, whatever the tile is named.
  return page.getByRole("textbox", { name: "Address" })
}

test("a Person browses in a Pane that keeps its page wherever it moves", async () => {
  const address = await serve({
    "/": '<title>Alpha</title><a href="/beta">Beta</a>',
    "/beta": "<title>Beta</title><p>The second page</p>",
  })
  window = await startWindow()
  const { app, page } = window
  const { thread: draft } = await firstThread(page)
  await expect(draft).toBeVisible()

  // A new browser waits for an address.
  const bar = await openBrowser(page)
  await expect(bar).toBeFocused()
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")

  // The row shows the site; the tile is named by the page.
  const alpha = page.getByRole("region", { name: "Alpha" })
  await expect(alpha).toBeVisible()
  await expect(bar).toHaveValue(address.replace("http://", ""))
  await expect.poll(() => inPages(app, "document.title")).toEqual(["Alpha"])

  // The page lies over its slot, inside the tile.
  const slot = alpha.locator("[data-holds]")
  const held = page.locator("[data-held-by]")
  // Both are read each time: the tile may still be moving as it opens.
  await expect
    .poll(async () => {
      const [box, under] = await Promise.all([
        held.boundingBox(),
        slot.boundingBox(),
      ])
      return box && under
        ? Math.abs(box.x - under.x) + Math.abs(box.y - under.y)
        : -1
    })
    .toBeLessThan(1)

  // It goes and comes back.
  await inPages(app, "document.querySelector('a').click()")
  const beta = page.getByRole("region", { name: "Beta" })
  await expect(beta).toBeVisible()
  await beta.getByRole("button", { name: "Back" }).click()
  await expect(alpha).toBeVisible()
  await inPages(app, "window.kept = 'yes'")

  // A click in the page focuses its tile. Banda's Alt keys and the
  // browser's own work while the page has the keys.
  await draft.click()
  await held.click()
  await expect(alpha).toHaveAttribute("data-focused", "true")
  await expect.poll(() => inPages(app, "document.hasFocus()")).toEqual([true])
  await pressInPage(app, "L", ["control"])
  await expect(bar).toBeFocused()
  await bar.press("Escape")
  await pressInPage(app, "Left", ["alt"])
  await expect(draft).toHaveAttribute("data-focused", "true")
  await page.keyboard.press("Alt+ArrowRight")
  await expect(alpha).toHaveAttribute("data-focused", "true")
  await expect.poll(() => inPages(app, "document.hasFocus()")).toEqual([true])

  // Moved to another workspace, it is the same page, not opened again.
  await pressInPage(app, "2", ["alt", "shift"])
  await expect(draft).toBeHidden()
  await expect(alpha).toBeVisible()
  expect(await inPages(app, "window.kept")).toEqual(["yes"])

  // Closed, its page goes.
  await pressInPage(app, "W", ["alt"])
  await expect(alpha).toBeHidden()
  await expect.poll(() => inPages(app, "1")).toEqual([])
})

test("a browser page is kept apart from Banda", async () => {
  const address = await serve({ "/": "<title>Alpha</title>" })
  window = await startWindow()
  const { app, page } = window
  await expect((await firstThread(page)).thread).toBeVisible()
  const bar = await openBrowser(page)
  await bar.fill(address)
  await bar.press("Enter")
  await expect(page.getByRole("region", { name: "Alpha" })).toBeVisible()

  // The page reaches nothing of Banda's.
  await expect
    .poll(() => inPages(app, "[typeof window.banda, typeof require]"))
    .toEqual([["undefined", "undefined"]])

  // Banda's page attaches no page outside the browser's profile.
  await page.evaluate((address) => {
    const view = document.createElement("webview")
    view.setAttribute("partition", "persist:other")
    view.setAttribute("src", address)
    document.body.append(view)
  }, address)
  await page.waitForTimeout(500)
  expect(await inPages(app, "location.href")).toEqual([`${address}/`])
})
