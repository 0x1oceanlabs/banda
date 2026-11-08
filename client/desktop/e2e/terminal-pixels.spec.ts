/**
 * A terminal's pixels, as it draws them frame by frame: what it printed
 * line by line, its scrollback and back, a selection, a resize, its canvas
 * lost and restored, and lines with diagonals, which draw past their rows
 * (ADR 0088, step P4). Its
 * renderer draws only the rows that changed and moves a scrolled screen's
 * pixels, so each state must hold the pixels a whole frame of it holds.
 *
 * In itself it checks what must come back as it was: the screen back from
 * its scrollback. Against another build it checks every state, pixel for
 * pixel: `BANDA_PIXELS_SAVE=<dir>` keeps each state's canvas, its
 * screenshot and what its scrollbar says there, and
 * `BANDA_PIXELS_AGAINST=<dir>` compares each with those another build
 * kept, main's say. The screenshot leaves the scrollbar's thumb out: where
 * it stops between screen pixels, the compositor draws its edge as the
 * moves before left it, run to run on the same build; what it says, and
 * so where it stands, is compared instead. At a scale of 1.6 the screen's
 * box starts between screen pixels and the compositor fits the canvas
 * into it, unalike run to run on one build too: there the screenshot is
 * kept for eyes, and the canvas alone is compared.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { newTerminal, read, startWindow, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

// Lines in every style a terminal draws, each its own, so the screen
// scrolls by one a frame or so: colours, bold, underlined, italic, struck,
// inverse, a background, ligatures, wide letters and emoji.
const PAINT = `i=0
while [ $i -lt 90 ]; do
  printf '\\033[1;32m%02d\\033[0m \\033[4munder\\033[0m \\033[3;35mitalic\\033[0m \\033[9mstruck\\033[0m \\033[1mbold\\033[0m \\033[7minv\\033[0m \\033[44mblue\\033[0m -> != 漢字 👍 é\\n' $i
  i=$((i+1))
  sleep 0.03
done
printf '\\033[48;5;22merased green\\033[K\\033[0m\\n'
printf 'box ┌─┬─┐ ⣿ ▀▄ \\033[38;2;255;128;0mtrue orange\\033[0m 👨‍👩‍👧 family\\n'
printf '\\033[53mover\\033[0m \\033[2mfaint\\033[0m \\033[8mhidden\\033[0m end\\n'
: > painted
`

// Diagonals stand past their rows: the renderer draws these as T3's did.
const DIAGONALS = `i=0
while [ $i -lt 12 ]; do
  printf '%02d ╱╲╳ \\033[33mdiagonal\\033[0m ╳╲╱\\n' $i
  i=$((i+1))
  sleep 0.03
done
: > drawn
`

const SAVE = process.env.BANDA_PIXELS_SAVE
const AGAINST = process.env.BANDA_PIXELS_AGAINST

/** How many pixels of two PNGs differ, as the page reads them. */
async function differing(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (url: string) => {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height)
        const context = canvas.getContext("2d")!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [left, right] = await Promise.all([pixels(a), pixels(b)])
      if (left.width !== right.width || left.height !== right.height)
        return Number.POSITIVE_INFINITY
      let count = 0
      for (let at = 0; at < left.data.length; at += 4) {
        if (
          left.data[at] !== right.data[at] ||
          left.data[at + 1] !== right.data[at + 1] ||
          left.data[at + 2] !== right.data[at + 2] ||
          left.data[at + 3] !== right.data[at + 3]
        )
          count += 1
      }
      return count
    },
    [a, b]
  )
}

const png = (buffer: Buffer) =>
  `data:image/png;base64,${buffer.toString("base64")}`

