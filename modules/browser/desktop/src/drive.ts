/**
 * Banda's own hands in the browser's tabs, for its tools for Agents (ADR
 * 0029, decision 2): Playwright, loaded on the first call, over the CDP
 * endpoint (cdp.ts). Each tab a Thread acts on has a connection of its
 * own, to a socket that sees that tab alone. A snapshot's refs live in
 * it, so it is held between calls, until the tab goes, the Person stops
 * the Agent there, or no call came for a while: a held tab draws as a
 * driven one does, unthrottled.
 */
import type {
  Act,
  Navigate,
  ReadTab,
  SeenTab,
  Shown,
  WaitFor,
} from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import { Context, Effect, FiberSet, Layer, RcMap } from "effect"
import type { Event, InputEvent, WebContents } from "electron"
import type { Browser, Dialog, Frame, Page } from "playwright-core"
import { Cdp, messageOf } from "./cdp"
import { act, hidden, secrets, timedOut, waitFor } from "./hands"
import { pageOf as contentsOf, Tabs } from "./tabs"

/** How long a tab no call came for stays held. */
const IDLE = "5 minutes"
/** How long an address has to answer, and its page then to load: the
 * engine waits 40 s for both (ADR 0029, decision 2). */
const ANSWERING = 15_000
const LOADING = 15_000
/** How long an action's page has to start what it starts: a new address,
 * a tab, a dialog, a download. */
const SETTLING = 300
/** The Person's input on a page, as Banda notes it (decision 5). */
const PERSON = new Set<InputEvent["type"]>([
  "mouseDown",
  "mouseWheel",
  "rawKeyDown",
  "keyDown",
])

/** A tab Banda holds: Playwright's page in it, and what main keeps of
 * it besides. */
type Held = {
  readonly connection: Browser
  readonly page: Page
  /** Each Agent that called on it, by its ID, and whether the Person
   * acted on it since its last snapshot, until the Agent hears so. */
  readonly touched: Map<string, boolean>
  /** Whether Banda's hands act in it now: their input is not the
   * Person's. */
  acting: boolean
}

const noTab = (tab: number) =>
  new Refused({
    code: "not_found",
    message: `There is no tab ${tab}: browser_tabs lists them.`,
  })

/** A tab as an Agent sees it. */
export const seenTab = (
  page: WebContents,
  cdp: Pick<Cdp["Service"], "drives">
): SeenTab => ({
  id: page.id,
  url: page.getURL(),
  title: page.getTitle(),
  driven: cdp.drives(page),
})

/** What Playwright threw, as the Agent hears it. */
const refused = (error: unknown) =>
  error instanceof Refused ? error : new Refused({ message: messageOf(error) })

/** Where the tab of `held` is once it loaded, or `LOADING` passed, and
 * what `changed`, as the Agent `by` hears it: the Person's input since its
 * last snapshot is said once. */
const shown = async (
  tab: number,
  held: Held,
  by: string,
  changed: Partial<Shown> = {}
): Promise<Shown> => {
  const { page } = held
  // A page that shows a dialog loads nothing more until it is answered.
  const loading =
    !changed.dialog &&
    (await page.waitForLoadState("load", { timeout: LOADING }).then(
      () => false,
      (error) => {
        if (timedOut(error)) return true
        throw error
      }
    ))
  const touched = held.touched.get(by) ?? false
  held.touched.set(by, false)
  return {
    tab,
    url: page.url(),
    // From the browser, not the page, while a dialog stops it.
    title: changed.dialog
      ? (contentsOf(tab)?.getTitle() ?? "")
      : await page.title(),
    loading,
    moved: false,
    opened: [],
    dialog: null,
    download: null,
    touched,
    ...changed,
  }
}

/** The dialog `page` shows next, once it shows one, until `stop`. */
const dialogs = (page: Page) => {
  let stop = () => {}
  const opened = new Promise<Dialog>((heard) => {
    page.once("dialog", heard)
    stop = () => page.off("dialog", heard)
  })
  return { opened, stop }
}

/** Takes `page` where `to` says, once its address answered. */
const go = async (page: Page, { tab, to }: Navigate) => {
  const options = { waitUntil: "commit", timeout: ANSWERING } as const
  const history = contentsOf(tab)?.navigationHistory
  try {
    if (to === "back") {
      if (!history?.canGoBack()) throw nowhere(tab, to)
      await page.goBack(options)
    } else if (to === "forward") {
      if (!history?.canGoForward()) throw nowhere(tab, to)
      await page.goForward(options)
    } else if (to === "reload") await page.reload(options)
    else await page.goto(to, options)
  } catch (error) {
    if (!timedOut(error)) throw error
    throw new Refused({
      code: "may_have_run",
      message: `Tab ${tab}'s address did not answer within ${ANSWERING / 1000} s, and may still.`,
    })
  }
}

const nowhere = (tab: number, to: string) =>
  new Refused({ message: `Tab ${tab} has nowhere to go ${to}.` })

export class Drive extends Context.Service<
  Drive,
  {
    // Each is asked for by the Agent `by`, by its ID.
    /** The tab's tree with its refs, address, title and new errors. */
    snapshot(tab: number, by: string): Effect.Effect<ReadTab, Refused>
    /** A new tab, at `url` or blank, once it loaded: beside the Thread
     * of `by` (`Tabs.create`). */
    open(url: string | undefined, by: string): Effect.Effect<Shown, Refused>
    /** The tab, where `to` says, once it loaded. */
    navigate(to: Navigate, by: string): Effect.Effect<Shown, Refused>
    /** The tab, once `act` is done in it, and what it changed. */
    act(act: Act, by: string): Effect.Effect<Shown, Refused>
    /** The tab, once it shows what `wait` says. */
    waitFor(wait: WaitFor, by: string): Effect.Effect<Shown, Refused>
  }
