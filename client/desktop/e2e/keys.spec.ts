/**
 * How soon a tiling key is drawn (ADR 0088, decision 11; the plan's
 * §8.11): on the Strip motion.spec.ts measures, three terminals and a
 * browser Pane, each kind of tiling key is pressed, with the engine near
 * and with every word it says 150 ms late, as a host far away
 * (`startWindow({ latency })`).
 *
 * For each key the probe takes the time from the key to the Tiling's
 * commit of what it changed, and the frames that began meanwhile
 * (motion-probe.ts): a key committed before the next frame begins is
 * drawn in it. It counts React's drawings of the Tiles and the widgets
 * for each key too, as motion.spec.ts does, so a reconcile that draws
 * again shows. Once each phase is over, the Strips drawn are the
 * engine's arrangement: no prediction is left behind.
 *
 * The numbers go to test-results/keys.json and keys.md.
 */
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { install, read, reset, type Reading } from "./motion-probe"
import { keysOf } from "./motion-report"
import {
  firstThread,
  layoutOf,
  newTerminal,
  startWindow,
  type Window,
} from "./window"

let window: Window
let site: Server | undefined

test.afterEach(async () => {
  await window?.close()
  site?.close()
})

/** A column as the engine keeps it, of what this spec compares. */
type Kept = {
  id: string
  panes: { id: string }[]
  width?: string
  full?: boolean
}

/** Every workspace, as the engine's `workspaces.list` answers, through the
 * Person's `banda call`. */
function arrangedOf(window: Window): { id: string; columns: Kept[] }[] {
  return JSON.parse(window.banda("call", "workspaces.list")).ok.workspaces
}

/** A width's share in hundredths, as `share` in model.ts reads it. */
function hundredths(width: string): number {
  const [top, bottom = "1"] = width.split("/")
  return Math.round((Number(top) / Number(bottom)) * 100)
}

/**
 * Where the Strips drawn differ from the engine's arrangement: each
 * workspace by its ID, each column by its ID and its Tiles, top down,
 * and its share of the Strip where the engine gives it one. None once
 * the window draws what the engine keeps.
 */
async function apart(page: Page, window: Window): Promise<string[]> {
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-stack]")].map(
      (stack) => ({
        id: stack.dataset.stack!,
        shown: stack.getAttribute("aria-hidden") !== "true",
        columns: [
          ...stack.querySelectorAll<HTMLElement>(
            "[data-strip] > [data-column]"
          ),
        ].map((column) => {
          const strip = column.parentElement!
          const style = getComputedStyle(strip)
          const gap = parseFloat(style.columnGap) || 0
          const room =
            strip.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) +
            gap
          return {
            id: column.dataset.column!,
            panes: [
              ...column.querySelectorAll<HTMLElement>(":scope > [data-tile]"),
            ].map((tile) => tile.dataset.tile!),
            share: Math.round(((column.offsetWidth + gap) / room) * 100),
          }
        }),
      })
    )
  )
  const kept = arrangedOf(window)
  const found: string[] = []
  const ids = (list: { id: string }[]) => list.map((one) => one.id).join(" ")
  if (ids(drawn) !== ids(kept)) found.push(`workspaces ${ids(drawn)}`)
  for (const [w, workspace] of kept.entries()) {
    const columns = drawn[w]?.columns ?? []
    if (ids(columns) !== ids(workspace.columns))
      found.push(`workspace ${w + 1}: columns ${ids(columns)}`)
    for (const [c, column] of workspace.columns.entries()) {
      const there = columns[c]
      if (!there || there.id !== column.id) continue
      if (there.panes.join(" ") !== ids(column.panes))
        found.push(`column ${column.id}: Tiles ${there.panes.join(" ")}`)
      const share = column.full
        ? 100
        : column.width !== undefined
          ? hundredths(column.width)
          : undefined
      // Only the workspace on screen is laid out to be read.
      const shown = drawn[w]?.shown
      if (share !== undefined && shown && Math.abs(there.share - share) > 1)
        found.push(`column ${column.id}: ${there.share}, kept ${share}`)
    }
  }
  return found
}

/** A Strip of three terminals and a browser Pane on a page of `address`,
 * as motion.spec.ts has; the last terminal has the focus. */
