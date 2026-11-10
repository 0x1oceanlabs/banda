/**
 * Another machine's Panes run on its engine, and this device only draws
 * them (ADR 0106), slice by slice, on arc.ts's arc, 40 ms away a round
 * trip. Step 1a: New Pane on arc's Project lists what opens there and
 * shows the rest dimmed, "Not on arc yet" (decision 2); an act goes where
 * its values live, by one router, from a key, a menu or a Pane alike, and
 * one arc does not run says so in a toast, never a click that does
 * nothing (law 3). Step 1a″: a Pane goes to its Project's machine by the
 * directory this device keeps, never by a host its arrangement keeps, so
 * one restored while arc is away says so, and none goes to this machine
 * in arc's place (decision 1). The same-path job runs this spec with arc
 * in a mount namespace of its own (ci.yml's `same-path`): the `new-pane`
 * and `restore` roads. With BANDA_E2E_SHOTS set to a folder, it leaves
 * pictures of what it checks.
 */
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { headerShows, type Window } from "./window"

let window: Window | undefined
let arc: Arc | undefined
let stopArc: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await window?.close()
  await stopArc?.()
  arc?.close()
  window = arc = stopArc = undefined
})

/** The title of arc's Thread in its Project "banda". */
const TITLE = "Bench remote Panes"

/** arc's part of the sidebar: its label and what it holds. */
const arcOf = (page: Page) =>
  page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("group", { name: "arc", exact: true })

/** arc's Threads in `project`, each its title and whether it is archived,
 * as arc's engine lists them. */
function archivedOn(on: Pick<Arc, "banda">, project: string) {
  const { ok } = JSON.parse(
    on.banda("call", "agents.threads", "--project", project)
  ) as { ok: { threads: { title: string; archived?: object }[] } }
  return ok.threads.map(({ title, archived }) => [
    title,
    archived !== undefined,
  ])
}

/**
 * arc's Project "banda", with a Thread done for each of `titles`, open in
 * the window from arc's part of the sidebar: the first. arc's engine runs
 * apart from the window's ssh, so a link that goes leaves it working.
 */
async function onArc(titles = [TITLE]) {
  arc = newArc({ latency: 40 })
  stopArc = await arc.start()
  const folder = join(arc.code.arc, "banda")
  put(arc.disk(folder), { "README.md": "arc\n" })
  const project = JSON.parse(arc.banda("project", "add", folder)).ok
    .id as string
  for (const title of titles) {
    arc.send(project, title)
    await expect
      .poll(() => arc!.states(project).find(([one]) => one === title)?.[1])
      .toBe("done")
  }
  window = await withArc(arc)
  const { page } = window
  await arcOf(page).getByText(titles[0]!).click()
  const thread = page.getByRole("region", { name: titles[0], exact: true })
  await expect(thread.getByText(`You said: ${titles[0]}`)).toBeVisible()
  const composer = thread.getByRole("textbox", { name: "Message to Fake AI" })
  return { page, thread, composer, project }
}

test("New Pane on arc's Project lists what opens on arc and dims the rest, not on arc yet; its top says where; while arc is away nothing is picked", async () => {
  // ssh gives up on a silent link in about 20 s, and comes back after its
  // waits.
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  const { page, composer } = await onArc()
  await composer.focus()
  await page.keyboard.press("Alt+KeyN")
  const launcher = page.getByRole("region", { name: "New Pane" })
  // Its top says where what it opens opens: in banda on arc.
  const top = launcher.locator("header").first()
  expect(await headerShows(launcher)).toEqual([
    "",
    "New Pane",
    "project",
    "machine",
    "buttons",
  ])
  await expect(top).toHaveText(/^New Pane\s*in\s*\S*\s*banda\s*on\s*arc/)
  await expect(top.locator("[data-machine-icon]")).toHaveAttribute(
    "data-machine-icon",
    "server"
  )
  // What opens on arc is live; the rest stays in view, dimmed, with why.
  const button = (name: string) => launcher.getByRole("button", { name })
  await expect(button("Thread")).toBeEnabled()
  for (const name of ["Terminal", "Files", "Diff", "Browser"])
    await expect(button(name), name).toBeDisabled()
  await expect(
    launcher.getByText("Not on arc yet", { exact: true })
  ).toBeVisible()
  await shot(page, "new-pane-arc")
  // A dimmed one's letter opens nothing.
  await launcher.press("KeyT")
  await expect(launcher).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Terminal screen" })
  ).toHaveCount(0)

  // arc away: the Frame's pill says so, and nothing is picked, its letters
  // neither.
  arc!.blackhole(true)
  const away = launcher.getByRole("status").filter({ hasText: "arc is away" })
  await expect(away).toBeVisible({ timeout: 60_000 })
  await expect(button("Thread")).toBeDisabled()
  await launcher.press("KeyH")
  await expect(launcher).toBeVisible()
  await shot(page, "new-pane-arc-away")

  // Back, a Thread picked there is a new Thread on arc.
  arc!.blackhole(false)
  await expect(away).toHaveCount(0, { timeout: 90_000 })
  await button("Thread").click()
  await expect(launcher).toHaveCount(0)
  await expect(
    page.getByRole("textbox", { name: "Message to Fake AI" }).last()
  ).toHaveAttribute("aria-placeholder", /^Write to Fake AI on arc\./)
})

