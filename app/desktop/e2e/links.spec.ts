import { existsSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window
let site: Server

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

test("Thread web links open in Banda, Ctrl+click externally, including a popped Thread", async () => {
  site = createServer((_, response) => {
    response.end("<title>Link destination</title><h1>Destination</h1>")
  })
  await new Promise<void>((done) => site.listen(0, "127.0.0.1", done))
  const address = `http://127.0.0.1:${(site.address() as AddressInfo).port}/path?q=one#two`
  window = await startWindow()
  const { app, page } = window
  // Record the real desktop route without launching another application.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { linkOpens?: string[] }).linkOpens = opened
    shell.openExternal = async (url) => {
      opened.push(url)
    }
  })
  const external = () =>
    app.evaluate(() => (globalThis as { linkOpens?: string[] }).linkOpens)
  const { thread, composer } = await firstThread(page)
  await composer.fill(
    `[Destination](${address})\n\nhttps://github.com/0x1oceanlabs/banda/issues/493?example=long-address-for-display&source=thread#discussion`
  )
  await composer.press("Enter")
  const link = thread
    .locator('[data-slot="markdown"]')
    .getByRole("link", { name: /^Destination/ })
  await expect(link).toHaveAttribute("href", address)
  await page.screenshot({ path: "test-results/thread-web-links.png" })
  await link.click({ modifiers: ["Control"] })
  await expect.poll(external).toEqual([address])
  await expect(page.locator("webview")).toHaveCount(0)
  await link.click()
  await expect(page.locator("webview")).toHaveCount(1)
  await expect
    .poll(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .filter((c) => c.getType() === "webview")
          .map((c) => c.getURL())
      )
    )
    .toEqual([address])
  expect(await external()).toEqual([address])
  expect(page.url()).toContain("app://banda")
  await expect(thread).toBeVisible()

  const [popped] = await Promise.all([
    app.waitForEvent("window"),
    thread.getByRole("button", { name: "Pop out" }).click(),
  ])
  await popped.waitForLoadState()
  const poppedLink = popped
    .locator('[data-slot="markdown"]')
    .getByRole("link", { name: /^Destination/ })
  await poppedLink.click({ modifiers: ["Control"] })
  await expect.poll(external).toEqual([address, address])
  await poppedLink.focus()
  await poppedLink.press("Enter")
  await expect(page.locator("webview")).toHaveCount(2)
  expect(await external()).toEqual([address, address])
  expect(popped.url()).toContain("#pane/")
})

test("a terminal's paths open in Banda's browser, and Ctrl+click opens them in their app", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  const space = join(dir, "root", "Work")
  const notes = join(space, "notes.txt")
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { pathOpens?: string[] }).pathOpens = opened
    shell.openPath = async (path) => {
      opened.push(path)
      return ""
    }
  })
  const outside = () =>
    app.evaluate(() => (globalThis as { pathOpens?: string[] }).pathOpens)
  await firstThread(page)
  await expect(page.getByRole("region", { name: "New Thread" })).toBeVisible()
  writeFileSync(notes, "Notes\n")
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Terminal" })
    .click()
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  // Where the shell is: its header says it, and paths start there.
  await expect(
    page.locator("section[data-tile]").filter({ has: screen }).locator("header")
  ).toContainText("root/Work")
  await screen.click()
  // The path, line and column as a compiler prints them, on the first row.
  await page.keyboard.type("clear; printf './notes.txt:3:1\\n'; : > printed")
  await page.keyboard.press("Enter")
  await expect.poll(() => existsSync(join(space, "printed"))).toBe(true)
  const canvas = screen.locator("canvas").first()
  const box = (await canvas.boundingBox())!
  const on = { x: box.x + 24, y: box.y + 8 }
  await page.mouse.move(on.x, on.y)
  await expect(canvas).toHaveAttribute(
    "title",
    `${notes}\nClick to open in Banda · Ctrl+click to open in its app`
  )

  await page.keyboard.down("Control")
  await page.mouse.click(on.x, on.y)
  await page.keyboard.up("Control")
  await expect.poll(outside).toEqual([notes])
  await expect(page.locator("webview")).toHaveCount(0)

  // A click soon after is a double click, which selects a word.
  await page.waitForTimeout(600)
  await page.mouse.click(on.x, on.y)
  await expect
    .poll(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .filter((c) => c.getType() === "webview")
          .map((c) => c.getURL())
      )
    )
    .toEqual([pathToFileURL(notes).href])
  expect(await outside()).toEqual([notes])
})