for (const scale of [1, 1.6, 2]) {
  test(`a terminal's pixels as it prints, scrolls, selects and resizes, at a scale of ${scale} (ADR 0088)`, async () => {
    window = await startWindow({ deviceScaleFactor: scale })
    const { app, page, dir } = window
    const project = join(dir, "root", "Work")
    const screen = await newTerminal(page)
    writeFileSync(join(project, "paint.sh"), PAINT)
    writeFileSync(join(project, "diagonals.sh"), DIAGONALS)
    const canvas = screen.locator("canvas").first()
    const input = page.getByRole("textbox", { name: "Terminal input" })
    const away = () => page.mouse.move(1, 1)

    /** Runs `command` and waits for the file it makes last, with the focus
     * off the screen: its cursor a still frame, never a blinking block. */
    const run = async (command: string, made: string) => {
      await input.focus()
      await page.keyboard.type(command)
      await page.keyboard.press("Enter")
      await input.evaluate((element) => (element as HTMLElement).blur())
      await expect.poll(() => read(join(project, made))).toBe("")
    }

    const scrollbar = screen.getByRole("scrollbar")
    if (SAVE) mkdirSync(SAVE, { recursive: true })
    const shots: Record<string, { canvas: string; screen: string }> = {}
    const failed: string[] = []
    /** The canvas once it stops changing. */
    const settled = async () => {
      const pixels = () =>
        canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
      let last = ""
      await expect
        .poll(
          async () => {
            const now = await pixels()
            const same = now === last
            last = now
            return same
          },
          { intervals: [300] }
        )
        .toBe(true)
      return last
    }
    /** The canvas once it stops changing, and the screen's screenshot,
     * scrollbar too; kept and compared as asked. */
    const state = async (name: string) => {
      const shot = {
        canvas: await settled(),
        screen: png(await screen.screenshot({ mask: [scrollbar] })),
      }
      shots[name] = shot
      const file = (where: string, kind: string) =>
        join(where, `scale-${scale}-${name}-${kind}.png`)
      // What the scrollbar says, and its thumb's size and place.
      const says = await scrollbar.evaluate((element) =>
        JSON.stringify({
          hidden: (element as HTMLElement).hidden,
          now: element.getAttribute("aria-valuenow"),
          max: element.getAttribute("aria-valuemax"),
          height: (element.firstElementChild as HTMLElement).style.height,
          at: (element.firstElementChild as HTMLElement).style.transform,
        })
      )
      const saying = (where: string) =>
        join(where, `scale-${scale}-${name}-scrollbar.json`)
      if (SAVE) writeFileSync(saying(SAVE), says)
      if (AGAINST && readFileSync(saying(AGAINST), "utf8") !== says)
        failed.push(`${name} scrollbar: ${says}`)
      for (const kind of ["canvas", "screen"] as const) {
        if (SAVE) {
          const data = shot[kind].slice(shot[kind].indexOf(",") + 1)
          writeFileSync(file(SAVE, kind), Buffer.from(data, "base64"))
        }
        if (AGAINST && (kind === "canvas" || Number.isInteger(scale))) {
          const other = png(readFileSync(file(AGAINST, kind)))
          const count = await differing(page, shot[kind], other)
          if (count !== 0) failed.push(`${name} ${kind}: ${count} pixels`)
        }
      }
    }

    // Printed line by line, so most frames scroll the screen by a row.
    await away()
    await run("sh paint.sh", "painted")
    await state("printed")

    // Back through the scrollback, and down to the screen again.
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -400)
    await away()
    await state("scrollback")
    expect(shots.scrollback!.canvas).not.toBe(shots.printed!.canvas)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 200)
    await away()
    await state("scrolling down")
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 4000)
    await away()
    await state("back")
    expect(shots.back!.canvas, "back from the scrollback").toBe(
      shots.printed!.canvas
    )

    // A selection over three rows and a half.
    await page.mouse.move(box.x + 40, box.y + box.height / 3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 8,
    })
    await page.mouse.up()
    await input.evaluate((element) => (element as HTMLElement).blur())
    await away()
    await state("selected")

    // A narrower, shorter window: the screen takes its new size.
    if (scale === 1) await page.setViewportSize({ width: 1100, height: 700 })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1100, 700)
    )
    await expect
      .poll(async () => (await canvas.boundingBox())!.width)
      .toBeLessThan(box.width)
    await state("resized")

    // A canvas whose context was lost, after a GPU reset say, comes back
    // empty and with its state reset: the screen draws again in full.
    // Main's renderer never heard of it, so this build alone checks it.
    await canvas.evaluate((element) => {
      const lost = element as HTMLCanvasElement
      lost.getContext("2d")!.reset()
      lost.dispatchEvent(new Event("contextrestored"))
    })
    expect(await settled(), "restored").toBe(shots.resized!.canvas)

    // Diagonals, drawn past their rows, scroll the screen too.
    await run("sh diagonals.sh", "drawn")
    await state("diagonals")

    expect(failed, `against ${AGAINST}`).toEqual([])
  })
}
