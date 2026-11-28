/**
 * What Banda's tools for Agents do with a tab's page besides the hands'
 * actions (ADR 0029, decision 2): take it to an address, read it, wait
 * for it to load, and see what an action started. One home for the
 * window's tabs and the driver's: each gives its own page, dialogs and
 * history.
 */
import { setTimeout as sleep } from "node:timers/promises"
import type { Navigate, ReadTab, Shown } from "@banda/contract/browser"
import type { Frame, Page } from "playwright-core"
import type { Dialogs } from "./dialogs"
import { hidden, secrets, timedOut } from "./hands"
import { Refusal } from "./refusal"

/** How long an address has to answer, and its page then to load: the
 * engine waits 40 s for both (ADR 0029, decision 2). */
export const ANSWERING = 15_000
export const LOADING = 15_000
/** How long an action's page has to start what it starts: a new address,
 * a tab, a dialog, a download. */
export const SETTLING = 300

/** Where `browser_navigate` goes in a tab's history, not to an address. */
export const HISTORY = new Set(["back", "forward", "reload"])

/** Whether a tab has somewhere to go back or forward to. */
export type History = {
  canGoBack(): boolean | Promise<boolean>
  canGoForward(): boolean | Promise<boolean>
}

const nowhere = (tab: number, to: string) =>
  new Refusal({ message: `Tab ${tab} has nowhere to go ${to}.` })

/** Takes `page` where `to` says, once its address answered. */
export async function go(page: Page, { tab, to }: Navigate, history: History) {
  const options = { waitUntil: "commit", timeout: ANSWERING } as const
  try {
    if (to === "back") {
      if (!(await history.canGoBack())) throw nowhere(tab, to)
      await page.goBack(options)
    } else if (to === "forward") {
      if (!(await history.canGoForward())) throw nowhere(tab, to)
      await page.goForward(options)
    } else if (to === "reload") await page.reload(options)
    else await page.goto(to, options)
  } catch (error) {
    if (!timedOut(error)) throw error
    throw new Refusal({
      code: "may_have_run",
      message: `Tab ${tab}'s address did not answer within ${ANSWERING / 1000} s, and may still.`,
    })
  }
}

/** Whether `page` still loads once it had `LOADING` to. A dialog stops
 * loading and scripts, one a load event opened too: it ends the wait. */
async function loading(page: Page, dialogs: Dialogs): Promise<boolean> {
  const next = dialogs.watch()
  try {
    if (dialogs.current()) return false
    return await Promise.race([
      page.waitForLoadState("load", { timeout: LOADING }).then(
        () => false,
        (error) => {
          if (timedOut(error)) return true
          throw error
        }
      ),
      next.opened.then(() => false),
    ])
  } finally {
    next.stop()
  }
}

/** Where the tab `tab` is once its `page` loaded, or `LOADING` passed,
 * and what `changed`. While a dialog stops the page its title is the
 * browser's, `title`, not the page's own. Whether the Person touched it
 * is its holder's to say. */
export async function shown(
  tab: number,
  page: Page,
  dialogs: Dialogs,
  title: () => string | Promise<string>,
  changed: Partial<Shown> = {}
): Promise<Shown> {
  const still = await loading(page, dialogs)
  const dialog = dialogs.current()
  return {
    tab,
    url: page.url(),
    title: dialog ? await title() : await page.title(),
    loading: still,
    moved: false,
    opened: [],
    download: null,
    touched: false,
    ...changed,
    dialog,
  }
}

/** `page` as a snapshot reads it: its tree with its refs and its secret
 * fields' values hidden, and its errors since the last one. */
export async function read(page: Page): Promise<Omit<ReadTab, "dialog">> {
  const [title, tree, values, messages, thrown] = await Promise.all([
    page.title(),
    page.ariaSnapshot({ mode: "ai" }),
    secrets(page),
    page.consoleMessages(),
    page.pageErrors(),
  ])
  // Playwright keeps the last 200 of each: cleared, the next snapshot
  // says the new ones.
  await Promise.all([page.clearConsoleMessages(), page.clearPageErrors()])
  const errors = [
    ...messages
      .filter((message) => message.type() === "error")
      .map((message) => message.text()),
    ...thrown.map((error) => error.message),
  ]
  return { url: page.url(), title, tree: hidden(tree, values), errors }
}

/** Does `acting` in `page`, and gives it `SETTLING` to start what it
 * starts; whether the page went to another address meanwhile. A dialog
 * the action opens stops the page, and the action with it: the dialog is
 * its answer, and the wait ends with it. */
export async function during(
  page: Page,
  dialogs: Dialogs,
  acting: () => Promise<void>
): Promise<boolean> {
  let moved = false
  const navigated = (frame: Frame) => {
    if (frame === page.mainFrame()) moved = true
  }
  const dialog = dialogs.watch()
  page.on("framenavigated", navigated)
  try {
    const done = acting()
    done.catch(() => {})
    // A stopped page starts nothing more.
    if (!(await Promise.race([done, dialog.opened]))) await sleep(SETTLING)
  } finally {
    dialog.stop()
    page.off("framenavigated", navigated)
  }
  return moved
}
