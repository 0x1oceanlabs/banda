/**
 * Banda's own hands in the browser's tabs, for its tools for Agents (ADR
 * 0029, decision 2): Playwright, loaded on the first call, over the CDP
 * endpoint (cdp.ts). Each tab a Thread acts on has a connection of its
 * own, to a socket that sees that tab alone. A snapshot's refs live in
 * it, so it is held between calls, until the tab goes, the Person stops
 * the Agent there, or no call came for a while: a held tab draws as a
 * driven one does, unthrottled.
 */
import type { Navigate, ReadTab, Shown } from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import { Context, Effect, FiberSet, Layer, RcMap } from "effect"
import type { Page } from "playwright-core"
import { Cdp, messageOf } from "./cdp"
import { pageOf as contentsOf, Tabs } from "./tabs"

/** How long a tab no call came for stays held. */
const IDLE = "5 minutes"
/** How long an address has to answer, and its page then to load: the
 * engine waits 40 s for both (ADR 0029, decision 2). */
const ANSWERING = 15_000
const LOADING = 15_000

/** What Playwright threw, as the Agent hears it. */
const refused = (error: unknown) =>
  error instanceof Refused ? error : new Refused({ message: messageOf(error) })

const timedOut = (error: unknown) =>
  error instanceof Error && error.name === "TimeoutError"

/** Where `page` is once it loaded, or `LOADING` passed. */
const shown = async (tab: number, page: Page): Promise<Shown> => {
  const loading = await page
    .waitForLoadState("load", { timeout: LOADING })
    .then(
      () => false,
      (error) => {
        if (timedOut(error)) return true
        throw error
      }
    )
  return { tab, url: page.url(), title: await page.title(), loading }
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
    /** The tab's tree with its refs, address, title and new errors. */
    snapshot(tab: number): Effect.Effect<ReadTab, Refused>
    /** A new tab, at `url` or blank, once it loaded. */
    open(url?: string): Effect.Effect<Shown, Refused>
    /** The tab, where `to` says, once it loaded. */
    navigate(to: Navigate): Effect.Effect<Shown, Refused>
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
                if (!socket)
                  throw new Refused({
                    code: "not_found",
                    message: `There is no tab ${tab}: browser_tabs lists them.`,
                  })
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
                return { connection, page }
              },
              catch: refused,
            }),
            ({ connection }) => Effect.promise(() => connection.close())
          ),
      })
      /** The tab's page, connected; again, if its page closed since. */
      const pageOf = (tab: number) =>
        Effect.flatMap(RcMap.get(held, tab), ({ page }) =>
          page.isClosed()
            ? Effect.andThen(
                RcMap.invalidate(held, tab),
                Effect.map(RcMap.get(held, tab), (again) => again.page)
              )
            : Effect.succeed(page)
        )
      /** Does `work` in the tab, connected to it. */
      const inTab = <A>(tab: number, work: (page: Page) => Promise<A>) =>
        Effect.scoped(
          Effect.flatMap(pageOf(tab), (page) =>
            Effect.tryPromise({ try: () => work(page), catch: refused })
          )
        )

      return {
        snapshot: (tab) =>
          inTab(tab, async (page) => {
            const [title, tree, messages, thrown] = await Promise.all([
              page.title(),
              page.ariaSnapshot({ mode: "ai" }),
              page.consoleMessages(),
              page.pageErrors(),
            ])
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
            return { url: page.url(), title, tree, errors }
          }),
        open: (url) =>
          Effect.flatMap(tabs.create(url), ({ id }) =>
            inTab(id, (page) => shown(id, page))
          ),
        navigate: (to) =>
          inTab(to.tab, async (page) => {
            await go(page, to)
            return shown(to.tab, page)
          }),
      }
    })
  )
}
