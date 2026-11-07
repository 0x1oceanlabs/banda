/**
 * How the tiling moves, measured on the real app: a Strip of terminals and
 * a browser, a column's width cycled, the focus stepped along the Strip,
 * the workspaces stepped, the overview opened and closed, and the window
 * left idle. For each: the main thread's layout, style and script time,
 * the frames, and how far the browser's page trails its tile. The numbers
 * go to test-results/motion.json; nothing is asserted yet.
 */
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { newTerminal, startWindow, type Window } from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

const METRICS = [
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
] as const

test("the Strip moves without trailing pages or long frames", async () => {
  test.setTimeout(180_000)
  site = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end(
      "<title>Page</title><body style='margin:0;background:linear-gradient(90deg,#f00,#00f)'><h1>Page</h1></body>"
    )
  })
  await new Promise<void>((done) => site!.listen(0, "127.0.0.1", done))
  const address = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`

  window = await startWindow()
  const { app, page } = window
  // The first terminal, printing all the while, as an Agent's would.
  const first = await newTerminal(page)
  await first.click()
  await page.keyboard.type("while :; do date +%N; sleep 0.02; done")
  await page.keyboard.press("Enter")

  const open = async (kind: string) => {
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: kind })
      .click()
  }
  for (let i = 0; i < 2; i++) {
    await open("Terminal")
    const screen = page.getByRole("region", { name: "Terminal screen" })
    await expect(screen).toHaveCount(i + 2)
  }
  await open("Browser")
  const bar = page.getByRole("textbox", { name: "Address" })
  await bar.fill(address)
  await bar.press("Enter")
  await expect
    .poll(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((c) => c.getType() === "webview" && c.getTitle() === "Page")
      )
    )
    .toBe(true)
  // The keys go to the window from a terminal, not from the page.
  await page.getByRole("region", { name: "Terminal screen" }).nth(2).click()
  await page.keyboard.press("Alt+ArrowRight")
  await page.getByRole("region", { name: "Terminal screen" }).nth(2).click()
  await page.waitForTimeout(1000)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const metrics = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics")
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
  }

  // Each frame, once it is drawn: how long since the last, and how far
  // the browser's page stands from its slot.
  await page.evaluate(() => {
    const w = window as unknown as {
      frames: number[]
      trail: number[]
      last: number
      on: boolean
    }
    w.frames = []
    w.trail = []
    w.last = 0
    w.on = true
    const step = (now: number) => {
      if (w.last) w.frames.push(now - w.last)
      w.last = now
      setTimeout(() => {
        const box = document.querySelector("[data-held-by]")
        const id = box?.getAttribute("data-held-by")
        const slot = id && document.querySelector(`[data-holds="${id}"]`)
        if (box && slot) {
          const a = box.getBoundingClientRect()
          const b = slot.getBoundingClientRect()
          // What the workspace shows of the slot: its Strip clips it.
          const strip = slot.closest("[data-strip]")!.getBoundingClientRect()
          const shows =
            Math.min(b.right, strip.right) - Math.max(b.left, strip.left) > 8 &&
            Math.min(b.bottom, strip.bottom) - Math.max(b.top, strip.top) > 8
          if (shows) {
            const hidden = a.left < -50000
            w.trail.push(
              hidden
                ? -1
                : Math.max(
                    Math.abs(a.left - b.left),
                    Math.abs(a.top - b.top),
                    Math.abs(a.width - b.width)
                  )
            )
          }
        }
      })
      if (w.on) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  const results: Record<string, unknown> = {}
  const measure = async (name: string, act: () => Promise<void>) => {
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      const w = window as unknown as { frames: number[]; trail: number[] }
      w.frames = []
      w.trail = []
    })
    const profile = process.env.MOTION_PROFILE?.split(",").includes(name)
    if (profile) {
      await cdp.send("Profiler.enable")
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
      await cdp.send("Profiler.start")
    }
    const before = await metrics()
    const started = Date.now()
    await act()
    const seconds = (Date.now() - started) / 1000
    const after = await metrics()
    if (profile) {
      const { profile: taken } = await cdp.send("Profiler.stop")
      writeFileSync(`test-results/${name}.cpuprofile`, JSON.stringify(taken))
    }
    const { frames, trail } = await page.evaluate(() => {
      const w = window as unknown as { frames: number[]; trail: number[] }
      return { frames: w.frames, trail: w.trail }
    })
    const sorted = [...frames].sort((a, b) => a - b)
    const p = (q: number) =>
      Math.round(
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10
      ) / 10
    const delta = Object.fromEntries(
      METRICS.map((m) => [
        m,
        m.endsWith("Duration")
          ? Math.round(((after[m] - before[m]) * 1000) / seconds)
          : Math.round((after[m] - before[m]) / seconds),
      ])
    )
    results[name] = {
      seconds: Math.round(seconds * 10) / 10,
      perSecond: delta,
      frames: frames.length,
      frameMs: { p50: p(0.5), p95: p(0.95), max: p(1) },
      longFrames: frames.filter((f) => f > 25).length,
      page: {
        seen: trail.length,
        trailing: trail.filter((t) => t > 1).length,
        trailMaxPx: Math.round(Math.max(0, ...trail)),
        hiddenWhileShown: trail.filter((t) => t < 0).length,
      },
    }
  }

  const presses = async (keys: string[], gap = 700) => {
    for (const key of keys) {
      await page.keyboard.press(key)
      await page.waitForTimeout(gap)
    }
  }

  const terminal = (n: number) =>
    page.getByRole("region", { name: "Terminal screen" }).nth(n)
  await measure("printing", () => page.waitForTimeout(3000))
  // Quiet from here: what the window costs by itself, and its moves.
  await terminal(0).click()
  await page.keyboard.press("Control+KeyC")
  // The last terminal, beside the browser, has the focus.
  await terminal(2).click()
  await measure("quiet", () => page.waitForTimeout(3000))
  await terminal(2).click()
  await measure("width", () =>
    presses([
      "Alt+KeyR",
      "Alt+KeyR",
      "Alt+KeyR",
      "Alt+KeyR",
      "Alt+KeyR",
      "Alt+KeyR",
    ])
  )
  await terminal(2).click()
  await measure("focus", () =>
    presses([
      "Alt+ArrowLeft",
      "Alt+ArrowLeft",
      "Alt+ArrowRight",
      "Alt+ArrowRight",
      "Alt+ArrowLeft",
      "Alt+ArrowLeft",
      "Alt+ArrowRight",
      "Alt+ArrowRight",
    ])
  )
  await terminal(2).click()
  await measure("maximize", () =>
    presses(["Alt+KeyF", "Alt+KeyF", "Alt+KeyF", "Alt+KeyF"])
  )
  await terminal(2).click()
  await measure("workspace", () =>
    presses(["Alt+PageDown", "Alt+PageUp", "Alt+PageDown", "Alt+PageUp"])
  )
  await terminal(2).click()
  const overview = page.getByRole("dialog", { name: "Overview" })
  await measure("overview", async () => {
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("Alt+KeyO")
      await expect(overview).toBeVisible()
      await page.waitForTimeout(900)
      await page.keyboard.press("Escape")
      await expect(overview).toBeHidden()
      await page.waitForTimeout(900)
    }
  })

  writeFileSync(
    "test-results/motion.json",
    `${JSON.stringify(results, null, 2)}\n`
  )
  console.log(JSON.stringify(results, null, 2))
})
