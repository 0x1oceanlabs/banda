/**
 * An action runs from anywhere (ADR 0127, decision 2): `banda act ID` and
 * an Agent's `act` tool run the window's actions by their ids, as a key
 * does, and say why one does not run.
 */
import { expect, test } from "@playwright/test"
import {
  agentCalls,
  agentSays,
  firstThread,
  startWindow,
  type Window,
} from "./window"

let window: Window
test.afterEach(async () => window?.close())

/** What `banda act` printed and how it exited, for one it refused. */
function refused(...args: string[]): { status: number; message: string } {
  try {
    window.banda("act", ...args)
  } catch (error) {
    const { status, stdout } = error as { status: number; stdout: string }
    return { status, message: JSON.parse(stdout).error.message }
  }
  throw new Error(`banda act ${args.join(" ")} was not refused`)
}

test("banda act runs an action in the window by its id, as its key does: the Overview and a terminal; and one that does not run says why and exits 1", async () => {
  window = await startWindow()
  const { page } = window
  await firstThread(page)

  expect(JSON.parse(window.banda("act", "overview.toggle"))).toEqual({
    ok: "Banda's window ran “Overview of every window”",
  })
  const overview = page.getByRole("dialog", { name: "Overview" })
  await expect(overview).toBeVisible()
  window.banda("act", "overview.toggle")
  await expect(overview).toBeHidden()

  // A terminal Pane, beside the Thread in focus.
  window.banda("act", "terminal.new")
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  await expect(page.locator("section[data-tile]")).toHaveCount(2)

  // An action of a scope runs for the Pane in focus, the terminal, and
  // one of another scope is refused, naming it.
  window.banda("act", "terminal.zoom-in")
  expect(refused("browser.reload")).toEqual({
    status: 1,
    message:
      'browser.reload runs in the scope "browser", and the focus is not there now.',
  })
  // The engine refuses an id Banda has not, and args an action does not
  // take, before the window hears of it.
  expect(refused("no.such")).toEqual({
    status: 1,
    message:
      "Banda has no action no.such; keys_list, or `banda keys`, lists them",
  })
  expect(refused("overview.toggle", "--args", '{"now":true}')).toEqual({
    status: 1,
    message: "overview.toggle takes no args",
  })
  await expect(overview).toBeHidden()
})

test("an Agent runs an action with its act tool, and what acts as its Person stays theirs (ADR 0083, decision 3)", async () => {
  window = await startWindow()
  const { page } = window
  const { thread, composer } = await firstThread(page)
  // A session of the Thread's opens, whose Agent has Banda's tools.
  await composer.fill("hello")
  await composer.press("Enter")
  await expect(thread.getByText("You said: hello")).toBeVisible()

  // "Put a terminal beside you."
  expect(await agentSays(window, "act", { action: "terminal.new" })).toBe(
    "Banda's window ran “New terminal”"
  )
  const screen = page.getByRole("region", { name: "Terminal screen" })
  await expect(screen).toHaveAttribute("data-state", "running")
  // The Tiling's and the focus's are an Agent's to run too.
  await agentSays(window, "act", { action: "overview.toggle" })
  const overview = page.getByRole("dialog", { name: "Overview" })
  await expect(overview).toBeVisible()
  await agentSays(window, "act", { action: "overview.toggle" })
  await expect(overview).toBeHidden()

  const asPerson = await agentCalls(window, "act", {
    action: "thread.new",
    args: { ask: "hello again" },
  })
  expect(asPerson.isError).toBe(true)
  expect(asPerson.content[0].text).toContain(
    "Only your Person runs thread.new with ask"
  )
  await expect(page.getByText("You said: hello again")).toHaveCount(0)
  // Nor does it paste what the clipboard holds into the terminal in focus.
  const paste = await agentCalls(window, "act", { action: "edit.paste" })
  expect(paste.isError).toBe(true)
  expect(paste.content[0].text).toContain("Only your Person runs edit.paste")
})
