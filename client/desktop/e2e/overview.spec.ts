import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, test } from "@playwright/test"
import {
  firstThread,
  GLASS,
  startWindow,
  wallpaper,
  type Window,
} from "./window"

let window: Window
test.afterEach(async () => window?.close())

test("the open overview follows the theme and keeps the desk's glass tinted once", async () => {
  window = await startWindow({ look: 'mode = "light"\n[motion]\noff = true\n' })
  const { page, dir } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyO")
  const overview = page.getByRole("dialog", { name: "Overview" })
  await expect(overview).toBeFocused()
  const backdrop = page.locator("[data-overview-backdrop]")
  const label = overview.getByRole("button", { name: "Move workspace 1" })
  // Measure the colours as the browser paints them, whatever colour
  // syntax the stylesheet uses. A light theme must keep a light ground
  // and dark labels; changing the theme while open reverses that.
  const colour = (element: Locator, property: "backgroundColor" | "color") =>
    element.evaluate((element, property) => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const context = canvas.getContext("2d")!
      context.fillStyle = getComputedStyle(element)[property]
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return { brightness: (r + g + b) / (3 * 255), alpha: a / 255 }
    }, property)
  await expect
    .poll(async () => (await colour(backdrop, "backgroundColor")).brightness)
    .toBeGreaterThan(0.75)
  await expect
    .poll(async () => (await colour(label, "color")).brightness)
    .toBeLessThan(0.3)
  await page.screenshot({
    path: "test-results/overview-surface-light.png",
    animations: "disabled",
  })

  const look = (text: string) =>
    writeFileSync(join(dir, "config/look.toml"), text)
  look('mode = "dark"\n[motion]\noff = true\n')
  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect
    .poll(async () => (await colour(backdrop, "backgroundColor")).brightness)
    .toBeLessThan(0.3)
  await expect
    .poll(async () => (await colour(label, "color")).brightness)
    .toBeGreaterThan(0.75)
  await page.screenshot({
    path: "test-results/overview-surface-dark.png",
    animations: "disabled",
  })

  wallpaper(dir)
  look(`mode = "light"\n${GLASS}[motion]\noff = true\n`)
  await expect(page.locator("html[data-glass]")).toHaveCount(1)
  await expect
    .poll(async () => (await colour(backdrop, "backgroundColor")).alpha)
    .toBe(0)
  const stack = page.locator("[data-stack]").first()
  await expect
    .poll(async () => (await colour(stack, "backgroundColor")).alpha)
    .toBe(0)
  const desk = await colour(page.locator(".h-svh.bg-desk"), "backgroundColor")
  expect(desk.alpha).toBeGreaterThan(0)
  expect(desk.alpha).toBeLessThan(1)
  // The controls over a Pane take the popover's surface: solid, as menus
  // are over glass (ADR 0075, decision 3).
  const hint = overview.getByRole("button", { name: /^Close / }).first()
  await expect
    .poll(async () => (await colour(hint, "backgroundColor")).alpha)
    .toBe(1)
  await page.screenshot({
    path: "test-results/overview-surface-glass.png",
    animations: "disabled",
  })
  // The glass ground is clear, but a carried Pane must still be dimmed.
  const tile = overview.locator("[data-tile]").first()
  const box = (await tile.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    box.x + box.width / 2 + 20,
    box.y + box.height / 2 + 20,
    { steps: 4 }
  )
  await expect(tile).toHaveAttribute("data-lifted", "")
  await expect
    .poll(async () => (await colour(tile, "backgroundColor")).alpha)
    .toBeGreaterThan(0.25)
  await page.mouse.up()
  await expect(tile).not.toHaveAttribute("data-lifted")
  look(`mode = "dark"\n${GLASS}[motion]\noff = true\n`)
  await expect(page.locator("html[data-glass]")).toHaveClass(/dark/)
  await expect
    .poll(async () => (await colour(label, "color")).brightness)
    .toBeGreaterThan(0.75)
  await page.screenshot({
    path: "test-results/overview-surface-glass-dark.png",
    animations: "disabled",
  })
  look('mode = "light"\n[desk]\nglass = false\n[motion]\noff = true\n')
  await expect(page.locator("html[data-glass]")).toHaveCount(0)
  await expect
    .poll(async () => (await colour(backdrop, "backgroundColor")).alpha)
    .toBe(1)
  await expect
    .poll(async () => (await colour(backdrop, "backgroundColor")).brightness)
    .toBeGreaterThan(0.75)
  await page.keyboard.press("Escape")
  await expect(overview).toBeHidden()
  await expect(composer).toBeFocused()
})

