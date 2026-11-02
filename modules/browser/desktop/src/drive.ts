/**
 * Banda's own hands in the browser's tabs, for its tools for Agents (ADR
 * 0029, decision 2): Playwright, loaded on the first call, over the CDP
 * endpoint (cdp.ts). Each tab a Thread acts on has a connection of its
 * own, to a socket that sees that tab alone. A snapshot's refs live in
 * it, so it is held between calls, until the tab goes, the Person stops
 * the Agent there, or no call came for a while: a held tab draws as a
 * driven one does, unthrottled.
 */
import type { ReadTab } from "@banda/contract/browser"
import { Refused } from "@banda/desktop-kit"
import { Context, Effect, FiberSet, Layer, RcMap } from "effect"
import type { Page } from "playwright-core"
import { Cdp, messageOf } from "./cdp"

/** How long a tab no call came for stays held. */
const IDLE = "5 minutes"

/** What Playwright threw, as the Agent hears it. */
const refused = (error: unknown) => new Refused({ message: messageOf(error) })

export class Drive extends Context.Service<
  Drive,
  {
    /** The tab's tree with its refs, address, title and new errors. */
    snapshot(tab: number): Effect.Effect<ReadTab, Refused>
  }
>()("banda/Drive") {
  static readonly layer = Layer.effect(Drive)(
    Effect.gen(function* () {
      const cdp = yield* Cdp
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
              catch: (error) =>
                error instanceof Refused ? error : refused(error),
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
      }
    })
  )
}
