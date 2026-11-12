/**
 * The update widget over every machine (ADR 0115, decision 7), as the
 * chosen mock's variant A draws it: this window's row, then each machine,
 * what each waits for, Restart now's warning, Settings → Machines' rows,
 * and the sidebar's other build opening it. What each engine says on
 * `updates.state` is answered here, on the page's own sockets: a
 * checkout's engine takes no update of its own. With `BANDA_E2E_SHOTS`,
 * pictures at 1440 and 728 wide, light and dark, the glass off.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, withArc } from "./arc"
import type { Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

const MINUTE = 60_000

/** What each engine says of its updates, by the machine's name. */
function states(now: number): Record<string, object> {
  return {
    // This machine moved onto the newest between turns.
    laptop: {
      running: "0.1.0-dev.642",
      newest: "0.1.0-dev.642",
      published: now - 20 * MINUTE,
      looked: now - 3 * MINUTE,
      updated: { from: "0.1.0-dev.640", at: now - 4 * MINUTE, idle: true },
      takes: "when-idle",
    },
    // arc has its copy in place, and two Threads and a terminal hold it.
    arc: {
      running: "0.1.0-dev.640",
      newest: "0.1.0-dev.642",
      published: now - 20 * MINUTE,
      looked: now - 3 * MINUTE,
      ready: "0.1.0-dev.642",
      waits: { turns: 2, terminals: 1, person: false },
      takes: "when-idle",
    },
  }
}

/** Answers `updates.state` on every engine socket of the page from
 * `states`, by the machine its engine names in its welcome; and keeps
 * each `updates.restart` asked, answering it. */
async function answerUpdates(page: Page, asked: object[]) {
  const said = states(Date.now())
  await page.routeWebSocket(/.*/, (socket) => {
    const engine = socket.connectToServer()
    let name: string | undefined
    engine.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        type: string
        named?: { name: string }
      }
      if (frame.type === "welcome") name = frame.named?.name
      socket.send(message)
    })
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        type: string
        id: number
        method?: string
        params?: object
      }
      const state = name !== undefined ? said[name] : undefined
      if (frame.type === "stream" && frame.method === "updates.state" && state)
        socket.send(
          JSON.stringify({ type: "piece", stream: frame.id, data: state })
        )
      else if (frame.method === "updates.restart") {
        asked.push({ machine: name, ...frame.params })
        socket.send(JSON.stringify({ type: "result", id: frame.id, ok: {} }))
      } else engine.send(message)
    })
  })
  await page.reload()
}

/** This window's app, as main tells it: dev.642 down, and its notes. */
const tellApp = (window: Window) =>
  window.app.evaluate(({ BrowserWindow, ipcMain }) => {
    const value = {
      name: "Banda Dev",
      have: "0.1.0-dev.640",
      always: true,
      state: "ready",
      version: "0.1.0-dev.642",
      notes: [
        {
          version: "0.1.0-dev.642",
          text: "feat(files): arc's Files open on arc",
        },
        {
          version: "0.1.0-dev.641",
          text: "feat(agents): a sub-agent's Question names who asks",
        },
        {
          version: "0.1.0-dev.641",
          text: "fix(ui): a refused act says its state without an ellipsis",
        },
        { version: "0.1.0-dev.641", text: "chore: the lockfile" },
      ],
    }
    ipcMain.removeHandler("update.current")
    ipcMain.handle("update.current", () => value)
    BrowserWindow.getAllWindows()[0]?.webContents.send("update.listen", value)
  })

/** Light or dark, the glass off, from now on. */
async function look(page: Page, dir: string, mode: "light" | "dark") {
  writeFileSync(
    join(dir, "config/look.toml"),
    `mode = "${mode}"\n[motion]\noff = true\n[desk]\nglass = false\n`
  )
  await expect(page.locator("html")).toHaveClass(
    mode === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
    { timeout: 10_000 }
  )
}