async function strip(page: Page, address: string) {
  await newTerminal(page)
  const open = async (kind: string) => {
    await page.keyboard.press("Alt+KeyN")
    await page
      .getByRole("region", { name: "New Pane" })
      .getByRole("button", { name: kind })
      .click()
  }
  const screens = page.getByRole("region", { name: "Terminal screen" })
  for (let i = 0; i < 2; i++) {
    await open("Terminal")
    await expect(screens).toHaveCount(i + 2)
  }
  await open("Browser")
  const bar = page.getByRole("textbox", { name: "Address" })
  await bar.fill(address)
  await bar.press("Enter")
  await expect(page.locator("[data-held-by]")).toHaveCount(1)
  await screens.nth(2).click()
  // Nothing has the keyboard but the window: no cursor blinks.
  await page.waitForTimeout(500)
}

/** A phase's keys, pressed one at a time as a Person does: each lands on
 * a window at rest. */
const PHASES: Record<string, string[]> = {
  width: [
    "Control+Alt+ArrowLeft",
    "Control+Alt+ArrowRight",
    "Control+Alt+ArrowRight",
    "Control+Alt+ArrowLeft",
    "Control+Alt+ArrowLeft",
    "Control+Alt+ArrowRight",
  ],
  maximize: ["Alt+KeyF", "Alt+KeyF", "Alt+KeyF", "Alt+KeyF"],
  // Along the terminals, never to the browser's page, which takes the
  // keys from there.
  focus: [
    "Alt+ArrowLeft",
    "Alt+ArrowLeft",
    "Alt+ArrowRight",
    "Alt+ArrowRight",
    "Alt+ArrowLeft",
    "Alt+ArrowRight",
  ],
  workspace: ["Alt+PageDown", "Alt+PageUp", "Alt+PageDown", "Alt+PageUp"],
  move: [
    "Alt+Shift+ArrowLeft",
    "Alt+Shift+ArrowRight",
    "Alt+Shift+ArrowLeft",
    "Alt+Shift+ArrowRight",
  ],
  // A New Pane opened, then closed: open and close, each three times.
  "open and close": [
    "Alt+KeyN",
    "Alt+KeyW",
    "Alt+KeyN",
    "Alt+KeyW",
    "Alt+KeyN",
    "Alt+KeyW",
  ],
}

/** What a phase measured: each key, React's drawings and the steps. */
type Measured = {
  keys: Reading["keys"]
  renders: Reading["renders"]
  steps: number
}

/** The numbers each phase's keys came to, by phase, `open and close` split
 * by its keys. */
function numbersOf(measured: Record<string, Measured>) {
  const numbers: Record<string, unknown> = {}
  for (const [name, { keys, renders, steps }] of Object.entries(measured)) {
    const perStep = (count: number) => Math.round((count / steps) * 100) / 100
    const drawings = {
      tiles: perStep(renders.tiles),
      widgets: perStep(renders.widgets),
    }
    if (name === "open and close") {
      numbers.open = { keys: keysOf(keys.filter((k) => k.code === "KeyN")) }
      numbers.close = { keys: keysOf(keys.filter((k) => k.code === "KeyW")) }
    } else numbers[name] = { keys: keysOf(keys), renders: drawings }
  }
  return numbers
}

/** Keeps `numbers` in test-results/keys.json under `latency`, and the
 * whole as a table in keys.md. */
function report(latency: number, numbers: Record<string, unknown>) {
  const out = test.info().project.outputDir
  const json = join(out, "keys.json")
  const all: Record<string, Record<string, unknown>> = existsSync(json)
    ? JSON.parse(readFileSync(json, "utf8"))
    : {}
  all[String(latency)] = numbers
  writeFileSync(json, `${JSON.stringify(all, null, 2)}\n`)
  type Row = {
    keys: ReturnType<typeof keysOf>
    renders?: { tiles: number; widgets: number }
  }
  const lines = Object.entries(all).flatMap(([ms, phases]) =>
    Object.entries(phases as Record<string, Row>).map(
      ([phase, { keys, renders }]) =>
        `| ${ms} | ${phase} | ${keys?.count ?? "–"} | ${keys?.missed ?? "–"} | ${keys?.p50 ?? "–"} · ${keys?.p95 ?? "–"} | ${keys?.framesLate.p95 ?? "–"} | ${renders?.tiles ?? "–"} | ${renders?.widgets ?? "–"} |`
    )
  )
  const text = [
    "## Key to drawn",
    "",
    "From each key to the Tiling's commit of what it changed, in ms, and the frames that began meanwhile; React's drawings of the Tiles and widgets for each key.",
    "",
    "| Engine late ms | Phase | Keys | Missed | ms p50 · p95 | Frames late p95 | Tiles a key | Widgets a key |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...lines,
    "",
  ].join("\n")
  writeFileSync(join(out, "keys.md"), text)
  console.log(text)
}