>()("banda/Drive") {
  static readonly layer = Layer.effect(Drive)(
    Effect.gen(function* () {
      const cdp = yield* Cdp
      const tabs = yield* Tabs
      // What Playwright's callbacks run stops with the layer.
      const run = yield* FiberSet.makeRuntime()
      const held = yield* RcMap.make({
        idleTimeToLive: IDLE,
        lookup: (tab: number) =>
          Effect.acquireRelease(
            Effect.tryPromise({
              try: async () => {
                const socket = cdp.tab(tab)
                if (!socket) throw noTab(tab)
                const { chromium } = await import("playwright-core")
                const connection = await chromium.connectOverCDP(socket)
                const page = connection.contexts()[0]?.pages()[0]
                if (!page) {
                  await connection.close()
                  throw new Error(`Tab ${tab} could not be reached.`)
                }
                // The tab closed, or the Person stopped the Agent there:
                // the connection goes, and the next call connects again.
                const drop = () => run(RcMap.invalidate(held, tab))
                page.on("close", drop)
                connection.on("disconnected", drop)
                const kept: Held = {
                  connection,
                  page,
                  touched: new Map(),
                  acting: false,
                }
                // A dialog waits for the Person's answer: Playwright
                // dismisses one that nothing listens for.
                page.on("dialog", () => {})
                const contents = contentsOf(tab)
                const noted = (_: Event, input: InputEvent) => {
                  if (kept.acting || !PERSON.has(input.type)) return
                  for (const agent of kept.touched.keys())
                    kept.touched.set(agent, true)
                }
                contents?.on("input-event", noted)
                return { kept, contents, noted }
              },
              catch: refused,
            }),
            ({ kept, contents, noted }) =>
              Effect.promise(() => {
                if (contents && !contents.isDestroyed())
                  contents.off("input-event", noted)
                return kept.connection.close()
              })
          ),
      })
      /** The tab, connected; again, if its page closed since. */
      const heldOf = (tab: number) =>
        Effect.flatMap(RcMap.get(held, tab), ({ kept }) =>
          kept.page.isClosed()
            ? Effect.andThen(
                RcMap.invalidate(held, tab),
                Effect.map(RcMap.get(held, tab), (again) => again.kept)
              )
            : Effect.succeed(kept)
        )
      /** Does `work` in the tab for the Agent `by`, connected to it. */
      const inTab = <A>(
        tab: number,
        by: string,
        work: (held: Held) => Promise<A>
      ) =>
        Effect.scoped(
          Effect.flatMap(heldOf(tab), (kept) => {
            if (!kept.touched.has(by)) kept.touched.set(by, false)
            return Effect.tryPromise({ try: () => work(kept), catch: refused })
          })
        )
      return {
        snapshot: (tab, by) =>
          inTab(tab, by, async (kept) => {
            const { page } = kept
            const [title, tree, values, messages, thrown] = await Promise.all([
              page.title(),
              page.ariaSnapshot({ mode: "ai" }),
              secrets(page),
              page.consoleMessages(),
              page.pageErrors(),
            ])
            kept.touched.set(by, false)
            // Playwright keeps the last 200 of each: cleared, the next
            // snapshot says the new ones.
            await Promise.all([
              page.clearConsoleMessages(),
              page.clearPageErrors(),
            ])
            const errors = [
              ...messages
                .filter((message) => message.type() === "error")
                .map((message) => message.text()),
              ...thrown.map((error) => error.message),
            ]
            return {
              url: page.url(),
              title,
              tree: hidden(tree, values),
              errors,
            }
          }),
        open: (url, by) =>
          Effect.flatMap(tabs.create(url, by), ({ id }) =>
            inTab(id, by, (kept) => shown(id, kept, by))
          ),
        navigate: (to, by) =>
          inTab(to.tab, by, async (kept) => {
            await go(kept.page, to)
            return shown(to.tab, kept, by)
          }),
        act: (what, by) =>
          inTab(what.tab, by, async (kept) => {
            const { page } = kept
            const contents = contentsOf(what.tab)
            if (!contents) throw noTab(what.tab)
            const before = new Set(tabs.all().map((page) => page.id))
            let moved = false
            const navigated = (frame: Frame) => {
              if (frame === page.mainFrame()) moved = true
            }
            let download: string | null = null
            const { session } = contents
            const downloads = (
              _: Event,
              item: Electron.DownloadItem,
              from: WebContents
            ) => {
              if (from.id === what.tab) download = item.getFilename()
            }
            const dialog = dialogs(page)
            let opens: Shown["dialog"] = null
            page.on("framenavigated", navigated)
            session.on("will-download", downloads)
            kept.acting = true
            try {
              const acting = act(page, contents, what)
              // A dialog the action opens stops the page, and the action
              // with it: the dialog is its answer.
              acting.catch(() => {})
              const shows = await Promise.race([acting, dialog.opened])
              if (shows)
                opens = { kind: shows.type(), message: shows.message() }
              // A stopped page starts nothing more.
              else await new Promise((settled) => setTimeout(settled, SETTLING))
            } finally {
              kept.acting = false
              dialog.stop()
              page.off("framenavigated", navigated)
              session.off("will-download", downloads)
            }
            const opened = tabs
              .all()
              .filter((page) => !before.has(page.id))
              .map((page) => seenTab(page, cdp))
            return shown(what.tab, kept, by, {
              moved,
              opened,
              download,
              dialog: opens,
            })
          }),
        waitFor: (wait, by) =>
          inTab(wait.tab, by, async (kept) => {
            await waitFor(kept.page, wait)
            return shown(wait.tab, kept, by)
          }),
      }
    })
  )
}
