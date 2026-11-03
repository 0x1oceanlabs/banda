import { statSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, textOf, type Window } from "./window"

let window: Window

test.afterEach(async () => {
  await window?.close()
})

/** The Problems the engine keeps, as `banda problems` lists them. */
const problemsOf = (window: Window) =>
  window
    .banda("problems")
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          source: string
          message: string
          times: number
          frames: { file: string }[]
        }
    )

test("what breaks in the page and in main is kept as a Problem, and main's console in window.log (ADR 0039)", async () => {
  window = await startWindow()
  const { app, page, dir } = window
  await expect((await firstThread(page)).composer).toBeVisible()

  // Thrown in the page and not caught, twice: one Problem, counted twice.
  await page.evaluate(() => {
    for (let n = 0; n < 2; n++)
      setTimeout(() => {
        throw new TypeError("the page broke in a test")
      })
  })
  // A promise in main that nobody catches.
  await app.evaluate(() => {
    void Promise.reject(new RangeError("main broke in a test"))
  })
  await expect
    .poll(() =>
      problemsOf(window)
        .map((one) => `${one.source} ${one.message}`)
        .sort()
    )
    .toEqual(["main main broke in a test", "page the page broke in a test"])
  await expect
    .poll(() => problemsOf(window).find((one) => one.source === "page")?.times)
    .toBe(2)

  const log = join(dir, "state/logs/window.log")
  await expect.poll(() => textOf(log)).toContain("main broke in a test")
  expect(statSync(log).mode & 0o777).toBe(0o600)
  expect(statSync(join(dir, "state/logs/engine.log")).mode & 0o777).toBe(0o600)
})
