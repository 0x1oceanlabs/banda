/**
 * Settings for another machine (ADR 0106, decision 7, step 5b): opened from
 * arc's Thread, Settings shows arc's parts of its files, read and written
 * through arc's engine, its switch "Settings for" under the crumb (Roma's
 * pick A); this machine's files are left as they are. While arc is away,
 * its pill says so and a change is refused at once.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, shot, withArc } from "./arc"
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

const TITLE = "Bench the settings"

/** The window with arc's Thread open, its Message box in focus. */
async function onArc() {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "who.txt": "arc\n" })
  const project = JSON.parse(arc.banda("project", "add", folder)).ok
    .id as string
  arc.send(project, TITLE)
  await expect
    .poll(() => arc!.states(project).find(([one]) => one === TITLE)?.[1])
    .toBe("done")
  window = await withArc(arc)
  const { page } = window
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("group", { name: "arc", exact: true })
    .getByText(TITLE)
    .click()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  await thread.getByRole("textbox", { name: "Message to Fake AI" }).focus()
  return { page }
}

/** Alt+, and the Settings it opens, at section `name`. */
async function settingsAt(page: Page, name: string): Promise<Locator> {
  await page.keyboard.press("Alt+Comma")
  const settings = page.getByRole("region", { name: "Settings", exact: true })
  await expect(settings).toBeVisible()
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: new RegExp(name) })
    .click()
  return settings
}

const textOf = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf8") : ""

test("Settings opened from arc's Thread show arc's Sharing, written on arc, and this machine's stay as they are (ADR 0106, step 5b)", async () => {
  const { page } = await onArc()
  const settings = await settingsAt(page, "Sharing")
  const switchOf = settings.getByRole("radiogroup", { name: "Settings for" })
  await expect(switchOf.getByRole("radio", { name: "arc" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  const theirs = join(arc!.dir, "config/sharing.toml")
  const ours = join(window!.dir, "config/sharing.toml")
  const before = textOf(ours)
  // arc's file says where it is there, in place of Open file.
  await expect(settings.getByRole("button", { name: "Open file" })).toHaveCount(
    0
  )
  await expect(settings.getByText(/config\/sharing\.toml$/)).toBeVisible()

  const problems = settings.locator('[data-key="problems"]').getByRole("switch")
  await expect(problems).toHaveAttribute("aria-checked", "false")
  await problems.click()
  await expect.poll(() => textOf(theirs)).toMatch(/^problems = true$/m)
  await expect(problems).toHaveAttribute("aria-checked", "true")
  expect(textOf(ours)).toBe(before)
  await shot(page, "settings-for-arc")

  // This machine's, a click away: its own value, and its file to open.
  await switchOf.getByRole("radio", { name: /^This (Mac|machine)$/ }).click()
  await expect(problems).toHaveAttribute("aria-checked", "false")
  await expect(
    settings.getByRole("button", { name: "Open file" })
  ).toBeVisible()
})

test("arc's settings while arc is away: its pill says so, and a change is refused at once in its words", async () => {
  test.setTimeout(180_000)
  const { page } = await onArc()
  const settings = await settingsAt(page, "Sharing")
  const problems = settings.locator('[data-key="problems"]').getByRole("switch")
  await expect(problems).toHaveAttribute("aria-checked", "false")
  // arc's read came: its file's path, which stays as of then.
  const path = settings.getByText(/config\/sharing\.toml$/)
  await expect(path).toBeVisible()
  arc!.blackhole(true)
  await expect(
    settings.locator("[data-machine-pill=arc]").getByText("arc is away")
  ).toBeVisible({ timeout: 60_000 })
  await problems.click()
  await expect(
    settings.locator('[data-key="problems"]').getByRole("alert")
  ).toContainText("arc is away")
  expect(textOf(join(arc!.dir, "config/sharing.toml"))).toMatch(
    /^problems = false$/m
  )
  await expect(path).toBeVisible()
  await shot(page, "settings-for-arc-away")
})