for (const latency of [0, 150]) {
  test.describe(`with the engine ${latency} ms away`, () => {
    test("each tiling key is drawn, and what is drawn is the engine's", async () => {
      test.setTimeout(180_000)
      site = createServer((_, response) => {
        response.writeHead(200, { "content-type": "text/html" })
        response.end("<title>Page</title><h1>Page</h1>")
      })
      await new Promise<void>((done) => site!.listen(0, "127.0.0.1", done))
      const address = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`
      window = await startWindow({ latency })
      const { page } = window
      await strip(page, address)
      await page.evaluate(install)

      const measured: Record<string, Measured> = {}
      for (const [name, keys] of Object.entries(PHASES)) {
        await page.evaluate(reset, false)
        for (const key of keys) {
          await page.keyboard.press(key)
          await page.waitForTimeout(700)
        }
        const counted = await page.evaluate(read)
        measured[name] = {
          keys: counted.keys,
          renders: counted.renders,
          steps: keys.length,
        }
        // No prediction is left behind.
        await expect
          .poll(() => apart(page, window), { message: `after ${name}` })
          .toEqual([])
      }
      const numbers = numbersOf(measured)
      report(latency, numbers)

      // Each key drew again the two Tiles the focus moved between and no
      // other, the one in focus as its workspace left or came back, none
      // for a width, and no widget (ADR 0088, decision 7): a reconcile
      // draws nothing again.
      const each = (phase: string) => measured[phase].renders
      const steps = (phase: string) => measured[phase].steps
      expect(each("focus").tiles, "focus: Tiles drawn").toBe(2 * steps("focus"))
      expect(each("focus").widgets, "focus: widgets drawn").toBe(0)
      expect(each("width").tiles, "width: Tiles drawn").toBe(0)
      expect(each("maximize").tiles, "maximize: Tiles drawn").toBe(0)
      expect(each("workspace").tiles, "workspace: Tiles drawn").toBe(
        steps("workspace")
      )
    })

    test("ten tiling keys pressed faster than the Window draws land in order, as the engine has them", async () => {
      window = await startWindow({ latency })
      const { page } = window
      const { composer: box } = await firstThread(page)
      await expect(box).toBeFocused()
      const launchers = page.getByRole("region", { name: "New Pane" })
      for (let n = 1; n <= 3; n++) {
        await page.keyboard.press("Alt+KeyN")
        await expect(launchers).toHaveCount(n)
        await expect(launchers.nth(n - 1)).toHaveAttribute(
          "data-focused",
          "true"
        )
      }
      const [[thread], [one], [two], [three]] = await layoutOf(page)
      // roma-day.spec.ts's ten, in one task of the page.
      const keys = [
        "Alt+KeyN",
        "Alt+Shift+Home",
        "Alt+ArrowRight",
        "Alt+Shift+End",
        "Alt+Home",
        "Alt+KeyW",
        "Alt+Shift+ArrowRight",
        "Alt+Shift+ArrowRight",
        "Alt+ArrowLeft",
        "Alt+Shift+Home",
      ].map((press) => {
        const mods = press.split("+")
        const code = mods.pop()!
        return {
          code,
          key: code.startsWith("Key") ? code.slice(3).toLowerCase() : code,
          altKey: mods.includes("Alt"),
          shiftKey: mods.includes("Shift"),
        }
      })
      await page.evaluate((keys) => {
        const target = document.activeElement ?? document.body
        for (const key of keys)
          for (const type of ["keydown", "keyup"])
            target.dispatchEvent(
              new KeyboardEvent(type, {
                ...key,
                bubbles: true,
                cancelable: true,
              })
            )
      }, keys)
      await expect
        .poll(() => layoutOf(page))
        .toEqual([[three], [two], [one], [thread]])
      await expect(page.locator(`[data-tile="${three}"]`)).toHaveAttribute(
        "data-focused",
        "true"
      )
      await expect.poll(() => apart(page, window)).toEqual([])
    })
  })
}
