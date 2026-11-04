import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
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