const scaleOf = (stack: Locator) =>
  stack.evaluate(
    (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a
  )

for (const ring of [0, 3]) {
  test(`the selected Pane keeps one steady frame and its brightness through the overview zoom (ring ${ring})`, async () => {
    window = await startWindow({
      look: `[overview]\nzoom = ${ring ? 0.2 : 0.35}\n[tile]\ndim-inactive = 0.55\n[focus]\nring = ${ring}\nborder = "#3fa0e0"\n[motion.overview]\neasing = { duration-ms = 600, curve = "linear" }\n`,
    })
    const { page } = window
    const { thread, composer } = await firstThread(page)
    await expect(composer).toBeFocused()
    const id = await thread.getAttribute("data-tile")
    const real = page.locator(`section[data-tile="${id}"]`)
    await page.keyboard.press("Alt+KeyN")
    const launcher = page.getByRole("region", { name: "New Pane" })
    await expect(launcher).toHaveAttribute("data-focused", "true")
    const other = page.locator(
      `section[data-tile="${await launcher.getAttribute("data-tile")}"]`
    )
    await page.keyboard.press("Alt+ArrowLeft")
    await expect(composer).toBeFocused()
    await expect
      .poll(() =>
        real.evaluate((element) => {
          let opacity = 1
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          )
            opacity *= Number(getComputedStyle(node).opacity)
          return opacity
        })
      )
      .toBe(1)
    const sample = (pane: Locator) =>
      pane.evaluate(
        (element) =>
          new Promise<
            {
              stroke: number
              outline: string
              dim: number
              opacity: number
              gap: number
              visible: boolean
              clipped: number
            }[]
          >((resolve) => {
            const frames: {
              stroke: number
              outline: string
              dim: number
              opacity: number
              gap: number
              visible: boolean
              clipped: number
            }[] = []
            const start = performance.now()
            const read = () => {
              const frame =
                document.querySelector<HTMLElement>("[data-overview-focus]") ??
                (element as HTMLElement)
              const style = getComputedStyle(frame)
              const scale =
                frame.getBoundingClientRect().width / frame.offsetWidth
              const box = frame.getBoundingClientRect()
              const pane = element.getBoundingClientRect()
              const clip =
                frame === element
                  ? null
                  : frame.parentElement!.getBoundingClientRect()
              const outset = Math.max(
                0,
                parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
              )
              let opacity = 1
              for (
                let parent: HTMLElement | null = element as HTMLElement;
                parent;
                parent = parent.parentElement
              )
                opacity *= Number(getComputedStyle(parent).opacity)
              frames.push({
                stroke: parseFloat(style.outlineWidth) * scale,
                outline: style.outlineStyle,
                dim: Number(getComputedStyle(element, "::after").opacity),
                opacity,
                visible: style.visibility === "visible",
                clipped: clip
                  ? Math.max(
                      0,
                      clip.left - box.left + outset,
                      box.right + outset - clip.right,
                      clip.top - box.top + outset,
                      box.bottom + outset - clip.bottom
                    )
                  : 0,
                gap: Math.max(
                  Math.abs(box.x - pane.x),
                  Math.abs(box.y - pane.y),
                  Math.abs(box.width - pane.width),
                  Math.abs(box.height - pane.height)
                ),
              })
              if (performance.now() - start > 700) resolve(frames)
              else requestAnimationFrame(read)
            }
            read()
          })
      )
    const steady = (frames: Awaited<ReturnType<typeof sample>>) => {
      expect(frames.length).toBeGreaterThan(5)
      expect(frames.every((f) => f.outline === "solid")).toBe(true)
      expect(Math.min(...frames.map((f) => f.stroke))).toBeGreaterThan(
        0.8 + ring
      )
      expect(Math.max(...frames.map((f) => f.stroke))).toBeLessThan(1.2 + ring)
      expect(Math.max(...frames.map((f) => f.dim))).toBe(0)
      expect(frames.every((f) => f.opacity === 1)).toBe(true)
      expect(frames.every((f) => f.visible)).toBe(true)
      expect(Math.max(...frames.map((f) => f.gap))).toBeLessThan(1 + 2 * ring)
      expect(Math.max(...frames.map((f) => f.clipped))).toBeLessThan(0.1)
    }
    await page.keyboard.press("Alt+KeyO")
    const overview = page.getByRole("dialog", { name: "Overview" })
    await expect(overview).toBeFocused()
    steady(await sample(real))
    await expect(real).toHaveAttribute("data-focused", "false")
    await page.keyboard.press("ArrowRight")
    await expect(overview.locator("[aria-current][data-tile]")).toHaveAttribute(
      "data-tile",
      (await other.getAttribute("data-tile")) ?? ""
    )
    await page.keyboard.press("Enter")
    steady(await sample(other))
    await expect(other).toHaveAttribute("data-focused", "true")
    await expect(page.locator("[data-overview-state]")).toHaveCount(0)
  })
}

