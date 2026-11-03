/**
 * Banda's own hands in the browser's tabs, for its tools for Agents (ADR
 * 0029, decision 2): Playwright, loaded on the first call, over the CDP
 * endpoint (cdp.ts). Each tab a Thread acts on has a connection of its
 * own, to a socket that sees that tab alone. A snapshot's refs live in
 * it, so it is held between calls, until the tab goes, the Person stops
 * the Agent there, or no call came for a while: a held tab draws as a
 * driven one does, unthrottled.
 */
import type { Participant } from "@banda/contract"
import type {
  Act,
  Handoff,
  Navigate,
  ReadTab,
  SeenTab,
  Shown,
  WaitFor,
} from "@banda/contract/browser"
import type { Driver, Wait } from "@banda/browser-pane/desktop"
import { Refused } from "@banda/desktop-kit"
import { Context, Effect, FiberSet, Layer, RcMap } from "effect"
import type { Event, InputEvent, WebContents } from "electron"
import { setTimeout as sleep } from "node:timers/promises"
import type { Browser, Dialog, Frame, Page } from "playwright-core"
import { Cdp, messageOf } from "./cdp"
import {
  act,
  goingTo,
  hidden,
  opening,
  type Pointing,
  READING,
  secrets,
  stepOf,
  timedOut,
  waitFor,
} from "./hands"
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
/** How long the Thread's cursor takes to go where its hands act: they
 * wait for it, so the Person sees where they act before they do. The
 * Pane's cursor glides as long. */
const POINTING = 300
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
  /** The tree of its last snapshot, which names the step's elements. */
  tree: string
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
    // Each is asked for by `by`, an Agent as a rule, whose Thread then
    // drives the tab.
    /** The tab's tree with its refs, address, title and new errors. */
    snapshot(tab: number, by: Participant): Effect.Effect<ReadTab, Refused>
    /** A new tab, at `url` or blank, once it loaded: beside the Thread
     * of `by` (`Tabs.create`). */
    open(
      url: string | undefined,
      by: Participant
    ): Effect.Effect<Shown, Refused>
    /** The tab, where `to` says, once it loaded. */
    navigate(to: Navigate, by: Participant): Effect.Effect<Shown, Refused>
    /** The tab, once `act` is done in it, and what it changed. */
    act(act: Act, by: Participant): Effect.Effect<Shown, Refused>
    /** The tab, once it shows what `wait` says. */
    waitFor(wait: WaitFor, by: Participant): Effect.Effect<Shown, Refused>
    /** Stops the Thread that drives the tab: its hold on it ends, and
     * the Person's programs there go on. The Thread waits until the
     * Person lets it drive again (ADR 0029, decision 6). */
    release(tab: number): Effect.Effect<void>
    /** The Thread of `agent` hands the tab to the Person for a step that
     * is theirs, and waits until they hand it back. */
    handoff(hand: Handoff, by: Participant): Effect.Effect<void, Refused>
    /** The Person answered what the Thread of `agent` waits for on the
     * tab: it may use the tab again. */
    answered(tab: number, agent: string): Effect.Effect<void>
    /** The turn of the Thread of `agent` ended: it drives no tab now. */
    settled(agent: string): Effect.Effect<void>
  }
