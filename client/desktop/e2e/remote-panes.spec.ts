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
 * and `restore` roads, and step 5a's `start-account`: a new Thread on arc
 * starts on arc's account. With BANDA_E2E_SHOTS set to a folder, it leaves
 * pictures of what it checks.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { type Arc, newArc, put, SHOTS, shot, withArc } from "./arc"
import { bandaMenu, headerShows, type Window } from "./window"

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
 * `before` readies arc's files before its engine starts.
 */
async function onArc(titles = [TITLE], before?: (arc: Arc) => void) {
  arc = newArc({ latency: 40 })
  before?.(arc)
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
  for (const name of ["Thread", "Terminal", "Files"])
    await expect(button(name), name).toBeEnabled()
  for (const name of ["Browser"])
    await expect(button(name), name).toBeDisabled()
  await expect(
    launcher.getByText("Not on arc yet", { exact: true })
  ).toBeVisible()
  await shot(page, "new-pane-arc")
  // A dimmed one's letter opens nothing.
  await launcher.press("KeyB")
  await expect(launcher).toBeVisible()
  await expect(page.getByRole("region", { name: "Browser" })).toHaveCount(0)

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
  await bandaMenu(page)
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

/** The window quit and started again on what it left, its storage too,
 * a start that went well, as the test says (ADR 0039); arc is left as it
 * is, so one held now is never reached in the new window's life. */
async function again(): Promise<Page> {
  const { dir, page } = window!
  await page.evaluate(() => localStorage.removeItem("banda.starts"))
  await window!.app.close()
  window = await withArc(arc!, { dir })
  return window.page
}

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
  arc!.blackhole(true)
  const page = await again()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  const pill = thread.locator("[data-machine-pill] [role=status]")
  await expect(pill).toHaveText("arc is away", { timeout: 60_000 })
  // Its header and its Message box name arc, and what is sent waits for
  // arc, by the host's name as the directory keeps it (ADR 0105).
  await expect(thread.locator("header").first()).toContainText("arc")
  await expect(
    thread.getByRole("textbox", { name: /^Message to / })
  ).toHaveAttribute("aria-placeholder", /^Write to .+ on arc\./)
  await expect(
    thread.getByRole("button", { name: "Send when back" })
  ).toHaveAttribute("title", /^Sends once arc is back, until /)
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

test("what waits for arc still shows after a restart with arc held from the first moment, by the directory alone, and goes to arc once it is back (H5e-2)", async () => {
  test.setTimeout(SHOTS ? 300_000 : 180_000)
  await onArc()
  expect(window!.banda("call", "workspaces.list")).not.toContain('"host"')
  arc!.blackhole(true)
  const held = window!.page.getByRole("region", { name: TITLE, exact: true })
  await expect(held.locator("[data-machine-pill] [role=status]")).toHaveText(
    "arc is away",
    { timeout: 60_000 }
  )
  const words = "and run them again with 8 shards"
  const box = held.getByRole("textbox", { name: "Message to Fake AI" })
  await box.fill(words)
  await box.press("Enter")
  await expect(
    held.getByRole("list", { name: "Waiting for arc" })
  ).toContainText(words)

  // Started again with arc held: its Pane knows arc only from the
  // directory this device keeps, and the rest from what the message kept.
  const page = await again()
  const thread = page.getByRole("region", { name: TITLE, exact: true })
  const waits = thread.getByRole("list", { name: "Waiting for arc" })
  await expect(waits.getByRole("listitem")).toHaveCount(1)
  await expect(waits).toContainText(words)
  const pill = thread.locator("[data-machine-pill]")
  await expect(pill).toHaveText("arc is away · 1 waiting", { timeout: 60_000 })
  // "banda · arc · its title" in its header.
  expect(await headerShows(thread)).toEqual([
    "project",
    "machine",
    TITLE,
    "buttons",
  ])
  await expect(thread.locator("header").first()).toContainText("banda")
  await expect(thread.locator("header").first()).toContainText("arc")
  await expect(
    thread.getByRole("textbox", { name: "Message to Fake AI" })
  ).toHaveAttribute(
    "aria-placeholder",
    "Write to Fake AI on arc. @ files, / commands, $ skills"
  )
  await shot(page, "restored-away-waiting")

  // Back, it goes to arc, once.
  arc!.blackhole(false)
  await expect(pill).toHaveCount(0, { timeout: 90_000 })
  await expect(waits).toHaveCount(0, { timeout: 30_000 })
  const answered = thread.getByText("The tests passed.")
  await expect(answered).toHaveCount(1, { timeout: 30_000 })
  await expect(thread.getByText(words, { exact: true })).toHaveCount(1)
})

/** arc's account a new Thread starts on, in its `agents.toml`. */
const startsOnArc = (on: Arc, account: string) =>
  put(join(on.dir, "config"), {
    "agents.toml": `[start]\naccount = "${account}"\n`,
  })

test("a new Thread on arc starts on arc's account, by arc's agents.toml, in a Project and in No Project, and follows that file while it waits", async () => {
  // arc has an account this machine does not, and starts on it; this
  // machine's agents.toml names none, so its own first would be Fake AI.
  const { page, composer, project } = await onArc([TITLE], (on) => {
    const list = join(on.dir, "config/harnesses.toml")
    const fake = readFileSync(list, "utf8")
    const work = fake
      .replace('id = "fake"', 'id = "work"')
      .replace('name = "Fake AI"', 'name = "Work"')
    writeFileSync(list, `${fake}\n${work}`)
    startsOnArc(on, "work")
  })
  await composer.focus()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Thread" })
    .click()
  const draft = page
    .getByRole("region", { name: "New Thread" })
    .and(page.locator('[data-focused="true"]'))
  const message = (to: string) =>
    draft.getByRole("textbox", { name: `Message to ${to}` })
  await expect(message("Work")).toHaveAttribute(
    "aria-placeholder",
    /^Write to Work on arc\./
  )
  await shot(page, "new-thread-arc-account")

  // A Pane opened on arc reads arc's list of Harnesses again, once the
  // last read is 2 s old. Through that, and in a draft that has only just
  // opened, every frame names the account and shows the mode.
  await expect(draft.getByRole("button", { name: /^Mode: / })).toBeVisible()
  const blinks = await draft.evaluateHandle((region) => {
    const seen: string[] = []
    new MutationObserver(() => {
      if (document.querySelector('[aria-label="Message to the Agent"]'))
        seen.push("no account")
      if (!region.querySelector('[aria-label^="Mode: "]')) seen.push("no mode")
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    })
    return seen
  })
  await page.waitForTimeout(2_200)
  await message("Work").focus()
  await page.keyboard.press("Alt+KeyN")
  await page
    .getByRole("region", { name: "New Pane" })
    .getByRole("button", { name: "Thread" })
    .click()
  await expect(message("Work")).toBeVisible()
  // The new draft names its account at once, before arc has answered that
  // read: a blink would come a few round trips later.
  await page.waitForTimeout(1_000)
  expect(await blinks.jsonValue()).toEqual([])

  // arc's file changes, and the draft follows, as Settings on arc would.
  startsOnArc(arc!, "fake")
  await expect(message("Fake AI")).toBeVisible()
  startsOnArc(arc!, "work")
  await expect(message("Work")).toBeVisible()

  // Moved to this machine it starts on this machine's own: a Harness of
  // one machine may not be on another, so moving there leaves it to choose.
  const menu = () => page.getByRole("menu")
  const onArcMenu = () =>
    menu().getByRole("group", { name: "arc", exact: true })
  await draft.getByRole("button", { name: "Project: banda on arc" }).click()
  await menu()
    .getByRole("menuitemradio", { name: /^No Project/ })
    .first()
    .click()
  await expect(message("Fake AI")).toBeVisible()

  // In arc's No Project it has no Project to ask, and starts by arc's
  // file all the same, and follows it.
  await draft.getByRole("button", { name: "Project: No Project" }).click()
  await onArcMenu()
    .getByRole("menuitemradio", { name: /^No Project/ })
    .click()
  await expect(
    draft.getByRole("button", { name: "Project: No Project on arc" })
  ).toBeVisible()
  await expect(message("Work")).toBeVisible()
  startsOnArc(arc!, "fake")
  await expect(message("Fake AI")).toBeVisible()
  startsOnArc(arc!, "work")
  await expect(message("Work")).toBeVisible()
  await draft
    .getByRole("button", { name: "Project: No Project on arc" })
    .click()
  await onArcMenu()
    .getByRole("menuitemradio", { name: /^banda/ })
    .click()
  await expect(message("Work")).toBeVisible()

  // It starts there, on arc's engine.
  await message("Work").fill("Started on Work")
  await message("Work").press("Enter")
  await expect(
    page
      .getByRole("region", { name: "Started on Work", exact: true })
      .getByText("You said: Started on Work")
  ).toBeVisible()
  const { ok } = JSON.parse(
    arc!.banda("call", "agents.threads", "--project", project)
  ) as { ok: { threads: { title: string; harness: string }[] } }
  expect(
    ok.threads.find((one) => one.title === "Started on Work")?.harness
  ).toBe("work")
})
