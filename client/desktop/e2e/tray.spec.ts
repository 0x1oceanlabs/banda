/**
 * Banda in the tray on Linux (ADR 0136, decision 2): where its icon is
 * and a tray host is known, closing the window hides it, and the app, its
 * engine and its Agents go on; where none is known it closes as before.
 * A window with no screen has no tray, so the tray here is a recorded
 * one (`BANDA_TRAY=recorded`, tray.ts): the tests pick its menu's items
 * and say whether a host is there.
 *
 * And what track 1 needs kept true (ADR 0124, decision 10): a window
 * hidden to the tray reads as not in front, its page `hidden`, or the
 * machine would think the Person looks and push no call to the phone.
 */
import { expect, type Page, test } from "@playwright/test"
import { firstThread, startWindow, type Window } from "./window"

let window: Window | undefined

test.afterEach(async () => {
  await window?.close().catch(() => {})
  window = undefined
})

const env = { BANDA_TRAY: "recorded" }

/**
 * Lets `page` read as it is, in front or not. Playwright tells Chromium
 * to emulate a focused page (`Emulation.setFocusEmulationEnabled`), under
 * which a hidden window's page stays `visible`; only the session that
 * asked can take it back, and Playwright has no option for it, so this
 * reaches that session inside Playwright. If Playwright moves it, this
 * says so, rather than the test passing on an emulated page.
 */
async function asItIs(page: Page): Promise<void> {
  type Inside = {
    _connection: {
      toImpl?: (page: Page) => {
        delegate?: {
          _mainFrameSession?: {
            _client?: { send(method: string, params: object): Promise<void> }
          }
        }
      }
    }
  }
  const session = (page as unknown as Inside)._connection.toImpl?.(page)
    ?.delegate?._mainFrameSession?._client
  if (!session)
    throw new Error(
      "Playwright's session of the page is not where it was: find it again, or a hidden page reads visible"
    )
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: false })
}

/** The recorded tray, in main. */
type Tray = {
  bandaTray: { host: boolean; does: { open(): void; quit(): void } }
}

/** What the system's dialog was asked, in main, answered `yes` or not. */
type Asked = { asked: string[]; yes: boolean }

test("closing the window hides it to the tray, its page hidden and its Agent at work; the door, a second Banda and Open Banda show it; Quit Banda asks first (ADR 0136, decision 2)", async () => {
  test.setTimeout(120_000)
  window = await startWindow({ env })
  const { app, page } = window
  const { thread, composer } = await firstThread(page)
  await composer.fill("wait")
  await composer.press("Enter")
  await expect(thread.getByText("Waiting.", { exact: true })).toBeVisible()

  const seen = () => page.evaluate(() => document.visibilityState)
  const shown = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((one) => one.isVisible())
    )
  const close = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.close()
    )
  const working = () => {
    const projects = JSON.parse(window!.banda("call", "projects.list")).ok
    const { threads } = JSON.parse(
      window!.banda("call", "agents.threads", "--project", projects[0].id)
    ).ok
    return threads[0].latest.state
  }
  await asItIs(page)
  expect(await seen()).toBe("visible")
  await page.evaluate(() => {
    const heard: string[] = []
    Object.assign(globalThis, { heard })
    document.addEventListener("visibilitychange", () =>
      heard.push(document.visibilityState)
    )
  })

  // The Person closes the window: it hides, and its page hears it is
  // hidden. The app lives, with its one window, its engine and its Agent.
  await close()
  await expect.poll(seen).toBe("hidden")
  expect(
    await page.evaluate(() => (globalThis as { heard?: string[] }).heard)
  ).toEqual(["hidden"])
  expect(await shown()).toEqual([false])
  expect(JSON.parse(window.banda("status")).running).toBe(true)
  expect(working()).toBe("running")

  // `banda menu` shows it again, and its page is in front.
  window.banda("menu", "actions")
  await expect.poll(seen).toBe("visible")
  expect(await shown()).toEqual([true])
  await page.keyboard.press("Escape")

  // So does Banda opened again.
  await close()
  await expect.poll(seen).toBe("hidden")
  await app.evaluate(({ app }) => void app.emit("second-instance"))
  await expect.poll(seen).toBe("visible")

  // Hidden, the tray's Quit Banda asks in the system's dialog while the
  // Agent works; Cancel keeps Banda, its engine and the Agent.
  await close()
  await expect.poll(seen).toBe("hidden")
  await app.evaluate(({ dialog }) => {
    const said: Asked = { asked: [], yes: false }
    Object.assign(globalThis, { said })
    dialog.showMessageBox = ((...args: unknown[]) => {
      const options = args.at(-1) as { message: string }
      said.asked.push(options.message)
      return Promise.resolve({
        response: said.yes ? 0 : 1,
        checkboxChecked: false,
      })
    }) as typeof dialog.showMessageBox
  })
  const quit = () =>
    app.evaluate(() => (globalThis as unknown as Tray).bandaTray.does.quit())
  await quit()
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as unknown as { said: Asked }).said.asked)
    )
    .toEqual(["An Agent works on this computer"])
  expect(await shown()).toEqual([false])
  expect(working()).toBe("running")

  // Open Banda shows it; shown, Quit Banda asks in the page, and Quit
  // anyway stops the engine and closes the window for real.
  await app.evaluate(() =>
    (globalThis as unknown as Tray).bandaTray.does.open()
  )
  await expect.poll(seen).toBe("visible")
  await quit()
  const ask = page.getByRole("dialog", {
    name: "An Agent works on this computer",
  })
  await expect(ask).toContainText("Quitting Banda stops it too.")
  const gone = app.waitForEvent("close")
  await ask.getByRole("button", { name: "Quit anyway" }).click()
  await gone
  await expect
    .poll(() => JSON.parse(window!.banda("status")).running)
    .toBe(false)
})

test("with no tray host known, closing the window closes it and the app quits, as before; and a quit by anything but the tray closes a hidden window at once", async () => {
  window = await startWindow({ env })
  const { app, page } = window
  const { composer } = await firstThread(page)
  await expect(composer).toBeVisible()
  await asItIs(page)
  // Hidden to the tray, a quit the system asks for goes through.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.close()
  )
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe("hidden")
  let gone = app.waitForEvent("close")
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await gone
  await window.close().catch(() => {})

  // The tray host went, as Waybar stopped: the window closes.
  window = await startWindow({ env })
  await expect((await firstThread(window.page)).composer).toBeVisible()
  gone = window.app.waitForEvent("close")
  await window.app
    .evaluate(({ BrowserWindow }) => {
      ;(globalThis as unknown as Tray).bandaTray.host = false
      BrowserWindow.getAllWindows()[0]?.close()
    })
    .catch(() => {})
  await gone
})