test("the overview zooms live workspaces, reverses halfway, and returns focus after closing", async () => {
  window = await startWindow({
    look: '[motion.overview]\neasing = { duration-ms = 600, curve = "linear" }\n',
  })
  const { page } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const id = await thread.getAttribute("data-tile")
  const real = page.locator(`section[data-tile="${id}"]`)
  const stack = page.locator(`[data-stack]:has(section[data-tile="${id}"])`)
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  await expect(launcher).toHaveAttribute("data-focused", "true")
  const other = await launcher.getAttribute("data-tile")
  const otherPane = page.locator(`section[data-tile="${other}"]`)
  await page.keyboard.press("Alt+Shift+Digit2")
  await page.keyboard.press("Alt+Digit1")
  const overview = page.getByRole("dialog", { name: "Overview" })
  const drawn = page.locator("[data-overview-state]")
  await page.keyboard.press("Alt+KeyO")
  await expect(overview).toBeFocused()
  await expect.poll(() => scaleOf(stack)).toBeLessThan(0.95)
  expect(await scaleOf(stack)).toBeGreaterThan(0.35)
  const before = (await stack.boundingBox())!.y
  await page.keyboard.press("ArrowDown")
  expect(Math.abs((await stack.boundingBox())!.y - before)).toBeLessThan(150)
  await page.keyboard.press("ArrowUp")

  // Closing and reopening before it lands keep the same live Panes.
  await page.keyboard.press("Alt+KeyO")
  await expect(drawn).toHaveAttribute("data-overview-state", "closing")
  await page.keyboard.press("Alt+KeyO")
  await expect(overview).toBeFocused()
  await expect.poll(() => scaleOf(stack)).toBeCloseTo(0.35, 3)
  const tile = overview.locator(`[data-tile="${id}"]`)
  await expect
    .poll(async () => {
      const [over, under] = await Promise.all([
        tile.boundingBox(),
        real.boundingBox(),
      ])
      return Math.max(
        Math.abs(over!.x - under!.x),
        Math.abs(over!.y - under!.y),
        Math.abs(over!.width - under!.width),
        Math.abs(over!.height - under!.height)
      )
    })
    .toBeLessThan(2)
  await page.screenshot({ path: "test-results/overview-polished-light.png" })

  // Picking another workspace grows that one back, while both remain inert.
  await overview.locator(`[data-tile="${other}"]`).click()
  await expect(drawn).toHaveAttribute("data-overview-state", "closing")
  expect(
    await otherPane.evaluate((element) => element.closest("[inert]") !== null)
  ).toBe(true)
  await expect(drawn).toHaveCount(0)
  await expect(launcher).toHaveAttribute("data-focused", "true")
  expect(
    await otherPane.evaluate((element) => element.closest("[inert]") !== null)
  ).toBe(false)
  await expect.poll(() => scaleOf(stack)).toBe(1)
})

