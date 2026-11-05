import { createHash, generateKeyPairSync } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import {
  chromium,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test"
import {
  agentAnswers,
  agentCalls,
  agentSays,
  firstThread,
  GLASS,
  SANDBOXED,
  startWindow,
  textOf,
  wallpaper,
  type Window,
} from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

/** Serves `pages` on 127.0.0.1, a `.bin` one as a file to save and a
 * `.js` one as a script; returns its address. */
async function serve(pages: Record<string, string>): Promise<string> {
  site = createServer((request, response) => {
    const body = pages[request.url ?? "/"]
    const file = request.url?.endsWith(".bin")
    const script = request.url?.endsWith(".js")
    response.writeHead(body === undefined ? 404 : 200, {
      "content-type": file
        ? "application/octet-stream"
        : script
          ? "text/javascript"
          : "text/html",
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
  modifiers: ("alt" | "shift" | "control")[],
  types: ("keyDown" | "keyUp")[] = ["keyDown", "keyUp"]
) {
  await app.evaluate(
    ({ webContents }, { keyCode, modifiers, types }) => {
      const pages = webContents
        .getAllWebContents()
        .filter((contents) => contents.getType() === "webview")
      const page = pages.find((each) => each.isFocused()) ?? pages[0]!
      for (const type of types) {
        page.sendInputEvent({ type, keyCode, modifiers })
      }
    },
    { keyCode, modifiers, types }
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

test("a gap dragged over a browser's page sizes the column: the page lets the pointer by", async () => {
  const address = await serve({ "/": "<title>Alpha</title><p>A page</p>" })
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { page } = window
  const { thread: draft } = await firstThread(page)
  await expect(draft).toBeVisible()
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  const alpha = page.getByRole("region", { name: "Alpha" })
  await expect(alpha).toBeVisible()
  const held = page.locator("[data-held-by]")
  await expect(held).toBeVisible()

  // The gap right of the Thread, dragged far into the page: the page
  // lets it by while it moves, and takes the pointer again after.
  const thread = (await draft.boundingBox())!
  const shown = (await held.boundingBox())!
  const from = { x: thread.x + thread.width + 6, y: shown.y + shown.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await expect(page.locator("html[data-drag]")).toHaveCount(1)
  await expect
    .poll(() => held.evaluate((e) => getComputedStyle(e).pointerEvents))
    .toBe("none")
  await page.mouse.move(shown.x + shown.width / 2, from.y, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator("html[data-drag]")).toHaveCount(0)
  await expect
    .poll(async () => (await draft.boundingBox())!.width)
    .toBeGreaterThan(thread.width + shown.width / 3)
  await expect
    .poll(() => held.evaluate((e) => getComputedStyle(e).pointerEvents))
    .toBe("auto")
})

test("with Alt held in a browser's page, the mouse moves its Pane from the page", async () => {
  const address = await serve({ "/": "<title>Alpha</title><p>A page</p>" })
  window = await startWindow({ look: "[columns]\nmin = 10\n" })
  const { app, page } = window
  const { thread: draft } = await firstThread(page)
  await expect(draft).toBeVisible()
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  const alpha = page.getByRole("region", { name: "Alpha" })
  await expect(alpha).toBeVisible()
  const held = page.locator("[data-held-by]")
  await expect(held).toBeVisible()
  const pointer = () => held.evaluate((e) => getComputedStyle(e).pointerEvents)

  // Alt pressed in the page stays the page's, and the window hears it:
  // the page lets the mouse through while it is held.
  await held.click()
  await expect.poll(() => inPages(app, "document.hasFocus()")).toEqual([true])
  const alt = (type: "keyDown" | "keyUp") =>
    pressInPage(app, "Alt", ["alt"], [type])
  await alt("keyDown")
  await expect(page.locator("html[data-mod]")).toHaveCount(1)
  await expect.poll(pointer).toBe("none")
  await alt("keyUp")
  await expect(page.locator("html[data-mod]")).toHaveCount(0)
  await expect.poll(pointer).toBe("auto")

  // Alt and the left button on the page carry its Pane: to the Thread's
  // left, a column of its own there. The page hears Alt as the keyboard
  // presses it; the mouse holds it as Playwright's.
  const shown = (await held.boundingBox())!
  const thread = (await draft.boundingBox())!
  await alt("keyDown")
  await expect.poll(pointer).toBe("none")
  await page.keyboard.down("Alt")
  await page.mouse.move(shown.x + shown.width / 2, shown.y + shown.height / 2)
  await page.mouse.down()
  await page.mouse.move(thread.x + 10, thread.y + thread.height / 2, {
    steps: 10,
  })
  await page.mouse.up()
  await page.keyboard.up("Alt")
  await expect
    .poll(async () =>
      Math.sign((await draft.boundingBox())!.x - (await alpha.boundingBox())!.x)
    )
    .toBe(1)
  await expect(alpha).toHaveAttribute("data-focused", "true")
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
  await expect.poll(() => textOf(file)).toMatch(/^tabs = "left"/m)
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
  await expect.poll(() => textOf(file)).toMatch(/^tabs = "top"/m)
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

test("the Banda menu opens an address, and a file of the focused Project, in a browser", async () => {
  const address = await serve({ "/": "<title>Alpha</title>" })
  window = await startWindow()
  const { app, page, dir } = window
  const { thread } = await firstThread(page)
  await expect(thread).toBeVisible()
  // A file of the Project's, there before the menu first lists the files:
  // the engine keeps a listing a few seconds.
  const project = join(dir, "root", "Work")
  mkdirSync(join(project, "notes"), { recursive: true })
  writeFileSync(join(project, "notes", "plan.html"), "<title>The plan</title>")
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

  // The focused Project's files, as @ finds them; Enter opens one.
  await search.fill("plan.ht")
  const files = menu.getByRole("group", { name: "Files" })
  await expect(files.getByRole("option")).toHaveText(/plan\.html\s*notes/)
  await page.screenshot({ path: "test-results/28-banda-menu-files.png" })
  await search.press("Enter")
  await expect(menu).toBeHidden()
  await expect(page.getByRole("region", { name: "The plan" })).toBeVisible()
})

test("the blocker drops what its lists name, and browser.toml turns it off", async () => {
  const address = await serve({
    "/": '<title>Ads</title><p class="banda-ad">An ad</p><script src="/banda-ad.js"></script>',
    "/banda-ad.js": "document.title = 'Shown'",
  })
  window = await startWindow()
  const { app, page, dir } = window
  const { thread: draft } = await firstThread(page)
  await expect(draft).toBeVisible()
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  // The script is dropped and the ad hidden: the startWindow's lists name both.
  const loaded = "document.readyState === 'complete' && document.title"
  await expect.poll(() => inPages(app, loaded)).toEqual(["Ads"])
  const shown = "getComputedStyle(document.querySelector('.banda-ad')).display"
  await expect.poll(() => inPages(app, shown)).toEqual(["none"])

  writeFileSync(join(dir, "config/browser.toml"), "blocker = false\n")
  await expect
    .poll(async () => {
      await inPages(app, "location.reload()")
      return inPages(app, loaded)
    })
    .toEqual(["Shown"])
  expect(await inPages(app, shown)).toEqual(["block"])
})

test("an Agent drives the browser's tabs over CDP, and Banda stays", async () => {
  const address = await serve({
    "/": "<title>Agent</title><button onclick=\"document.title = 'Clicked'\">Go</button>",
    "/second": "<title>Second</title>",
  })
  window = await startWindow()
  const { app, page, dir, banda } = window
  const { thread: draft } = await firstThread(page)
  await expect(draft).toBeVisible()

  // `banda browser` says what the window wrote, the Person's alone.
  const file = join(dir, "state", "browser.json")
  await expect.poll(() => existsSync(file)).toBe(true)
  expect(statSync(file).mode & 0o777).toBe(0o600)
  const endpoint = banda("browser").trim()
  expect(endpoint).toBe(JSON.parse(readFileSync(file, "utf8")).endpoint)
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}$/)
  // Without the token, or from a web page, it answers nothing.
  const wrong = endpoint.replace(/[0-9a-f]{48}$/, "0".repeat(48))
  expect((await fetch(`${wrong}/json/version`)).status).toBe(404)
  const fromPage = await fetch(`${endpoint}/json/version`, {
    headers: { origin: "https://example.com" },
  })
  expect(fromPage.status).toBe(403)

  // Its targets are the tabs: never Banda's own page.
  const browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]!
  expect(context.pages()).toEqual([])

  // With no browser, a tab it opens gets a Pane beside the Person's, who
  // keeps the focus.
  const tab = await context.newPage()
  await tab.goto(`${address}/`)
  await expect(addressBar(page)).toBeVisible()
  await expect(draft).toHaveAttribute("data-focused", "true")
  await tab.getByRole("button", { name: "Go" }).click()
  await expect.poll(() => inPages(app, "document.title")).toEqual(["Clicked"])

  // A tab it opens is the Pane's, and closes there too.
  const second = await context.newPage()
  await second.goto(`${address}/second`)
  await expect
    .poll(async () => (await inPages(app, "document.title")).sort())
    .toEqual(["Clicked", "Second"])
  await second.close()
  await expect.poll(() => inPages(app, "document.title")).toEqual(["Clicked"])

  // The tab it drives shows its mark; a click on it stops the Agent
  // there, and Banda's tab stays.
  const tabs = page.getByRole("tablist", { name: "Tabs" })
  const stop = tabs.getByRole("button", { name: "Stop the Agent in Clicked" })
  await stop.click()
  await expect.poll(() => tab.isClosed()).toBe(true)
  await expect(stop).toBeHidden()
  expect(await inPages(app, "document.title")).toEqual(["Clicked"])

  // It leaves; Banda and its tab stay.
  await browser.close()
  await expect(addressBar(page)).toBeVisible()
  expect(await inPages(app, "document.title")).toEqual(["Clicked"])
})

test("an Agent sees the browser's tabs, the Person's too, through its own tools", async () => {
  const address = await serve({ "/": "<title>Seen</title>" })
  window = await startWindow()
  const { page, banda } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const tabs = () => agentAnswers(window, "browser_tabs", {})
  expect(await tabs()).toEqual([])

  // The Person's tab: the Agent sees it, driven by no one.
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  await expect(page.getByRole("region", { name: "Seen" })).toBeVisible()
  const [seen] = await tabs()
  expect(seen).toMatchObject({
    url: `${address}/`,
    title: "Seen",
    driven: false,
  })
  expect(typeof seen.id).toBe("number")

  // Driven over CDP, it says so.
  const browser = await chromium.connectOverCDP(banda("browser").trim())
  expect(browser.contexts()[0]!.pages()).toHaveLength(1)
  await expect.poll(async () => (await tabs())[0].driven).toBe(true)
  await browser.close()
  await expect.poll(async () => (await tabs())[0].driven).toBe(false)
})

test("an Agent reads a tab's tree with refs and new errors, until the Person stops it there", async () => {
  const address = await serve({ "/": "<title>Read</title><button>Go</button>" })
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  await expect(page.getByRole("region", { name: "Read" })).toBeVisible()
  const [{ id }] = await agentAnswers(window, "browser_tabs", {})
  const snapshot = () => agentSays(window, "browser_snapshot", { tab: id })

  // The tree comes as text, with the page's address and title, and refs.
  const first = await snapshot()
  expect(first).toContain(`Page: ${address}/\nTitle: Read\n`)
  expect(first).toMatch(/button "Go" \[ref=e\d+\]/)
  expect(first).not.toContain("errors since")
  // Banda holds the tab while it reads it, and says so.
  const tabs = page.getByRole("tablist", { name: "Tabs" })
  const stop = tabs.getByRole("button", { name: "Stop the Agent in Read" })
  await expect(stop).toBeVisible()

  // An error the page logs comes with the next snapshot, once.
  await inPages(app, 'console.error("nope")')
  await expect
    .poll(snapshot)
    .toContain("errors since the last snapshot:\n- nope")
  expect(await snapshot()).not.toContain("- nope")

  // The Person stops the Agent there: its Thread waits until they let it
  // drive again, and its call there is refused meanwhile. Once it called,
  // its row asks the Person, as for a Question.
  await stop.click()
  await expect(stop).toBeHidden()
  const stopped = page.getByRole("status", {
    name: "hello is stopped in this tab",
  })
  await expect(stopped).toContainText("Stopped hello")
  const row = page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /hello/ })
  await expect(row).not.toContainText("Stopped on a tab")
  const refused = await agentCalls(window, "browser_snapshot", { tab: id })
  expect(refused.isError).toBe(true)
  expect(refused.content[0]!.text).toContain(
    `The Person stopped you on tab ${id}.`
  )
  await expect(row).toContainText("Stopped on a tab: let it drive again")
  await expect(row).toContainText("Asks you")

  // Let drive again, it reads the tab once more, and its row is calm.
  await stopped.getByRole("button", { name: "Let drive again" }).click()
  await expect(stopped).toHaveCount(0)
  await expect(row).not.toContainText("Stopped on a tab")
  expect(await snapshot()).toMatch(/button "Go" \[ref=e\d+\]/)

  // A tab there is not is refused, and says where the tabs are.
  const none = await agentCalls(window, "browser_snapshot", { tab: 999999 })
  expect(none.isError).toBe(true)
  expect(none.content[0]!.text).toContain("browser_tabs lists them")
})

test("an Agent hands a tab to the Person, who hands it back, and its Thread carries on", async () => {
  const address = await serve({
    "/": "<title>Sign in</title><button>Go</button>",
  })
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const opened = await agentSays(window, "browser_open", { url: `${address}/` })
  const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])

  // The tab asks the Person at once, and its Thread's row with it.
  const why = "Place the order"
  expect(await agentSays(window, "browser_handoff", { tab, why })).toBe(
    `Handed tab ${tab} to your Person. End your turn now: their message says when they are done, and you carry on then.`
  )
  const card = page.getByRole("status", {
    name: "hello handed this tab to you",
  })
  await expect(card).toContainText(`Your turn. ${why}.`)
  await expect(card).toContainText("hello waits until you hand back the tab.")
  // The card stays at the foot, clear of the window's top-right toast.
  const bounds = await card.boundingBox()
  expect(bounds!.y).toBeGreaterThan(
    (await page.evaluate(() => innerHeight)) / 2
  )
  for (const toast of await page.locator("[data-sonner-toast]").all()) {
    const notice = await toast.boundingBox()
    if (notice) expect(bounds!.y).toBeGreaterThan(notice.y + notice.height)
  }
  const row = page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /hello/ })
  await expect(row).toContainText(`Your turn in a tab: ${why}`)
  await expect(row).toContainText("Asks you")
  await page.screenshot({ path: "test-results/browser-handoff.png" })
  // Meanwhile the tab is the Person's.
  const refused = await agentCalls(window, "browser_snapshot", { tab })
  expect(refused.isError).toBe(true)
  expect(refused.content[0]!.text).toContain(
    `You handed tab ${tab} to the Person: "${why}".`
  )

  // Done hands it back, and says so in the Thread, as the Person's
  // message, which starts its next turn.
  await card.getByRole("button", { name: "Done — hand back" }).click()
  await expect(card).toHaveCount(0)
  await expect(
    thread.getByText(`You said: Done: ${why}. Carry on.`)
  ).toBeVisible()
  await expect(row).not.toContainText("Your turn in a tab")
  expect(await agentSays(window, "browser_snapshot", { tab })).toContain(
    "Title: Sign in"
  )
})

test("an Agent asks the Person before it uses a new site: once, always or never", async () => {
  const address = await serve({
    "/": "<title>Sign in</title><button>Go</button>",
  })
  // *.localhost is this computer too, yet not localhost, which never asks.
  const on = (name: string) => address.replace("127.0.0.1", `${name}.localhost`)
  window = await startWindow()
  const { page, dir } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const row = page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("button", { name: /hello/ })
  /** Opens a tab on the site `name`, which needs no yes, and reads it,
   * which does: the tab asks the Person, and the Thread's row with it. */
  const asking = async (name: string) => {
    const opened = await agentSays(window, "browser_open", {
      url: `${on(name)}/`,
    })
    const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
    const refused = await agentCalls(window, "browser_snapshot", { tab })
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toContain(
      `Tab ${tab} is on ${name}.localhost, which you may not use yet`
    )
    const pill = page.getByRole("status", {
      name: `hello asks to use ${name}.localhost`,
    })
    await expect(pill).toBeVisible()
    await expect(row).toContainText(`Asks to use ${name}.localhost`)
    return { tab, pill }
  }

  // Once lets this Thread, and says so in it as the Person's message.
  const first = await asking("once")
  await page.screenshot({ path: "test-results/browser-site.png" })
  await first.pill.getByRole("button", { name: "Once" }).click()
  await expect(first.pill).toHaveCount(0)
  await expect(
    thread.getByText("You said: once.localhost: allowed once. Carry on.")
  ).toBeVisible()
  await expect(row).not.toContainText("Asks to use")
  expect(
    await agentSays(window, "browser_snapshot", { tab: first.tab })
  ).toContain("Title: Sign in")

  // Always and Deny are for every Agent, in browser.toml.
  const file = join(dir, "config/browser.toml")
  const second = await asking("always")
  await second.pill.getByRole("button", { name: "Always" }).click()
  await expect(
    thread.getByText("You said: always.localhost: always allowed. Carry on.")
  ).toBeVisible()
  await expect
    .poll(() => textOf(file))
    .toMatch(/^"always.localhost" = "allow"$/m)
  const third = await asking("deny")
  await third.pill.getByRole("button", { name: "Deny" }).click()
  await expect(
    thread.getByText("You said: deny.localhost: denied. Carry on without it.")
  ).toBeVisible()
  await expect.poll(() => textOf(file)).toMatch(/^"deny.localhost" = "deny"$/m)
  // A denied site refuses, and asks nothing.
  const denied = await agentCalls(window, "browser_snapshot", {
    tab: third.tab,
  })
  expect(denied.content[0]!.text).toContain(
    "The Person lets no Agent use deny.localhost."
  )
  await expect(third.pill).toHaveCount(0)

  // Settings shows them; a line changes, or ↶ takes it out.
  await page.keyboard.press("Alt+Comma")
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await settings.getByRole("button", { name: "Browser" }).click()
  const sites = settings.getByRole("radiogroup", { name: /for Agents$/ })
  await expect(sites).toHaveCount(2)
  await page.screenshot({ path: "test-results/browser-sites-settings.png" })
  await settings
    .getByRole("radiogroup", { name: "deny.localhost for Agents" })
    .getByRole("radio", { name: "allow" })
    .click()
  await expect.poll(() => textOf(file)).toMatch(/^"deny.localhost" = "allow"$/m)
  await settings
    .getByRole("button", { name: 'Reset agents.sites."always.localhost"' })
    .click()
  await expect(sites).toHaveCount(1)
  expect(textOf(file)).not.toContain("always.localhost")
})

test("an Agent opens a tab and takes it to an address, back, forward and again", async () => {
  const address = await serve({
    "/": "<title>First</title>",
    "/second": "<title>Second</title>",
  })
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  // With no browser, the tab gets a Pane of its own beside the Thread,
  // and the answer is a line: the tab, where it is, its title.
  const opened = await agentSays(window, "browser_open", { url: `${address}/` })
  const id = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
  expect(opened).toBe(
    `Opened tab ${id}. Tab ${id} shows ${address}/, titled "First".`
  )
  await expect(page.getByRole("region", { name: "First" })).toBeVisible()

  const go = (to: string) =>
    agentSays(window, "browser_navigate", { tab: id, to })
  const second = `Tab ${id} shows ${address}/second, titled "Second".`
  expect(await go(`${address}/second`)).toBe(`Went to the address. ${second}`)
  await expect(page.getByRole("region", { name: "Second" })).toBeVisible()
  expect(await go("back")).toBe(
    `Went back. Tab ${id} shows ${address}/, titled "First".`
  )
  expect(await go("forward")).toBe(`Went forward. ${second}`)
  expect(await go("reload")).toBe(`Reloaded. ${second}`)

  // Where there is nowhere to go, nothing is done, and it says so.
  const further = await agentCalls(window, "browser_navigate", {
    tab: id,
    to: "forward",
  })
  expect(further.isError).toBe(true)
  expect(further.content[0]!.text).toBe(
    `Refused (conflict): Tab ${id} has nowhere to go forward. Nothing was done.`
  )
  // The Person's files are not the Agent's to open.
  const file = await agentCalls(window, "browser_open", {
    url: "file:///etc/hostname",
  })
  expect(file.isError).toBe(true)
  expect(file.content[0]!.text).toContain("http:// or https://")

  // A blank tab, beside the first.
  expect(await agentSays(window, "browser_open", {})).toMatch(
    /^Opened tab (\d+)\. Tab \1 shows about:blank, untitled\.$/
  )
  expect(await agentAnswers(window, "browser_tabs", {})).toHaveLength(2)
})

test("an Agent's tab opens beside its Thread, in the browser there, and the Person keeps the focus", async () => {
  const address = await serve({
    "/": "<title>First</title>",
    "/second": "<title>Second</title>",
    "/mine": "<title>Mine</title>",
  })
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  // The Person's own browser, left of the Thread, focused last.
  await page.keyboard.press("Alt+Shift+Enter")
  const bar = addressBar(page)
  await bar.fill(`${address}/mine`)
  await bar.press("Enter")
  const mine = page.getByRole("region", { name: "Mine" })
  await expect(mine).toBeVisible()
  // The window hears its keys from the bar, not the page.
  await bar.focus()
  await page.keyboard.press("Alt+Shift+Home")
  await composer.click()
  const threadBox = async () => (await thread.boundingBox())!
  await expect
    .poll(async () => (await mine.boundingBox())!.x < (await threadBox()).x)
    .toBe(true)

  // No browser right of the Thread: one opens there, out of focus, and
  // the Person's keeps its one tab.
  await agentSays(window, "browser_open", { url: `${address}/` })
  const first = page.getByRole("region", { name: "First" })
  await expect(first).toBeVisible()
  await expect(composer).toBeFocused()
  const right = await threadBox()
  expect((await first.boundingBox())!.x).toBeGreaterThanOrEqual(
    right.x + right.width
  )
  const tabs = page.getByRole("tablist", { name: "Tabs" })
  await expect(tabs).toHaveCount(2)
  await expect(tabs.first().getByRole("tab")).toHaveText(["Mine"])
  // It is the Thread's Group's: the two stand on one plate, the Person's
  // browser out of it (ADR 0065, decision 7).
  const plates = page.locator("[data-group-plate]")
  await expect(plates).toHaveCount(2)
  await expect(
    thread.locator("xpath=ancestor::*[@data-column][1]/*[@data-group-plate]")
  ).toHaveCount(1)
  await page.screenshot({ path: "test-results/agent-group.png" })

  // The next one is a tab of the browser beside the Thread.
  await agentSays(window, "browser_open", { url: `${address}/second` })
  await expect(tabs.last().getByRole("tab")).toHaveText(["First", "Second"])
  await expect(tabs.first().getByRole("tab")).toHaveText(["Mine"])
  await expect(composer).toBeFocused()
})

test("a Thread's tab glows and its pill says the Thread and its step, until the Person stops it or the turn ends", async () => {
  const address = await serve({
    "/": `<title>Form</title><button onclick="out.textContent = 'Hi'">Greet</button><p id="out"></p>`,
  })
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("wait here")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.")).toBeVisible()

  // The pill names the Thread and the step it takes.
  const opened = await agentSays(window, "browser_open", { url: `${address}/` })
  const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
  const pill = page.getByRole("status", { name: "wait here drives this tab" })
  const host = new URL(address).host
  await expect(pill).toContainText(`wait here· Opening ${host}`)
  const tree = await agentSays(window, "browser_snapshot", { tab })
  await expect(pill).toContainText("· Reading the page")
  const greet = /button "Greet" \[ref=(e\d+)\]/.exec(tree)![1]
  await agentSays(window, "browser_act", { tab, action: "click", ref: greet })
  await expect(pill).toContainText('· Clicking "Greet"')
  // Its cursor, labelled with the Thread, went where it clicked.
  const cursor = page.locator('[data-cursor="wait here"]')
  await expect(cursor).toContainText("wait here")
  await expect(cursor).not.toHaveCSS("transform", "none")

  // Its title goes to the Thread.
  await addressBar(page).focus()
  await pill.getByRole("button", { name: "wait here", exact: true }).click()
  await expect(composer).toBeFocused()

  // Its Stop ends that Thread's drive there, until the Person lets it
  // drive again.
  await pill.getByRole("button", { name: "Stop wait here in this tab" }).click()
  await expect(pill).toHaveCount(0)
  const stopped = page.getByRole("status", {
    name: "wait here is stopped in this tab",
  })
  await stopped.getByRole("button", { name: "Let drive again" }).click()
  await expect(stopped).toHaveCount(0)
  await agentSays(window, "browser_snapshot", { tab })
  await expect(pill).toBeVisible()

  // The turn's end ends it too.
  await thread.getByRole("button", { name: "Stop" }).click()
  await expect(pill).toHaveCount(0)
})

test("an Agent acts in a tab by refs, hears what changed, and leaves the Person's secrets alone", async () => {
  const form = `<title>Form</title>
    <label>Name <input id="name"></label>
    <label>Password <input id="pw" type="password"></label>
    <label>Card <input autocomplete="cc-number"></label>
    <select aria-label="Size"><option value="s">Small</option><option value="l">Large</option></select>
    <button onclick="out.textContent = 'Hello ' + document.getElementById('name').value + ', ' + document.querySelector('select').value">Greet</button>
    <button onclick="setTimeout(() => out.textContent = 'Late', 300)">Later</button>
    <a href="/second">Next</a> <a href="/second" target="_blank">Elsewhere</a>
    <a href="/file.bin">Get</a>
    <form onsubmit="event.preventDefault(); out.textContent = 'Sent ' + q.value"><input id="q" aria-label="Query"></form>
    <p id="out"></p>`
  const address = await serve({
    "/": form,
    "/second": "<title>Second</title>",
    "/file.bin": "bytes",
  })
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const opened = await agentSays(window, "browser_open", { url: `${address}/` })
  const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
  const snapshot = () => agentSays(window, "browser_snapshot", { tab })
  const act = (args: object) =>
    agentSays(window, "browser_act", { tab, ...args })
  /** The ref of the element of `role` and `name` in `tree`. */
  const ref = (tree: string, role: string, name: string) =>
    new RegExp(`${role} "${name}"[^\\n]*\\[ref=(e\\d+)\\]`).exec(tree)?.[1] ??
    `no ${role} "${name}" in ${tree}`

  // Fill, select and click answer in a line; the page shows what they did.
  let tree = await snapshot()
  const name = ref(tree, "textbox", "Name")
  expect(await act({ action: "fill", ref: name, text: "Roma" })).toBe(
    `Filled ${name}.`
  )
  const size = ref(tree, "combobox", "Size")
  expect(await act({ action: "select", ref: size, values: ["Large"] })).toBe(
    `Selected "Large" in ${size}.`
  )
  // An option the list does not have is refused at once, naming them all.
  const none = await agentCalls(window, "browser_act", {
    tab,
    action: "select",
    ref: size,
    values: ["large"],
  })
  expect(none.content[0]!.text).toBe(
    `Refused (invalid): ${size} has no option "large". Its options: "Small", "Large". Nothing was done.`
  )
  const greet = ref(tree, "button", "Greet")
  expect(await act({ action: "click", ref: greet })).toBe(`Clicked ${greet}.`)
  expect(await snapshot()).toContain("Hello Roma, l")
  // Keys go to the tab, never to where the Person's focus is.
  const query = ref(tree, "textbox", "Query")
  expect(await act({ action: "type", ref: query, text: "a b" })).toBe(
    `Typed into ${query}.`
  )
  expect(await act({ action: "press", ref: query, key: "Enter" })).toBe(
    `Pressed Enter in ${query}.`
  )
  expect(await snapshot()).toContain("Sent a b")
  await expect(composer).toHaveText("")

  // A password or a card is the Person's to fill, and a snapshot hides
  // what the Person put there.
  tree = await snapshot()
  for (const field of ["Password", "Card"]) {
    const refused = await agentCalls(window, "browser_act", {
      tab,
      action: "type",
      ref: ref(tree, "textbox", field),
      text: "1234",
    })
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toContain("Refused (forbidden)")
    expect(refused.content[0]!.text).toContain("the Person's to fill")
  }
  await inPages(app, 'document.getElementById("pw").value = "hunter2"')
  const masked = await snapshot()
  expect(masked).not.toContain("hunter2")
  expect(masked).toMatch(/textbox "Password" \[ref=e\d+\]: ••••/)
  expect(masked).toMatch(/textbox "Name" \[ref=e\d+\]: Roma/)

  // The Person clicks in the page: the next answer says so, once.
  await page.locator("[data-held-by]").click()
  const said = await act({ action: "hover", ref: greet })
  expect(said).toBe(
    `Hovered over ${greet}. The Person also acted on this page since your last snapshot. Take a new snapshot before you act by ref.`
  )
  expect(await act({ action: "hover", ref: greet })).toBe(
    `Hovered over ${greet}.`
  )

  // A wait holds until the page shows the text, or refuses after its time.
  tree = await snapshot()
  await act({ action: "click", ref: ref(tree, "button", "Later") })
  expect(
    await agentSays(window, "browser_wait_for", { tab, text: "Late" })
  ).toBe(`The page shows "Late". Tab ${tab} shows ${address}/, titled "Form".`)
  const never = await agentCalls(window, "browser_wait_for", {
    tab,
    text: "Never",
    seconds: 1,
  })
  expect(never.content[0]!.text).toContain(`did not show "Never" within 1 s`)

  // A download, a new tab and a new address are said.
  const get = ref(tree, "link", "Get")
  expect(await act({ action: "click", ref: get })).toBe(
    `Clicked ${get}. It began to download "file.bin".`
  )
  const elsewhere = ref(tree, "link", "Elsewhere")
  expect(await act({ action: "click", ref: elsewhere })).toMatch(
    new RegExp(`^Clicked ${elsewhere}\\. It opened tab \\d+, at `)
  )
  const next = ref(tree, "link", "Next")
  expect(await act({ action: "click", ref: next })).toBe(
    `Clicked ${next}. Tab ${tab} shows ${address}/second, titled "Second".`
  )
  // A ref of a page gone is refused, and says to look again.
  const stale = await agentCalls(window, "browser_act", {
    tab,
    action: "click",
    ref: greet,
  })
  expect(stale.content[0]!.text).toContain("take a new snapshot")
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
    .poll(() => textOf(file))
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

  // A tab it opens is a tab of this browser, and shows. The popup closes
  // as it does, so nothing waits on the page it ran in.
  await app.evaluate(({ webContents }, url) => {
    const popup = webContents
      .getAllWebContents()
      .find((each) => each.getURL().endsWith("/popup.html"))
    void popup?.executeJavaScript(`void openTab(${JSON.stringify(url)})`)
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

test("a page that paints no background lies on white, as in a browser, unless it asks for dark", async () => {
  const address = await serve({
    "/": '<title>Plain</title><a href="/night">Night</a>',
    "/night":
      '<meta name="color-scheme" content="dark"><title>Night</title><p>Night</p>',
  })
  window = await startWindow({ look: 'mode = "dark"\n' })
  const { app, page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  await expect(page.getByRole("region", { name: "Plain" })).toBeVisible()
  const held = page.locator("[data-held-by]")
  // A pixel of the page where it draws nothing: its bottom middle, clear
  // of the tile's rounded corners.
  const canvas = async () => {
    const box = (await held.boundingBox())!
    return app.evaluate(
      async ({ BrowserWindow }, at) => {
        const shot = await BrowserWindow.getAllWindows()[0].capturePage({
          x: Math.round(at.x),
          y: Math.round(at.y),
          width: 1,
          height: 1,
        })
        const [b, g, r] = shot.toBitmap()
        return [r, g, b]
      },
      { x: box.x + box.width / 2, y: box.y + box.height - 8 }
    )
  }
  // Banda is dark, but the page asks for nothing: white, as Chrome paints
  // it, so its black text reads.
  await expect.poll(canvas).toEqual([255, 255, 255])
  // A page that asks for dark lies on a browser's dark canvas.
  await inPages(app, "document.querySelector('a').click()")
  await expect(page.getByRole("region", { name: "Night" })).toBeVisible()
  await expect.poll(canvas).toEqual([18, 18, 18])
})

test("a selected browser page keeps its brightness while the overview takes the keys", async () => {
  const address = await serve({
    "/": "<title>Steady page</title><p>Steady page</p>",
  })
  window = await startWindow({
    look: '[tile]\ndim-inactive = 0.5\n[motion.overview]\neasing = { duration-ms = 600, curve = "linear" }\n',
  })
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const bar = await openBrowser(page)
  await bar.fill(address)
  await bar.press("Enter")
  const browser = page.getByRole("region", { name: "Steady page", exact: true })
  await expect(browser).toHaveAttribute("data-focused", "true")
  const id = await browser.getAttribute("data-tile")
  const real = page.locator(`section[data-tile="${id}"]`)
  const veil = page.locator("[data-held-by] > div").last()
  await expect(veil).toHaveCSS("opacity", "0")
  const steady = async () => {
    const values = await veil.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const values: number[] = []
          const start = performance.now()
          const sample = () => {
            values.push(Number(getComputedStyle(element).opacity))
            if (performance.now() - start > 700) resolve(values)
            else requestAnimationFrame(sample)
          }
          sample()
        })
    )
    expect(values.length).toBeGreaterThan(5)
    expect(Math.max(...values)).toBe(0)
  }
  await pressInPage(window.app, "O", ["alt"])
  const overview = page.getByRole("dialog", { name: "Overview" })
  await expect(overview).toBeFocused()
  await expect(real).toHaveAttribute("data-focused", "false")
  await steady()
  await page.keyboard.press("Enter")
  await steady()
  await expect(real).toHaveAttribute("data-focused", "true")
  await pressInPage(window.app, "Left", ["alt"])
  await expect(composer).toBeFocused()
  await expect(veil).toHaveCSS("opacity", "0.5")
})

test("on glass a terminal and a browser's page are as clear as any tile", async () => {
  const address = await serve({ "/": "<title>Alpha</title><p>Alpha</p>" })
  window = await startWindow({ look: GLASS })
  const { page, dir } = window
  wallpaper(dir)
  await expect(page.locator("html")).toHaveAttribute("data-glass", "")
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()

  // A terminal's screen is clear where nothing is written: its tile shows.
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  const corner = await screen
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!
      const { width, height } = canvas
      return context.getImageData(width - 2, height - 2, 1, 1).data[3]
    })
  expect(corner).toBe(0)

  // A page is as dense as a tile, over its own tile left clear.
  const bar = await openBrowser(page)
  await bar.fill(address.replace("http://", ""))
  await bar.press("Enter")
  const tile = page.getByRole("region", { name: "Alpha" })
  await expect(tile).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  const held = page.locator("[data-held-by]")
  await expect(held).toHaveCSS("opacity", "0.95")

  // On a solid desk the page is solid.
  writeFileSync(join(dir, "config/look.toml"), `${GLASS}glass = false\n`)
  await expect(page.locator("html")).not.toHaveAttribute("data-glass")
  await expect(held).toHaveCSS("opacity", "1")
})

test("page dialogs stay in their tab and the Person and Agent answer the same dialog once", async () => {
  const address = await serve({
    "/": `<title>Dialogs</title>
      <button onclick="out.textContent = String(confirm('Remove tea?'))">Confirm</button>
      <button onclick="out.textContent = JSON.stringify(prompt('Gift message?', 'Enjoy your tea!'))">Prompt</button>
      <button onclick="alert('Basket updated'); out.textContent = 'Alert done'">Alert</button>
      <button onclick="out.textContent = JSON.stringify(frames[0].prompt('Frame message?', 'Frame default'))">Frame prompt</button>
      <iframe src="/frame"></iframe>
      <p id="out"></p>`,
    "/frame": "<title>Child</title>",
    "/onload": "<title>On load</title><script>alert('Hello on load')</script>",
  })
  window = await startWindow()
  const { page } = window
  // The Electron test harness also attaches a CDP client to webviews.
  // Keep that client from auto-dismissing dialogs behind Banda's UI.
  window.app.context().on("page", (entry) => entry.on("dialog", () => {}))
  for (const entry of window.app.context().pages()) entry.on("dialog", () => {})
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const opened = await agentSays(window, "browser_open", { url: address })
  const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
  const snapshot = () => agentSays(window, "browser_snapshot", { tab })
  const click = async (name: string) => {
    const tree = await snapshot()
    const ref = new RegExp(`button "${name}"[^\\n]*\\[ref=(e\\d+)\\]`).exec(
      tree
    )![1]
    const said = await agentSays(window, "browser_act", {
      tab,
      action: "click",
      ref,
    })
    expect(said).toMatch(/dialog \(id ([^)]+)\)/)
    return /dialog \(id ([^)]+)\)/.exec(said)![1]
  }
  const card = page.getByRole("dialog", { name: /says/ })
  const first = await click("Confirm")
  await expect(card).toContainText("Remove tea?")
  await page.screenshot({ path: "test-results/browser-page-dialog.png" })
  expect(await snapshot()).toContain(`confirm dialog (id ${first})`)
  const bounds = await card.boundingBox()
  const view = await page.locator("[data-held-by]").boundingBox()
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - view!.x - view!.width / 2)
  ).toBeLessThan(3)
  expect(
    Math.abs(bounds!.y + bounds!.height / 2 - view!.y - view!.height / 2)
  ).toBeLessThan(3)
  await card.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(await snapshot()).toContain("false")
  const stale = await agentCalls(window, "browser_act", {
    tab,
    action: "dialog_accept",
    dialog: first,
  })
  expect(stale.content[0]!.text).toContain("Refused (conflict)")

  const accepted = await click("Confirm")
  await agentSays(window, "browser_act", {
    tab,
    action: "dialog_accept",
    dialog: accepted,
  })
  expect(await snapshot()).toContain("true")

  const prompt = await click("Prompt")
  await expect(card.getByRole("textbox", { name: "Response" })).toHaveValue(
    "Enjoy your tea!"
  )
  await card.getByRole("textbox", { name: "Response" }).fill("For Roma")
  await page.getByRole("button", { name: "New tab", exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole("tab", { name: "Dialogs", exact: true }).click()
  await expect(card.getByRole("textbox", { name: "Response" })).toHaveValue(
    "For Roma"
  )
  // An empty submitted string is a value; dismissing a prompt returns null.
  await agentSays(window, "browser_act", {
    tab,
    action: "dialog_accept",
    dialog: prompt,
    text: "",
  })
  await expect(card).toHaveCount(0)
  expect(await snapshot()).toContain('""')
  const again = await click("Prompt")
  await agentSays(window, "browser_act", {
    tab,
    action: "dialog_dismiss",
    dialog: again,
  })
  expect(await snapshot()).toContain("null")

  const nested = await click("Frame prompt")
  await expect(card.getByRole("textbox", { name: "Response" })).toHaveValue(
    "Frame default"
  )
  await agentSays(window, "browser_act", {
    tab,
    action: "dialog_accept",
    dialog: nested,
    text: "From frame",
  })
  expect(await snapshot()).toContain("From frame")

  // External Playwright and Banda answer the same callback.
  const browser = await chromium.connectOverCDP(window.banda("browser").trim())
  try {
    const remote = browser
      .contexts()[0]!
      .pages()
      .find((entry) => entry.url() === `${address}/`)!
    remote.once("dialog", (dialog) => {
      void dialog.accept("From CDP")
    })
    const tree = await snapshot()
    const ref = /button "Prompt"[^\n]*\[ref=(e\d+)\]/.exec(tree)![1]
    await agentSays(window, "browser_act", { tab, action: "click", ref })
    await expect(card).toHaveCount(0)
    expect(await snapshot()).toContain("From CDP")
  } finally {
    await browser.close()
  }

  const alert = await click("Alert")
  await expect(
    card.getByRole("button", { name: "Cancel", exact: true })
  ).toHaveCount(0)
  await agentSays(window, "browser_handoff", { tab, why: "Check the basket" })
  const forbidden = await agentCalls(window, "browser_act", {
    tab,
    action: "dialog_accept",
    dialog: alert,
  })
  expect(forbidden.content[0]!.text).toContain("Refused (forbidden)")
  await card.getByRole("button", { name: "OK", exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole("button", { name: "Done — hand back" }).click()
  expect(await snapshot()).toContain("Alert done")
  const loaded = await agentSays(window, "browser_open", {
    url: `${address}/onload`,
  })
  expect(loaded).toContain("Hello on load")
  await expect(card).toContainText("Hello on load")
  await card.getByRole("button", { name: "OK", exact: true }).click()
  await expect(card).toHaveCount(0)
})

for (const dpr of [1, 2])
  test(`viewport screenshots retain corners and masks at native zoom and DPR ${dpr}`, async () => {
    const address = await serve({
      "/": `<title>Zoom corners</title><style>body{margin:0;height:2400px}.corner{position:fixed;width:80px;height:80px;z-index:2}.tl{top:0;left:0;background:red}.tr{top:0;right:0;background:blue}.bl{bottom:0;left:0;background:yellow}.br{bottom:0;right:0;background:lime}input{position:fixed;left:120px;top:100px;width:160px;height:40px}</style><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i><input type="password" value="synthetic-secret"><script>window.requestAnimationFrame=()=>{throw new Error('page-owned global')}</script>`,
    })
    window = await startWindow({
      deviceScaleFactor: dpr,
      files: { "config/browser.toml": "[agents]\nscreenshots = true\n" },
    })
    const { app, page } = window
    const host = await app.context().newCDPSession(page)
    await host.send("Emulation.clearDeviceMetricsOverride")
    await host.detach()
    const { thread, composer } = await firstThread(page)
    await composer.fill("hello")
    await composer.press("Enter")
    await expect(thread.getByText("You said: hello")).toBeVisible()
    const opened = await agentSays(window, "browser_open", { url: address })
    const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
    await expect(
      page.getByRole("region", { name: "Zoom corners", exact: true })
    ).toBeVisible()
    const view = await page
      .locator("[data-held-by] webview")
      .evaluate((view) => ({
        width: view.clientWidth,
        height: view.clientHeight,
      }))
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, tab) =>
            webContents.fromId(tab)!.executeJavaScript("innerWidth"),
          tab
        )
      )
      .toBe(view.width)
    for (const zoom of [1, 1.25, 0.8]) {
      for (const scroll of [0, 120]) {
        const at = await app.evaluate(
          async ({ webContents }, { tab, zoom, scroll }) => {
            const target = webContents.fromId(tab)!
            target.setZoomFactor(zoom)
            return target.executeJavaScriptInIsolatedWorld(1001, [
              {
                code: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { scrollTo(0,${scroll}); const r=document.querySelector('input').getBoundingClientRect(); resolve({width:innerWidth,height:innerHeight,x:r.x+r.width/2,y:r.y+r.height/2}) })))`,
              },
            ])
          },
          { tab, zoom, scroll }
        )
        const result = await agentCalls(window, "browser_screenshot", { tab })
        expect(result.isError, result.content[0].text).toBeFalsy()
        const meta = JSON.parse(result.content[0].text)
        const image = result.content[1]!
        if (image.type !== "image") throw new Error("No image returned")
        const pixels = await app.evaluate(
          ({ nativeImage }, { data, at }) => {
            const image = nativeImage.createFromBuffer(
              Buffer.from(data, "base64")
            )
            const { width, height } = image.getSize()
            const pixels = image.toBitmap()
            const rgb = (x: number, y: number) =>
              [
                ...pixels.subarray(
                  (Math.floor(y) * width + Math.floor(x)) * 4,
                  (Math.floor(y) * width + Math.floor(x)) * 4 + 3
                ),
              ].reverse()
            return {
              width,
              height,
              tl: rgb(20, 20),
              tr: rgb(width - 40, 20),
              bl: rgb(20, height - 25),
              br: rgb(width - 40, height - 25),
              mask: rgb((at.x * width) / at.width, (at.y * height) / at.height),
            }
          },
          { data: image.data, at }
        )
        const scale = Math.min(
          1,
          1280 / Math.max(view.width * dpr, view.height * dpr)
        )
        expect(meta.width).toBeCloseTo(view.width * dpr * scale, 0)
        expect(meta.height).toBeCloseTo(view.height * dpr * scale, 0)
        expect(pixels.tl[0]).toBeGreaterThan(220)
        expect(pixels.tr[2]).toBeGreaterThan(220)
        expect(pixels.bl[0]).toBeGreaterThan(220)
        expect(pixels.bl[1]).toBeGreaterThan(220)
        expect(pixels.br[1]).toBeGreaterThan(220)
        expect(
          Math.max(...pixels.mask),
          JSON.stringify({ zoom, scroll, at, meta, pixels })
        ).toBeLessThan(20)
      }
    }
  })

test("browser screenshots are MCP images with masked fields and live Agent settings", async () => {
  const address = await serve({
    "/": `<title>Canvas</title><style>body{margin:0}input{position:absolute;left:20px;top:20px;width:200px;height:36px}input[autocomplete]{top:80px}iframe{position:absolute;left:0;top:140px;width:260px;height:100px;border:0}canvas{position:absolute;left:20px;top:260px}</style>
      <input type="password" value="secret-password"><input autocomplete="cc-number" value="4242424242424242">
      <iframe src="/frame"></iframe><canvas width="200" height="60"></canvas>
      <script>const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,200,60)</script>`,
    "/frame":
      '<style>body{margin:0}input{width:200px;height:36px;margin:20px}</style><input autocomplete="cc-csc" value="123">',
    "/dialog": '<title>Dialog</title><script>alert("Answer first")</script>',
  })
  window = await startWindow()
  const { app, page, dir } = window
  // startWindow's host viewport emulation propagates to webviews without
  // resizing their native surfaces. Capture the native viewport instead.
  const hostSession = await app.context().newCDPSession(page)
  await hostSession.send("Emulation.clearDeviceMetricsOverride")
  await hostSession.detach()
  app.context().on("page", (entry) => entry.on("dialog", () => {}))
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const opened = await agentSays(window, "browser_open", { url: address })
  const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
  const shot = () => agentCalls(window, "browser_screenshot", { tab })
  const disabled = await shot()
  expect(disabled.isError).toBe(true)
  expect(disabled.content).toHaveLength(1)
  expect(disabled.content[0].text).toContain("screenshots are disabled")

  await page.keyboard.press("Alt+Comma")
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await settings.getByRole("button", { name: "Browser", exact: true }).click()
  const images = settings
    .locator('[data-key="agents.screenshots"]')
    .getByRole("switch")
  await expect(images).not.toBeChecked()
  await images.click()
  await expect(images).toBeChecked()
  const file = join(dir, "config/browser.toml")
  await expect.poll(() => textOf(file)).toContain("screenshots = true")
  await page.screenshot({ path: "test-results/browser-agent-settings.png" })
  const hidden = await shot()
  // A retained surface may still capture on some platforms. When none
  // exists, refuse with a useful recovery instead of returning an image.
  if (hidden.isError) {
    expect(hidden.content).toHaveLength(1)
    expect(hidden.content[0].text).toContain("Show this tab in a browser Pane")
  }
  await settings.getByRole("button", { name: "Close Settings" }).click()
  let result = await shot()
  await expect
    .poll(async () => {
      result = await shot()
      return result.isError ? result.content[0].text : "image"
    })
    .toBe("image")
  expect(result.content).toHaveLength(2)
  const meta = JSON.parse(result.content[0].text)
  expect(meta).toMatchObject({ tab, title: "Canvas", url: `${address}/` })
  const viewport = await page
    .locator("[data-held-by] webview")
    .evaluate((view) => ({
      width: view.clientWidth,
      height: view.clientHeight,
    }))
  expect(meta).toMatchObject(viewport)
  expect(meta.width).toBeGreaterThan(0)
  expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1280)
  expect(meta.pictures).toBeUndefined()
  const image = result.content[1]!
  if (image.type !== "image") throw new Error("MCP returned no image")
  expect(image.mimeType).toBe("image/jpeg")
  const bytes = Buffer.from(image.data, "base64")
  expect(bytes.length).toBeLessThanOrEqual(1024 * 1024)
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255])
  // JPEG pixels prove capture and masking, including the child frame.
  const samples = await app.evaluate(({ nativeImage }, data) => {
    const image = nativeImage.createFromBuffer(Buffer.from(data, "base64"))
    const size = image.getSize()
    const bitmap = image.toBitmap()
    const at = (x: number, y: number) => [
      ...bitmap.subarray(
        (y * size.width + x) * 4,
        (y * size.width + x) * 4 + 3
      ),
    ]
    return {
      size,
      password: at(100, 35),
      card: at(100, 100),
      frame: at(100, 190),
      canvas: at(100, 265),
    }
  }, image.data)
  expect(samples.size).toEqual({ width: meta.width, height: meta.height })
  for (const pixel of [samples.password, samples.card, samples.frame])
    expect(Math.max(...pixel)).toBeLessThan(20)
  expect(samples.canvas[1]).toBeGreaterThan(220)

  // A resize follows the actual native viewport; zoom/HiDPI cases above
  // exercise bounding when physical pixels exceed the image limit.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1800, 1600)
  )
  await expect
    .poll(async () => {
      const large = await shot()
      expect(large.isError, large.content[0].text).toBeFalsy()
      const meta = JSON.parse(large.content[0].text)
      const view = await page
        .locator("[data-held-by] webview")
        .evaluate((view) => ({
          width: view.clientWidth,
          height: view.clientHeight,
        }))
      return (
        Math.max(meta.width, meta.height) ===
        Math.min(1280, Math.max(view.width, view.height))
      )
    })
    .toBe(true)

  // Turning tools off also refuses calls in already established Threads.
  await page.keyboard.press("Alt+Comma")
  await settings.getByRole("button", { name: "Browser", exact: true }).click()
  const enabled = settings
    .locator('[data-key="agents.enabled"]')
    .getByRole("switch")
  await enabled.click()
  await expect.poll(() => textOf(file)).toContain("enabled = false")
  await expect
    .poll(async () => (await agentCalls(window, "browser_tabs", {})).isError)
    .toBe(true)
  const blocked = await shot()
  expect(blocked.isError).toBe(true)
  expect(blocked.content).toHaveLength(1)
  await enabled.click()
  await expect.poll(() => textOf(file)).toContain("enabled = true")
  await expect
    .poll(
      async () =>
        (await agentCalls(window, "browser_tabs", {})).isError ?? false
    )
    .toBe(false)

  await agentSays(window, "browser_handoff", { tab, why: "Check the image" })
  const handed = await shot()
  expect(handed.isError).toBe(true)
  expect(handed.content[0].text).toContain("handed tab")
  expect(handed.content).toHaveLength(1)
  // The same site permissions gate image data.
  writeFileSync(
    file,
    textOf(file) + '\n[agents.sites]\n"denied.localhost" = "deny"\n'
  )
  await expect(
    settings.getByRole("radiogroup", { name: "denied.localhost for Agents" })
  ).toHaveCount(1)
  const deniedAddress = address.replace("127.0.0.1", "denied.localhost")
  const deniedOpen = await agentSays(window, "browser_open", {
    url: deniedAddress,
  })
  const deniedTab = Number(/^Opened tab (\d+)\./.exec(deniedOpen)?.[1])
  const denied = await agentCalls(window, "browser_screenshot", {
    tab: deniedTab,
  })
  expect(denied.isError).toBe(true)
  expect(denied.content).toHaveLength(1)
  expect(denied.content[0].text).toContain("lets no Agent")

  await settings.getByRole("button", { name: "Close Settings" }).click()
  const dialogOpen = await agentSays(window, "browser_open", {
    url: `${address}/dialog`,
  })
  const dialogTab = Number(/^Opened tab (\d+)\./.exec(dialogOpen)?.[1])
  const dialog = await agentCalls(window, "browser_screenshot", {
    tab: dialogTab,
  })
  expect(dialog.isError).toBe(true)
  expect(dialog.content).toHaveLength(1)
  expect(dialog.content[0].text).toContain("open dialog")
  await page
    .getByRole("dialog", { name: /says/ })
    .getByRole("button", { name: "OK", exact: true })
    .click()
})

test("secret fields in frames and shadow roots refuse keys and keep safe snapshot refs", async () => {
  const address = await serve({
    "/": `<title>Fields</title>
      <input aria-label="Password" type="password" value="trial-password">
      <input aria-label="Numeric card" type="number" autocomplete="cc-number" value="246813579">
      <input aria-label="CVV" autocomplete="cc-csc" value="2">
      <textarea aria-label="Card notes" autocomplete="cc-number">445566</textarea>
      <input aria-label="Name"><div contenteditable="true" role="textbox" aria-label="Rich password" autocomplete="current-password">rich-secret-only</div>
      <iframe src="/frame"></iframe><div id="shadow"></div>
      <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<input aria-label="Shadow password" type="password" value="shadow-secret">'</script>`,
    "/frame":
      '<input aria-label="Frame card" autocomplete="cc-number" value="112233445"><input aria-label="Frame password" type="password" value="frame-secret">',
  })
  window = await startWindow()
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()
  const opened = await agentSays(window, "browser_open", { url: address })
  const tab = Number(/^Opened tab (\d+)\./.exec(opened)?.[1])
  const tree = await agentSays(window, "browser_snapshot", { tab })
  for (const value of [
    "trial-password",
    "246813579",
    "445566",
    "112233445",
    "shadow-secret",
    "frame-secret",
    "rich-secret-only",
  ])
    expect(tree).not.toContain(value)
  expect(tree).toMatch(/spinbutton "Numeric card" \[ref=e\d+\]: "••••"/)
  expect(tree).toMatch(/textbox "CVV" \[ref=e\d+\]: "••••"/)
  const ref = (name: string) =>
    new RegExp(`(?:textbox|spinbutton) "${name}" \\[ref=([^\\]]+)\\]`).exec(
      tree
    )![1]!
  const refusedKey = async (key: string, target?: string) => {
    const result = await agentCalls(window, "browser_act", {
      tab,
      action: "press",
      key,
      ...(target ? { ref: target } : {}),
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Refused (forbidden)")
    expect(result.content[0].text).toContain("browser_handoff")
  }
  await refusedKey("Shift+A", ref("Password"))
  await refusedKey("Shift+A", ref("Rich password"))
  await refusedKey("ArrowUp", ref("Numeric card"))
  await refusedKey("Delete", ref("CVV"))
  for (const name of ["Frame password", "Shadow password"]) {
    await agentSays(window, "browser_act", {
      tab,
      action: "click",
      ref: ref(name),
    })
    await refusedKey("Q")
  }
  // The same keyboard still edits a field that belongs to the task.
  await agentSays(window, "browser_act", {
    tab,
    action: "fill",
    ref: ref("Name"),
    text: "Roma",
  })
  await agentSays(window, "browser_act", {
    tab,
    action: "press",
    ref: ref("Name"),
    key: "Shift+A",
  })
  const values = await inPages(
    app,
    '({name:document.querySelector("[aria-label=Name]").value,password:document.querySelector("[aria-label=Password]").value,card:document.querySelector("[aria-label=\\"Numeric card\\"]").value,cvv:document.querySelector("[aria-label=CVV]").value,frame:document.querySelector("iframe").contentDocument.querySelector("[type=password]").value,shadow:document.querySelector("#shadow").shadowRoot.querySelector("input").value})'
  )
  expect(values).toEqual([
    {
      name: "RomaA",
      password: "trial-password",
      card: "246813579",
      cvv: "2",
      frame: "frame-secret",
      shadow: "shadow-secret",
    },
  ])
})
