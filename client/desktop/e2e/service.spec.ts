/**
 * The engine as the session's service (ADR 0086, decisions 1 and 3):
 * closing the window leaves it and its Agents running, a window opened
 * again attaches to it, and Quit Banda stops it. Banda Local's engine is
 * the window's child, as every other test has it; the first test asks for
 * the service with BANDA_ENGINE_AS. Where no systemd of the user's
 * answers, as in CI's containers, there is no service to start, and it
 * says so. The last is the page's side of macOS's Quit, which main runs
 * on every platform alike.
 */
import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window | undefined
let dir: string | undefined

test.afterEach(async () => {
  // Nothing of the test's stays: its window, its engine, its folder.
  await window?.app.close().catch(() => {})
  try {
    window?.banda("stop", "--force")
  } catch {
    // It stopped already.
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
  window = dir = undefined
})

/** What `banda status` says of the window's engine. */
const statusOf = (window: Window) =>
  JSON.parse(window.banda("status")) as {
    running: boolean
    pid?: number
    unit?: string
  }

test("closing the window leaves the engine and its Agent at work, and Quit Banda stops them (ADR 0086, decisions 1 and 3)", async () => {
  const systemd = spawnSync(
    "systemctl",
    ["--user", "show", "--property=Version", "--value"],
    { encoding: "utf8" }
  )
  test.skip(
    !systemd.stdout?.trim(),
    "no systemd of the user's here, as in CI's containers: the engine stays the window's child"
  )
  const env = { BANDA_ENGINE_AS: "service" }
  window = await startWindow({ env })
  dir = window.dir
  const { thread, composer } = await firstThread(window.page)
  await composer.fill("wait")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.", { exact: true })).toBeVisible()
  const started = statusOf(window)
  expect(started.running).toBe(true)
  expect(started.unit).toMatch(/^banda-local-engine-[0-9a-f]{8}$/)
  // The engine is the unit's, not the window's.
  expect(window.engine()).not.toBe(started.pid)

  // The Person closes the window: the window goes, the engine stays, and
  // the Agent goes on working.
  const closed = window.app.waitForEvent("close")
  await window.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((shown) => shown.close())
  )
  await closed
  expect(statusOf(window)).toMatchObject({ running: true, pid: started.pid })
  const projects = JSON.parse(window.banda("call", "projects.list")).ok
  const threads = JSON.parse(
    window.banda("call", "agents.threads", "--project", projects[0].id)
  ).ok.threads
  expect(threads[0].latest.state).toBe("running")

  // A window opened again attaches to it, and finds the Agent at work.
  window = await startWindow({ env, dir })
  const page = window.page
  await expect(page.getByText("Waiting.", { exact: true })).toBeVisible()
  expect(statusOf(window).pid).toBe(started.pid)

  // Quit Banda asks first, in the words Quit says everywhere, then stops
  // the engine and the window with it.
  const quitting = window.app.waitForEvent("close")
  await page.keyboard.press("Control+q")
  const ask = page.getByRole("dialog", {
    name: "An Agent works on this computer",
  })
  await expect(ask).toContainText("Quitting Banda stops it too.")
  await ask.getByRole("button", { name: "Quit anyway" }).click()
  await quitting
  await expect.poll(() => statusOf(window!).running).toBe(false)
})

test("main runs the page's Quit Banda, as macOS's Quit does while Agents work, and it asks first (ADR 0086, decision 3)", async () => {
  window = await startWindow()
  dir = window.dir
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("wait")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.", { exact: true })).toBeVisible()

  // As main does on macOS where `banda stop` refused (closing.ts): it runs
  // the action in the window, on the road it asks the page's actions by
  // (acts.ts). The page's answer names an ask main did not make, and is
  // dropped.
  const quit = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send("act.asked", {
        id: -1,
        action: "banda.quit",
      })
    )
  await quit()
  const ask = page.getByRole("dialog", {
    name: "An Agent works on this computer",
  })
  await expect(ask).toContainText("Quitting Banda stops it too.")
  // Cancel is the default: a stray Quit leaves the Agent working.
  await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused()
  await ask.getByRole("button", { name: "Cancel" }).click()
  await expect(ask).toBeHidden()
  expect(statusOf(window).running).toBe(true)

  await quit()
  const quitting = app.waitForEvent("close")
  await ask.getByRole("button", { name: "Quit anyway" }).click()
  await quitting
  await expect.poll(() => statusOf(window!).running).toBe(false)
})
