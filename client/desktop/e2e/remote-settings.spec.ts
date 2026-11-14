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
import { recordProblem, type Window } from "./window"

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
  return { page, project, folder }
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
  await expect(
    settings.getByRole("button", { name: /config\/sharing\.toml$/ })
  ).toBeVisible()
  // And under its rows, whose copy it is: arc's, where it is on arc
  // (#1736, point 4).
  const whose = settings.locator('[data-whose="sharing.toml"]')
  await expect(whose).toContainText("on arc")
  await expect(whose.locator(`[title="${theirs}"]`)).toHaveCount(1)

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
  const path = settings.getByRole("button", {
    name: /config\/sharing\.toml$/,
  })
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

test("General, Projects and Problems switch with Settings for: arc's engine, its Projects, changed on arc, and its Problems, looked into on arc (ADR 0124, SE1)", async () => {
  const { page, project, folder } = await onArc()
  recordProblem(arc!, "arc's watch broke")
  recordProblem(window!, "this machine's watch broke")
  const projectsOf = (on: Pick<Arc, "banda">) =>
    (
      JSON.parse(on.banda("call", "projects.list")) as {
        ok: { id: string; pinned: boolean; scratch: boolean }[]
      }
    ).ok
  const pinned = (on: Pick<Arc, "banda">) =>
    projectsOf(on)
      .filter((one) => one.pinned)
      .map((one) => one.id)
  const scratch = (on: Pick<Arc, "banda">) =>
    projectsOf(on).filter((one) => one.scratch).length

  // Projects: arc's, by arc's folder, and a pin lands on arc alone.
  const settings = await settingsAt(page, "Projects")
  const switchOf = settings.getByRole("radiogroup", { name: "Settings for" })
  const theirs = switchOf.getByRole("radio", { name: "arc" })
  const ours = switchOf.getByRole("radio", { name: /^This (Mac|machine)$/ })
  await expect(theirs).toHaveAttribute("aria-checked", "true")
  await expect(settings.getByTitle(folder, { exact: true })).toBeVisible()
  await settings.getByRole("switch", { name: "Pin Project" }).click()
  await expect.poll(() => pinned(arc!)).toEqual([project])
  expect(pinned(window!)).toEqual([])
  await shot(page, "settings-projects-for-arc")
  // This machine's, a click away: its own Projects, none of them arc's.
  await ours.click()
  await expect(settings.getByTitle(folder, { exact: true })).toHaveCount(0)
  await theirs.click()

  // Problems: arc's alone, with no logs folder to open from here, and a
  // Thread that looks into one starts on arc.
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: /Problems/ })
    .click()
  await expect(theirs).toHaveAttribute("aria-checked", "true")
  const broke = settings.getByRole("button", { name: /arc's watch broke/ })
  await expect(broke).toBeVisible()
  await expect(settings.getByText("this machine's watch broke")).toHaveCount(0)
  await broke.click()
  await expect(
    settings.getByRole("button", { name: "Copy report" })
  ).toBeVisible()
  await expect(
    settings.getByRole("button", { name: "Open logs folder" })
  ).toHaveCount(0)
  await shot(page, "settings-problems-for-arc")
  // No Project there is Banda's checkout, so it starts in arc's No
  // Project, whose first message makes its folder on arc.
  const before = scratch(window!)
  await settings.getByRole("button", { name: "Look into it" }).click()
  await expect(
    page
      .getByRole("region", { name: /^Look into Banda's Problem/ })
      .getByText(/^You said: Look into Banda's Problem/)
  ).toBeVisible()
  expect(scratch(arc!)).toBe(1)
  expect(scratch(window!)).toBe(before)
  // Its Thread takes the keys, and the Sheet goes (ADR 0102, decision 5).
  await expect(settings).toHaveCount(0)
  const kept = window!.banda("problems")
  expect(kept).toContain("this machine's watch broke")
  expect(kept).not.toContain("arc's watch broke")

  // General: arc's engine and fence, and this device's rows say whose
  // they are.
  const general = await settingsAt(page, "General")
  await expect(
    general
      .getByRole("radiogroup", { name: "Settings for" })
      .getByRole("radio", { name: "arc" })
  ).toHaveAttribute("aria-checked", "true")
  await expect(general.locator('[data-key="fence"]')).toBeVisible()
  await expect(general.getByText(/^Settings folder on this/)).toBeVisible()
  await shot(page, "settings-general-for-arc")
})