test("the update widget shows this window and every machine, warns before a restart under Agents, and Settings → Machines says the same", async () => {
  test.setTimeout(240_000)
  arc = newArc()
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "who.txt": "arc\n" })
  const project = JSON.parse(arc.banda("project", "add", folder)).ok
    .id as string
  // Two Agents work on arc, as Restart now's warning names them.
  arc.send(project, "Fix the mermaid diagram test, wait")
  arc.send(project, "Port the runner image to 26.04, wait")
  const dir = mkdtempSync(join(tmpdir(), "banda-window-"))
  window = await withArc(arc, {
    dir,
    files: {
      "config/machine.toml": 'name = "laptop"\nicon = "laptop"\n',
    },
  })
  const { page } = window
  const asked: object[] = []
  await answerUpdates(page, asked)
  await tellApp(window)

  // The bar: arc waits, worse than a window ready.
  const icon = page.locator("[data-update]")
  await expect(icon).toHaveAttribute("data-update", "waits", {
    timeout: 30_000,
  })
  await expect(icon).toHaveAccessibleName(/arc waits/)
  await icon.click()
  const popover = page.locator("[data-slot=popover-content]")
  await expect(popover).toContainText("Banda Dev dev.642")
  await expect(popover).toContainText("out 20m ago")
  await expect(popover.locator('[data-machine="window"]')).toContainText(
    "Restart window"
  )
  const here = popover.locator('[data-machine="here"]')
  await expect(here).toContainText("laptop")
  await expect(here).toContainText("Updated 4m ago, between turns.")
  const there = popover.locator('[data-machine="arc"]')
  await expect(there).toContainText(
    "Restarts once 2 Threads finish and its terminal closes."
  )
  await expect(popover).toContainText("Looked 3m ago")
  await expect(popover.getByRole("button", { name: "Check now" })).toBeVisible()
  await expect(popover).not.toContainText("Update all when idle")

  const shots = SHOTS ?? "test-results/updates"
  mkdirSync(shots, { recursive: true })
  const take = async (name: string) => {
    await page.mouse.move(5, 400)
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(shots, `${name}.png`) })
  }
  for (const width of [1440, 728]) {
    await page.setViewportSize({ width, height: 900 })
    for (const mode of ["dark", "light"] as const) {
      // Closed by the pointer, so the popover opens again with no focus
      // ring drawn.
      if (await popover.isVisible()) await page.mouse.click(400, 600)
      await look(page, dir, mode)
      await icon.click()
      await expect(there).toBeVisible()
      await take(`widget-${width}-${mode}`)
    }
  }

  // Restart now while Agents work there warns, in Quit's words, and
  // Cancel is where the keys are.
  await page.setViewportSize({ width: 1440, height: 900 })
  await there.getByRole("button", { name: "Restart now" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Restart Banda on arc now?")
  await expect(dialog).toContainText(
    "Agents work on arc. A restart stops their turns:"
  )
  await expect(dialog).toContainText("Fix the mermaid diagram test")
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  await take("restart-1440-light")
  await dialog.getByRole("button", { name: "Restart anyway" }).click()
  await expect.poll(() => asked).toEqual([{ machine: "arc", force: true }])
  await page.keyboard.press("Escape")

  // Settings → Machines: the same line, and the setting.
  await page.keyboard.press("Alt+Comma")
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Machines/ })
    .click()
  await settings.getByRole("button", { name: /^arc / }).click()
  const arcUpdates = settings.locator('[data-key="arc.updates"]')
  await expect(arcUpdates).toContainText(
    "dev.640 → dev.642. Restarts once 2 Threads finish and its terminal closes."
  )
  await expect(
    arcUpdates.getByRole("combobox", { name: "Restart for updates on arc" })
  ).toContainText("When idle")
  await arcUpdates.scrollIntoViewIfNeeded()
  // Only the machines' rows: the ssh config's names below are this
  // computer's own.
  const machines = settings.getByRole("group", { name: "Other machines" })
  for (const mode of ["light", "dark"] as const) {
    await look(page, dir, mode)
    await page.mouse.move(5, 400)
    await page.waitForTimeout(400)
    const box = (await machines.boundingBox())!
    const rows = (await arcUpdates.boundingBox())!
    await page.screenshot({
      path: join(shots, `settings-1440-${mode}.png`),
      clip: {
        x: box.x - 16,
        y: box.y - 16,
        width: box.width + 32,
        height: rows.y + rows.height - box.y + 120,
      },
    })
  }
})