test("an act arc does not run says so from the Banda menu and by its key alike, on arc's Project, and nothing opens", async () => {
  const { page, composer } = await onArc()
  const toasts = page
    .getByRole("region", { name: "Notifications" })
    .getByRole("listitem")
  const tiles = page.locator("section[data-tile]")
  const shown = await tiles.count()
  // The Banda menu's page, in arc's Project: arc's Panes open no browser
  // yet.
  await composer.focus()
  await page.keyboard.press("Alt+Space")
  const menu = page.getByRole("dialog", { name: "Banda menu" })
  await menu.getByRole("combobox", { name: "Search" }).fill("example.com")
  await menu.getByRole("option", { name: "Open example.com" }).click()
  await expect(
    toasts.filter({ hasText: "Not on arc yet: Open in a browser" })
  ).toBeVisible()
  await shot(page, "not-on-arc-toast", { toasts: true })
  // Alt+Shift+Enter, which opens a browser here, the same.
  await composer.focus()
  await page.keyboard.press("Alt+Shift+Enter")
  await expect(
    toasts.filter({ hasText: "Not on arc yet: New browser" })
  ).toBeVisible()
  await expect(tiles).toHaveCount(shown)
})

test("arc's Thread is archived on arc's engine from a key and from its Pane's menu alike, never on this machine's", async () => {
  const second = "Second on arc"
  const { page, composer, project } = await onArc([TITLE, second])
  // Alt+S, from its Message box.
  await composer.focus()
  await page.keyboard.press("Alt+S")
  await expect(
    page.getByRole("region", { name: TITLE, exact: true })
  ).toBeHidden()
  await expect
    .poll(() => archivedOn(arc!, project))
    .toEqual(
      expect.arrayContaining([
        [TITLE, true],
        [second, false],
      ])
    )
  // The other, from its header's menu.
  await arcOf(page).getByText(second).click()
  const other = page.getByRole("region", { name: second, exact: true })
  await expect(other.getByText(`You said: ${second}`)).toBeVisible()
  await other
    .locator("header")
    .getByRole("button", { name: second, exact: true })
    .click()
  await page.getByRole("menuitem", { name: /Archive thread/ }).click()
  await expect(other).toBeHidden()
  await expect
    .poll(() => archivedOn(arc!, project))
    .toEqual(
      expect.arrayContaining([
        [TITLE, true],
        [second, true],
      ])
    )
  // This machine's engine was sent none of it.
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByText("There is no such Thread.")
  ).toHaveCount(0)
})

test("arc's Thread restored as the window starts again with arc away from the first moment says arc is away, by the directory alone: the arrangement names no machine", async () => {
  // ssh gives up on a silent link in about 20 s, and comes back after its
  // waits.
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  await onArc()
  // The engine keeps the window's arrangement with no host in a Pane's
  // args: which machine has the Project is this device's to keep.
  expect(window!.banda("call", "workspaces.list")).not.toContain('"host"')

  // arc in a black hole as the window starts again on what it left: it is
  // never reached in this window's life.
  const { dir } = window!
  await window!.app.close()
  arc!.blackhole(true)
  window = await withArc(arc!, { dir })
  const { page } = window
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  const pill = thread.locator("[data-machine-pill] [role=status]")
  await expect(pill).toHaveText("arc is away", { timeout: 60_000 })
  // Its header and its Message box name arc, and Send waits for it.
  await expect(thread.locator("header").first()).toContainText("arc")
  await expect(
    thread.getByRole("textbox", { name: /^Message to / })
  ).toHaveAttribute("aria-placeholder", /^Write to .+ on arc\./)
  await expect(
    thread.getByRole("button", { name: "Send", exact: true })
  ).toHaveAttribute("title", "arc is away. Send once it is back.")
  // Never this machine's in arc's place, nor a Project no machine has.
  await expect(
    page.getByText("This window does not reach that machine")
  ).toHaveCount(0)
  await expect(page.getByText("There is no such Thread.")).toHaveCount(0)
  await shot(page, "restored-away")

  // Back, the same Pane shows arc's Thread.
  arc!.blackhole(false)
  await expect(pill).toHaveCount(0, { timeout: 90_000 })
  await expect(thread.getByText(`You said: ${TITLE}`)).toBeVisible()
})