>()("banda/Drive") {
  static readonly layer = Layer.effect(Drive)(
    Effect.gen(function* () {
      const cdp = yield* Cdp
      const tabs = yield* Tabs
      // What Playwright's callbacks run stops with the layer.
      const run = yield* FiberSet.makeRuntime()
      /** The tabs a Thread drives, from its first call until its turn
       * ends or the Person stops it (ADR 0029, decision 4), by the ID of
       * its Agent. */
      const driving = new Map<number, Driver>()
      /** Tells the tab's Pane who drives it now, the step it takes and
       * where its hands went last. */
      const tell = (tab: number, driver: Driver | null) => {
        if (driver) driving.set(tab, driver)
        else driving.delete(tab)
        tabs.tell({ kind: "driver", from: tab, driver })
      }
      /** The Threads that wait for the Person on each tab, by the IDs
       * of their Agents: until the Person answers, or the tab closes. */
      const waits = new Map<number, Map<string, Wait>>()
      const tellWaits = (tab: number) =>
        tabs.tell({
          kind: "waits",
          from: tab,
          waits: [...(waits.get(tab)?.values() ?? [])],
        })
      /** The tab's Thread of `wait.agent` waits for the Person; none
       * does on a tab gone. */
      const wait = (tab: number, wait: Wait) => {
        const contents = contentsOf(tab)
        if (!contents) return false
        let on = waits.get(tab)
        if (!on) {
          on = new Map()
          waits.set(tab, on)
          contents.once("destroyed", () => waits.delete(tab))
        }
        on.set(wait.agent, wait)
        tellWaits(tab)
        return true
      }
      /** Refuses a call of the Agent `by` on a tab where its Thread waits
       * for the Person, which it then asks. */
      const waiting = (tab: number, by: Participant) =>
        Effect.suspend(() => {
          const on = waits.get(tab)
          const was = by.kind === "agent" ? on?.get(by.id) : undefined
          if (!was) return Effect.void
          if (was.asked === undefined) {
            on!.set(by.id, { ...was, asked: Date.now() })
            tellWaits(tab)
          }
          return Effect.fail(
            new Refused({
              code: "forbidden",
              message:
                was.reason === "stopped"
                  ? `The Person stopped you on tab ${tab}. Do not use it until they let you drive again: say where you stopped and end your turn, and they will tell you.`
                  : `You handed tab ${tab} to the Person, to ${was.why}. Do not use it until they hand it back: end your turn, and their message says when.`,
            })
          )
        })
      /** The cursor of the Thread that drives the tab, going to `x`, `y`
       * as its hands do: they wait for it, unless it is there. */
      const pointer =
        (tab: number): Pointing =>
        async (x, y) => {
          const driver = driving.get(tab)
          if (!driver || (driver.at?.x === x && driver.at?.y === y)) return
          tell(tab, { ...driver, at: { x, y } })
          await sleep(POINTING)
        }
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
                  tree: "",
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
                if (driving.has(tab)) tell(tab, null)
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
      /**
       * Does `work` in the tab for `by`, connected to it. An Agent's
       * Thread drives the tab from then on, and its Pane shows the `step`
       * it takes.
       */
      const inTab = <A>(
        tab: number,
        by: Participant,
        step: string | ((tree: string) => string),
        work: (held: Held) => Promise<A>
      ) =>
        Effect.andThen(
          waiting(tab, by),
          Effect.scoped(
            Effect.flatMap(heldOf(tab), (kept) =>
              Effect.tryPromise({
                try: async () => {
                  if (!kept.touched.has(by.id)) kept.touched.set(by.id, false)
                  if (by.kind === "agent") {
                    const said =
                      typeof step === "string" ? step : step(kept.tree)
                    // The cursor stays where the Thread's hands went last.
                    const was = driving.get(tab)
                    const at = was?.agent === by.id ? was.at : undefined
                    tell(tab, { agent: by.id, step: said, at })
                  }
                  return await work(kept)
                },
                catch: refused,
              })
            )
          )
        )
      return {
        snapshot: (tab, by) =>
          inTab(tab, by, READING, async (kept) => {
            const { page } = kept
            const [title, tree, values, messages, thrown] = await Promise.all([
              page.title(),
              page.ariaSnapshot({ mode: "ai" }),
              secrets(page),
              page.consoleMessages(),
              page.pageErrors(),
            ])
            kept.touched.set(by.id, false)
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
            kept.tree = hidden(tree, values)
            return { url: page.url(), title, tree: kept.tree, errors }
          }),
        open: (url, by) =>
          Effect.flatMap(tabs.create(url, by.id), ({ id }) =>
            inTab(id, by, opening(url), (kept) => shown(id, kept, by.id))
          ),
        navigate: (to, by) =>
          inTab(to.tab, by, goingTo(to.to), async (kept) => {
            await go(kept.page, to)
            return shown(to.tab, kept, by.id)
          }),
        act: (what, by) =>
          inTab(
            what.tab,
            by,
            (tree) => stepOf(tree, what),
            async (kept) => {
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
                // Only a Thread's hands have a cursor.
                const acting = act(
                  page,
                  contents,
                  what,
                  by.kind === "agent" ? pointer(what.tab) : undefined
                )
                // A dialog the action opens stops the page, and the action
                // with it: the dialog is its answer.
                acting.catch(() => {})
                const shows = await Promise.race([acting, dialog.opened])
                if (shows)
                  opens = { kind: shows.type(), message: shows.message() }
                // A stopped page starts nothing more.
                else await sleep(SETTLING)
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
              return shown(what.tab, kept, by.id, {
                moved,
                opened,
                download,
                dialog: opens,
              })
            }
          ),
        waitFor: (wait, by) =>
          inTab(
            wait.tab,
            by,
            (tree) => stepOf(tree, wait),
            async (kept) => {
              await waitFor(kept.page, wait)
              return shown(wait.tab, kept, by.id)
            }
          ),
        release: (tab) =>
          Effect.suspend(() => {
            const driver = driving.get(tab)
            if (driver) wait(tab, { agent: driver.agent, reason: "stopped" })
            return RcMap.invalidate(held, tab)
          }),
        handoff: ({ tab, why }, by) =>
          Effect.suspend(() => {
            if (by.kind !== "agent")
              return Effect.fail(
                new Refused({ message: "Only an Agent hands a tab over." })
              )
            const handed: Wait = {
              agent: by.id,
              reason: "handoff",
              why,
              asked: Date.now(),
            }
            if (!wait(tab, handed)) return Effect.fail(noTab(tab))
            // The Person's turn: the Thread's drive there ends.
            return RcMap.invalidate(held, tab)
          }),
        answered: (tab, agent) =>
          Effect.sync(() => {
            const on = waits.get(tab)
            if (!on?.delete(agent)) return
            if (!on.size) waits.delete(tab)
            tellWaits(tab)
          }),
        settled: (agent) =>
          Effect.forEach(
            [...driving].filter(([, driver]) => driver.agent === agent),
            ([tab]) => RcMap.invalidate(held, tab),
            { discard: true }
          ),
      }
    })
  )
}
