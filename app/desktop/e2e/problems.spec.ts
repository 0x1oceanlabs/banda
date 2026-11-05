import { statSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import {
  clickNotice,
  desktopOf,
  firstThread,
  setInFront,
  startWindow,
  textOf,
  type Window,
} from "./window"

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
          fingerprint: string
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

/** A Problem as a part of Banda records it, through the CLI. */
const record = (window: Window, message: string, at = "banda_git::watch") =>
  window.banda(
    "call",
    "problems.record",
    "--params",
    JSON.stringify({
      source: "engine",
      kind: "panic",
      message,
      frames: [
        {
          file: "modules/git/engine/src/watch.rs",
          function: at,
          line: 40,
        },
      ],
    })
  )

test("a new Problem tells once, silently, and opens in Settings → Problems (ADR 0039)", async () => {
  window = await startWindow()
  const { app, page } = window
  await expect((await firstThread(page)).composer).toBeVisible()

  // In front: a toast, whose Details opens the Problem in Settings.
  record(window, "the watch broke")
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Something broke in Banda" })
  await expect(toast).toContainText("panic: the watch broke")
  await toast.getByRole("button", { name: "Details" }).click()
  await expect(toast).toBeHidden()
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await expect(
    settings.getByRole("heading", { name: "Problems" })
  ).toBeVisible()
  const row = settings.getByRole("button", { name: /panic the watch broke/ })
  await expect(row).toHaveAttribute("aria-expanded", "true")
  await expect(settings).toContainText(
    "modules/git/engine/src/watch.rs:40 in banda_git::watch"
  )
  // The same fault again only counts.
  record(window, "the watch broke")
  await expect(toast).toBeHidden()

  // Away: one system notification, no sound; a click opens it.
  await setInFront(page, false)
  record(window, "the index broke", "banda_git::index")
  await expect
    .poll(async () =>
      (await desktopOf(app)).shown.map((notice) => notice.title)
    )
    .toEqual(["Something broke in Banda"])
  const notice = (await desktopOf(app)).shown[0]!
  expect(notice.body).toBe("panic in the engine. Click to look into it.")
  await setInFront(page, true)
  await clickNotice(app, notice.key)
  await expect(
    settings.getByRole("button", { name: /panic the index broke/ })
  ).toHaveAttribute("aria-expanded", "true")
})

test("Look into it asks an Agent in a new Thread, in the Project of Banda's checkout (ADR 0039)", async () => {
  window = await startWindow()
  const { page } = window
  await expect((await firstThread(page)).composer).toBeVisible()
  // The engine runs from this checkout; a Project is it.
  const checkout = JSON.parse(
    window.banda(
      "call",
      "projects.add",
      "--params",
      JSON.stringify({
        folder: join(import.meta.dirname, "../../.."),
        create: false,
      })
    )
  ) as { ok: { id: string } }
  const asked = (fingerprint: string) =>
    window
      .banda("call", "agents.threads", "--project", checkout.ok.id)
      .includes(`Look into Banda's Problem ${fingerprint}`)

  // From the toast, and from Settings → Problems.
  record(window, "the watch broke")
  const toast = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Something broke in Banda" })
  await toast.getByRole("button", { name: "Look into it" }).click()
  await expect(toast).toBeHidden()
  const [watch] = problemsOf(window)
  await expect.poll(() => asked(watch!.fingerprint)).toBe(true)

  record(window, "the index broke", "banda_git::index")
  await toast.getByRole("button", { name: "Details" }).click()
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await settings.getByRole("button", { name: "Look into it" }).click()
  const index = problemsOf(window).find(
    (one) => one.message === "the index broke"
  )
  await expect.poll(() => asked(index!.fingerprint)).toBe(true)
})
