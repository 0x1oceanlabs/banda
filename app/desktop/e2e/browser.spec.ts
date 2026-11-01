import { createHash, generateKeyPairSync } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import {
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test"
import { firstThread, SANDBOXED, startWindow, type Window } from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

/** Serves `pages` on 127.0.0.1, a `.bin` one as a file to save; returns
 * its address. */
async function serve(pages: Record<string, string>): Promise<string> {
  site = createServer((request, response) => {
    const body = pages[request.url ?? "/"]
    const file = request.url?.endsWith(".bin")
    response.writeHead(body === undefined ? 404 : 200, {
      "content-type": file ? "application/octet-stream" : "text/html",
      ...(file && { "content-disposition": "attachment" }),
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
 * Presses a key in the browser page that has the focus as the keyboard
 * does. Playwright's own
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
      const pages = webContents
        .getAllWebContents()
        .filter((contents) => contents.getType() === "webview")
      const page = pages.find((each) => each.isFocused()) ?? pages[0]!
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
  return addressBar(page)
}

/** One browser here: its row's address, whatever the tile is named. */
function addressBar(page: Page): Locator {
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
  // Alt+Shift+Return opens a browser too, as Omarchy's Super+Shift+Return.
  await page.keyboard.press("Alt+Shift+Enter")
  const bar = addressBar(page)
  await expect(bar).toBeFocused()
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

test("tabs open, show and close as Chrome's, on top or on the left", async () => {
  const address = await serve({
    "/": '<title>Alpha</title><a id="beta" href="/beta" target="_blank">Beta</a><a id="file" href="/notes.bin">Notes</a>',
    "/beta": "<title>Beta</title>",
    "/gamma": "<title>Gamma</title>",
    "/notes.bin": "notes",
  })
  window = await startWindow()
  const { app, page, dir } = window
  await expect((await firstThread(page)).thread).toBeVisible()
  await page.keyboard.press("Alt+Shift+Enter")
  const bar = addressBar(page)
  await bar.fill(address)
  await bar.press("Enter")
  const tabs = page.getByRole("tablist", { name: "Tabs" })
  const tab = (name: string) => tabs.getByRole("tab", { name, exact: true })
  await expect(tab("Alpha")).toHaveAttribute("aria-selected", "true")

  // A link for a new tab opens one beside its page, and it shows.
  await inPages(app, 'document.getElementById("beta").click()')
  await expect(tab("Beta")).toHaveAttribute("aria-selected", "true")
  await expect(tabs.getByRole("tab")).toHaveText(["Alpha", "Beta"])

  // Chrome's keys, from the page: Ctrl+Tab, Ctrl+T, Ctrl+W, Ctrl+Shift+T.
  await pressInPage(app, "Tab", ["control"])
  await expect(tab("Alpha")).toHaveAttribute("aria-selected", "true")
  await pressInPage(app, "T", ["control"])
  await expect(bar).toBeFocused()
  await bar.fill(`${address}/gamma`)
  await bar.press("Enter")
  await expect(tab("Gamma")).toHaveAttribute("aria-selected", "true")
  await expect(tabs.getByRole("tab")).toHaveText(["Alpha", "Beta", "Gamma"])
  await pressInPage(app, "W", ["control"])
  await expect(tab("Beta")).toHaveAttribute("aria-selected", "true")
  // The closed tab's page is gone; the one in the background is kept.
  await expect
    .poll(async () => (await inPages(app, "document.title")).sort())
    .toEqual(["Alpha", "Beta"])
  await pressInPage(app, "T", ["control", "shift"])
  await expect(tab("Gamma")).toHaveAttribute("aria-selected", "true")

  await page.screenshot({ path: "test-results/browser-tabs-top.png" })
  // A click shows a tab; the page under the row is its page.
  await tab("Alpha").click()
  await expect(tab("Alpha")).toHaveAttribute("aria-selected", "true")
  await expect(bar).toHaveValue(address.replace("http://", ""))

  // The switch puts the tabs on the left, in browser.toml.
  const file = join(dir, "config/browser.toml")
  await page.getByRole("button", { name: "Tabs on the left" }).click()
  await expect.poll(() => readFileSync(file, "utf8")).toMatch(/^tabs = "left"/m)
  await expect(tabs).toHaveAttribute("aria-orientation", "vertical")
  await page.screenshot({ path: "test-results/browser-tabs-left.png" })
  // The rail opens to titles over the page while the pointer rests on it.
  await tabs.hover()
  const titles = page.locator("[data-browser-titles]")
  await expect(titles.getByText("Gamma")).toBeVisible()
  await titles.getByRole("tab", { name: "Beta" }).click()
  await page.screenshot({ path: "test-results/browser-tabs-titles.png" })
  // Leaving the rail closes the titles.
  await bar.hover()
  await expect(titles).toBeHidden()
  await expect(tab("Beta")).toHaveAttribute("aria-selected", "true")
  await page.getByRole("button", { name: "Tabs on top" }).click()
  await expect.poll(() => readFileSync(file, "utf8")).toMatch(/^tabs = "top"/m)
  await expect(tabs).not.toHaveAttribute("aria-orientation", "vertical")

  // A download goes to Downloads, and the row shows it.
  const downloads = join(dir, "downloads")
  mkdirSync(downloads)
  await app.evaluate(
    ({ app }, path) => app.setPath("downloads", path),
    downloads
  )
  await tab("Alpha").click()
  await inPages(app, 'document.getElementById("file")?.click()')
  await expect.poll(() => existsSync(join(downloads, "notes.bin"))).toBe(true)
  await page.getByRole("button", { name: "Downloads" }).click()
  await expect(page.getByRole("menuitem", { name: /notes\.bin/ })).toBeVisible()
  await page.keyboard.press("Escape")

  // The Pane keeps its tabs: Banda's page drawn again shows them all.
  await page.reload()
  await expect(tabs.getByRole("tab")).toHaveText(["Alpha", "Beta", "Gamma"])
  await expect(tab("Alpha")).toHaveAttribute("aria-selected", "true")
})

test("the Banda menu opens an address, and a file of the focused Space, in a browser", async () => {
  const address = await serve({ "/": "<title>Alpha</title>" })
  window = await startWindow()
  const { app, page, dir } = window
  const { thread } = await firstThread(page)
  await expect(thread).toBeVisible()
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  const search = menu.getByRole("combobox", { name: "Search" })

  // An address typed opens, after New Thread with the words.
  const site = address.replace("http://", "")
  await page.keyboard.press("Alt+Space")
  await search.fill(site)
  await expect(menu.getByRole("option")).toHaveText([
    new RegExp(`New Thread: “${site}”`),
    `Open ${site}`,
  ])
  await search.press("ArrowDown")
  await search.press("Enter")
  await expect(menu).toBeHidden()
  await expect(page.getByRole("region", { name: "Alpha" })).toBeVisible()

  // Words would search the web. The page has the keys now, and Alt+Space
  // is Banda's there too.
  await pressInPage(app, "Space", ["alt"])
  await search.fill("two words")
  await expect(
    menu.getByRole("option", { name: "Search the web: “two words”" })
  ).toBeVisible()

  // The focused Space's files, as @ finds them; Enter opens one.
  const space = join(dir, "root", "Work")
  mkdirSync(join(space, "notes"), { recursive: true })
  writeFileSync(join(space, "notes", "plan.html"), "<title>The plan</title>")
  await search.fill("plan.ht")
  const files = menu.getByRole("group", { name: "Files" })
  await expect(files.getByRole("option")).toHaveText(/plan\.html\s*notes/)
  await page.screenshot({ path: "test-results/28-banda-menu-files.png" })
  await search.press("Enter")
  await expect(menu).toBeHidden()
  await expect(page.getByRole("region", { name: "The plan" })).toBeVisible()
})

/**
 * An extension as the Chrome Web Store installs one, in the browser's
 * profile: its `key` names it. Its button has a badge and a popup, which
 * opens a tab at `?open=` of its own address.
 */
function storeExtension(): { id: string; files: Record<string, string> } {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const der = publicKey.export({ type: "spki", format: "der" })
  const id = [...createHash("sha256").update(der).digest("hex").slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join("")
  const folder = `state/window/Extensions/${id}/1.0.0_0`
  const manifest = {
    manifest_version: 3,
    name: "Fixture",
    version: "1.0.0",
    key: der.toString("base64"),
    action: { default_title: "Fixture", default_popup: "popup.html" },
    background: { service_worker: "worker.js" },
    permissions: ["tabs"],
  }
  return {
    id,
    files: {
      [`${folder}/manifest.json`]: JSON.stringify(manifest),
      [`${folder}/worker.js`]: `chrome.tabs.onUpdated.addListener((tabId, change) => {
        if (change.status === "complete") chrome.action.setBadgeText({ tabId, text: "7" })
      })`,
      [`${folder}/popup.html`]:
        '<body style="width:220px;height:90px"><p>From the popup</p><script src="popup.js"></script></body>',
      [`${folder}/popup.js`]:
        "window.openTab = (url) => chrome.tabs.create({ url })",
    },
  }
}

test("an extension's button shows its popup, which opens a tab", async () => {
  const address = await serve({
    "/": "<title>Alpha</title>",
    "/delta": "<title>Delta</title>",
  })
  const extension = storeExtension()
  window = await startWindow({ files: extension.files })
  const { app, page, dir } = window
  await expect((await firstThread(page)).thread).toBeVisible()
  await page.keyboard.press("Alt+Shift+Enter")
  const bar = addressBar(page)
  await bar.fill(address)
  await bar.press("Enter")
  const tabs = page.getByRole("tablist", { name: "Tabs" })
  await expect(tabs.getByRole("tab")).toHaveText(["Alpha"])

  // The extensions' menu lists it; its pin puts it on the row, in
  // browser.toml.
  await page.getByRole("button", { name: "Extensions" }).click()
  await expect(page.getByRole("menuitem", { name: /Fixture/ })).toBeVisible()
  await page.getByRole("button", { name: "Pin Fixture" }).click()
  const file = join(dir, "config/browser.toml")
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain(`pinned = ["${extension.id}"]`)
  await page.keyboard.press("Escape")
  // Its worker sets the badge: workers have their APIs only in the sandbox.
  const button = page.getByRole("button", {
    name: SANDBOXED ? "Fixture (7)" : "Fixture",
    exact: true,
  })
  await expect(button).toBeVisible()

  // Its popup opens in the window under it, as large as its page: 220
  // pixels and the page's margins;
  // a second click closes it.
  await button.click()
  await expect.poll(() => popupBox(app)).toMatchObject({ width: 236 })
  const shown = (await popupBox(app))!
  const under = (await button.boundingBox())!
  expect(shown.y).toBeGreaterThan(under.y + under.height)
  expect(shown.x + shown.width).toBeCloseTo(under.x + under.width, -1)
  await page.screenshot({ path: "test-results/browser-extension-popup.png" })
  await button.click()
  await expect.poll(() => popupBox(app)).toBeNull()
  await button.click()
  await expect.poll(() => popupBox(app)).not.toBeNull()

  // A tab it opens is a tab of this browser, and shows.
  await app.evaluate(({ webContents }, url) => {
    const popup = webContents
      .getAllWebContents()
      .find((each) => each.getURL().endsWith("/popup.html"))
    return popup?.executeJavaScript(`openTab(${JSON.stringify(url)})`)
  }, `${address}/delta`)
  await expect(tabs.getByRole("tab")).toHaveText(["Alpha", "Delta"])
  await expect(tabs.getByRole("tab", { name: "Delta" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  // The popup lost the focus to the new tab, so it closed.
  await expect.poll(() => popupBox(app)).toBeNull()
})

/** Where an extension's popup shows in the window; none while none does. */
function popupBox(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0]?.contentView.children ?? []
    const popup = views.find(
      (view) =>
        "webContents" in view &&
        (view.webContents as Electron.WebContents)
          .getURL()
          .endsWith("/popup.html")
    )
    return popup?.getBounds() ?? null
  })
}