test("overview frames stay aligned on resize, and reduced motion and motion off land immediately", async () => {
  window = await startWindow({ look: 'mode = "dark"\nradius = 0\n' })
  const { page, app, dir } = window
  const { thread, composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  const id = await thread.getAttribute("data-tile")
  const real = page.locator(`section[data-tile="${id}"]`)
  await composer.fill("hello overview")
  await composer.press("Enter")
  await expect(
    thread.getByText("Hello", { exact: false }).first()
  ).toBeVisible()
  await page.keyboard.press("Alt+KeyN")
  await page.emulateMedia({ reducedMotion: "reduce" })
  const stack = page.locator("[data-stack]").first()
  await page.keyboard.press("Alt+KeyO")
  const overview = page.getByRole("dialog", { name: "Overview" })
  await expect(overview).toBeFocused()
  expect(await scaleOf(stack)).toBeCloseTo(0.35, 3)
  const tile = overview.locator("[data-tile]").first()
  await expect(tile).toHaveCSS("border-top-left-radius", "0px")
  await page.screenshot({
    path: "test-results/overview-polished-dark-square.png",
  })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(720, 650)
  )
  await page.setViewportSize({ width: 720, height: 650 })
  await expect
    .poll(async () => {
      const [over, under] = await Promise.all([
        tile.boundingBox(),
        real.boundingBox(),
      ])
      return Math.abs(over!.x - under!.x) + Math.abs(over!.width - under!.width)
    })
    .toBeLessThan(2)
  await tile.hover()
  await expect(tile.getByRole("button", { name: /^Close / })).toHaveCSS(
    "opacity",
    "1"
  )
  await page.screenshot({ path: "test-results/overview-polished-narrow.png" })
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-overview-state]")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "New Pane" })).toHaveAttribute(
    "data-focused",
    "true"
  )

  await page.emulateMedia({ reducedMotion: "no-preference" })
  writeFileSync(
    join(dir, "config/look.toml"),
    'mode = "dark"\n[motion]\noff = true\n'
  )
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--tile-radius")
      )
    )
    .not.toBe("0px")
  await page.keyboard.press("Alt+KeyO")
  await expect(overview).toBeFocused()
  expect(await scaleOf(stack)).toBeCloseTo(0.35, 3)
  await page.screenshot({ path: "test-results/overview-polished-dark.png" })
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-overview-state]")).toHaveCount(0)
})

test("an underdamped overview spring never flips or enlarges the miniatures", async () => {
  window = await startWindow({
    look: "[motion.overview]\nspring = { damping-ratio = 0.1 }\n",
  })
  const { page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeFocused()
  await page.keyboard.press("Alt+KeyO")
  const scales = await page
    .locator("[data-stack]")
    .first()
    .evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const values: number[] = []
          const start = performance.now()
          const sample = () => {
            values.push(
              new DOMMatrixReadOnly(getComputedStyle(element).transform).a
            )
            if (performance.now() - start >= 500) resolve(values)
            else requestAnimationFrame(sample)
          }
          sample()
        })
    )
  expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.35)
  expect(Math.max(...scales)).toBeLessThanOrEqual(1)
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-overview-state]")).toHaveCount(0)
  await expect(composer).toBeFocused()
})
