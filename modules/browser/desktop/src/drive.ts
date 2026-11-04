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
  SiteRule,
  WaitFor,
} from "@banda/contract/browser"
import type { Driver, SiteAnswer, Wait } from "@banda/browser-pane/desktop"
import { BROWSER_FILE, siteKey } from "@banda/contract/browser"
import { fileOf } from "@banda/contract/look"
import { type Broke, Look, Refused, Settings } from "@banda/desktop-kit"
import { Context, Effect, FiberSet, Layer, RcMap } from "effect"
import type { Event, InputEvent, WebContents } from "electron"
import { setTimeout as sleep } from "node:timers/promises"
import type { Browser, Frame, Page } from "playwright-core"
import { Dialogs } from "./dialogs"
import { Cdp, messageOf } from "./cdp"
import {
  act,
  goingTo,
  hidden,
  opening,
  type Pointing,
  READING,
  ruleAt,
  secrets,
  siteAt,
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
  readonly dialogs: Dialogs["Service"]
  /** Each Agent that called on it, by its ID, and whether the Person
   * acted on it since its last snapshot, until the Agent hears so. */
  readonly touched: Map<string, boolean>
  /** Whether Banda's hands act in it now: their input is not the
   * Person's. */
  dialogRevision: number
  acting: boolean
  /** The tree of its last snapshot, which names the step's elements. */
  tree: string
}

const noTab = (tab: number) =>
  new Refused({
    code: "not_found",
    message: `There is no tab ${tab}: browser_tabs lists them.`,
  })

/** What a call of the Agent `agent` on `tab` hears while `wait` blocks
 * it there (ADR 0029, decision 6). */
const waitRefused = (tab: number, wait: Wait, agent: string) => {
  const say = (message: string) => new Refused({ code: "forbidden", message })
  if (wait.agent !== agent)
    return say(
      `Tab ${tab} is the Person's now, for a step of theirs. Do not use it until they hand it back.`
    )
  switch (wait.reason) {
    case "stopped":
      return say(
        `The Person stopped you on tab ${tab}. Do not use it until they let you drive again: say where you stopped and end your turn, and they will tell you.`
      )
    case "handoff":
      return say(
        `You handed tab ${tab} to the Person: "${wait.why}". Do not use it until they hand it back: end your turn, and their message says when.`
      )
    case "site":
      return say(
        `Tab ${tab} is on ${wait.site}, which you may not use yet: Banda asked the Person on the tab. End your turn, and their message says what they chose.`
      )
  }
}

const denied = (site: string) =>
  new Refused({
    code: "forbidden",
    message: `The Person lets no Agent use ${site}. Do not use it: carry on without it, or tell them why you need it.`,
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
  // Loading and scripts stop while a dialog is open, including one
  // opened by a load event rather than by an Agent's click.
  const next = held.dialogs.watch(tab)
  let loading = false
  try {
    if (!held.dialogs.current(tab))
      loading = await Promise.race([
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
  changed = { ...changed, dialog: held.dialogs.current(tab) }
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
     * tab (one wait at most): it may use the tab again. False when it
     * waited for nothing. */
    answered(tab: number, agent: string): Effect.Effect<boolean>
    /** The Person's answer to whether the Thread of `agent` may use the
     * site it waits for on the tab: Once, for it until Banda restarts;
     * Always or Deny, for every Agent, in `browser.toml`. False when it
     * waited for none. */
    allowed(
      tab: number,
      agent: string,
      answer: SiteAnswer
    ): Effect.Effect<boolean, Refused | Broke>
    /** The turn of the Thread of `agent` ended: it drives no tab now. */
    settled(agent: string): Effect.Effect<void>
  }
>()("banda/Drive") {
  static readonly layer = Layer.effect(Drive)(
    Effect.gen(function* () {
      const cdp = yield* Cdp
      const dialogs = yield* Dialogs
      const tabs = yield* Tabs
      const look = yield* Look
      const settings = yield* Settings
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
      /** The tab's Thread of `what.agent` waits for the Person; none
       * does on a tab gone. */
      const wait = (tab: number, what: Wait) => {
        const contents = contentsOf(tab)
        if (!contents) return false
        let on = waits.get(tab)
        if (!on) {
          on = new Map()
          waits.set(tab, on)
          contents.once("destroyed", () => waits.delete(tab))
        }
        on.set(what.agent, what)
        tellWaits(tab)
        return true
      }
      /** The Thread of `agent` waits on the tab no more: false when it
       * did not. The tab's map stays, as its one hook on the tab's end
       * does. */
      const unwait = (tab: number, agent: string) => {
        if (!waits.get(tab)?.delete(agent)) return false
        tellWaits(tab)
        return true
      }
      /** Refuses a call of the Agent `by` on a tab where its Thread waits
       * for the Person, which it then asks; and every Agent's while the
       * tab is handed to the Person, who has it then. */
      const waiting = (tab: number, by: Participant) =>
        Effect.suspend(() => {
          const on = waits.get(tab)
          if (!on || by.kind !== "agent") return Effect.void
          const was =
            on.get(by.id) ??
            [...on.values()].find((wait) => wait.reason === "handoff")
          if (!was) return Effect.void
          if (was.agent === by.id && was.asked === undefined) {
            on.set(by.id, { ...was, asked: Date.now() })
            tellWaits(tab)
          }
          return Effect.fail(waitRefused(tab, was, by.id))
        })
      /** What the Person answered the Thread of each Agent of each site,
       * by `<agent> <site>`, until Banda restarts: under `browser.toml`,
       * which their Always and Deny also go to, and which may have changed
       * since. */
      const answers = new Map<string, SiteRule>()
      /** Refuses a read or an action of the Agent `by` on a site it may
       * not use (ADR 0029, decision 7, B): one the Person denied every
       * Agent; or one they have not let it use yet, which its Thread then
       * waits on the tab for them to answer. */
      const gated = (tab: number, by: Participant) =>
        Effect.suspend(() => {
          const at = siteAt(contentsOf(tab)?.getURL() ?? "")
          if (!at || by.kind !== "agent") return Effect.void
          const { site } = at
          return Effect.flatMap(look.current, (now) => {
            const rule =
              (now && ruleAt(fileOf(now.files, BROWSER_FILE).sites, at)) ??
              answers.get(`${by.id} ${site}`)
            if (rule === "deny") return Effect.fail(denied(site))
            if (rule === "allow") return Effect.void
            const asking: Wait = {
              agent: by.id,
              reason: "site",
              site,
              asked: Date.now(),
            }
            if (!wait(tab, asking)) return Effect.fail(noTab(tab))
            // Its drive there ends while it waits, as a handoff's does.
            if (driving.get(tab)?.agent === by.id) tell(tab, null)
            return Effect.fail(waitRefused(tab, asking, by.id))
          })
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
                  dialogs,
                  touched: new Map(),
                  acting: false,
                  dialogRevision: dialogs.revision(tab),
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
       * it takes. Work that reads or acts in the page, not only goes
       * somewhere, needs the Person's yes to its site.
       */
      const inTab = <A>(
        tab: number,
        by: Participant,
        step: string | ((tree: string) => string),
        work: (held: Held) => Promise<A>,
        reads = true
      ) =>
        Effect.andThen(
          Effect.andThen(
            waiting(tab, by),
            reads ? gated(tab, by) : Effect.void
          ),
          Effect.scoped(
            Effect.flatMap(heldOf(tab), (kept) =>
              Effect.tryPromise({
                try: async () => {
                  const revision = dialogs.revision(tab)
                  if (revision !== kept.dialogRevision) {
                    for (const agent of kept.touched.keys())
                      kept.touched.set(agent, true)
                    kept.dialogRevision = revision
                  }
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
          Effect.suspend((): Effect.Effect<ReadTab, Refused> => {
            const dialog = dialogs.current(tab)
            if (dialog)
              return Effect.andThen(
                Effect.andThen(waiting(tab, by), gated(tab, by)),
                Effect.sync(() => ({
                  url: contentsOf(tab)?.getURL() ?? "",
                  title: contentsOf(tab)?.getTitle() ?? "",
                  tree: "",
                  errors: [],
                  dialog,
                }))
              )
            return inTab(tab, by, READING, async (kept) => {
              const { page } = kept
              const [title, tree, values, messages, thrown] = await Promise.all(
                [
                  page.title(),
                  page.ariaSnapshot({ mode: "ai" }),
                  secrets(page),
                  page.consoleMessages(),
                  page.pageErrors(),
                ]
              )
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
              return {
                url: page.url(),
                title,
                tree: kept.tree,
                errors,
                dialog: null,
              }
            })
          }),
        open: (url, by) =>
          Effect.flatMap(tabs.create(url, by.id), (page) =>
            Effect.tryPromise({
              try: async (signal) => {
                // A load-time dialog blocks Playwright's initialization. Opening
                // needs only the native page; connect later, on the first read.
                const next = dialogs.watch(page.id)
                let stop = () => {}
                try {
                  if (!dialogs.current(page.id) && page.isLoading()) {
                    const loaded = new Promise<void>((resolve, reject) => {
                      const done = () => resolve()
                      const gone = () => reject(noTab(page.id))
                      const aborted = () => reject(signal.reason)
                      const timer = setTimeout(done, LOADING)
                      page.once("did-stop-loading", done)
                      page.once("destroyed", gone)
                      signal.addEventListener("abort", aborted, { once: true })
                      stop = () => {
                        clearTimeout(timer)
                        page.removeListener("did-stop-loading", done)
                        page.removeListener("destroyed", gone)
                        signal.removeEventListener("abort", aborted)
                      }
                    })
                    await Promise.race([loaded, next.opened])
                  }
                  if (page.isDestroyed()) throw noTab(page.id)
                  if (by.kind === "agent")
                    tell(page.id, { agent: by.id, step: opening(url) })
                  const dialog = dialogs.current(page.id)
                  const address = page.getURL()
                  const title = page.getTitle()
                  return {
                    tab: page.id,
                    url: address,
                    // Electron names a fresh blank page by its URL; its
                    // document title, which the tools report, is empty.
                    title:
                      address === "about:blank" && title === address
                        ? ""
                        : title,
                    loading: !dialog && page.isLoading(),
                    moved: false,
                    opened: [],
                    download: null,
                    touched: false,
                    dialog,
                  }
                } finally {
                  stop()
                  next.stop()
                }
              },
              catch: refused,
            })
          ),
        navigate: (to, by) =>
          inTab(
            to.tab,
            by,
            goingTo(to.to),
            async (kept) => {
              const pending = dialogs.current(to.tab)
              if (pending)
                throw new Refused({
                  code: "conflict",
                  message: `The page waits for dialog ${pending.id}. Answer it first.`,
                })
              await go(kept.page, to)
              return shown(to.tab, kept, by.id)
            },
            false
          ),
        act: (what, by) =>
          Effect.suspend(() => {
            if (
              what.action === "dialog_accept" ||
              what.action === "dialog_dismiss"
            ) {
              return Effect.gen(function* () {
                yield* waiting(what.tab, by)
                yield* gated(what.tab, by)
                yield* dialogs.answer(
                  what.tab,
                  what.dialog ?? "",
                  what.action === "dialog_accept",
                  what.text,
                  by.kind === "agent" ? by.id : undefined
                )
                yield* Effect.promise(() => sleep(SETTLING))
                const page = contentsOf(what.tab)
                if (!page) return yield* noTab(what.tab)
                return {
                  tab: what.tab,
                  url: page.getURL(),
                  title: page.getTitle(),
                  loading: page.isLoading(),
                  moved: true,
                  opened: [],
                  download: null,
                  touched: false,
                  dialog: dialogs.current(what.tab),
                }
              })
            }
            const pending = dialogs.current(what.tab)
            if (pending)
              return Effect.fail(
                new Refused({
                  code: "conflict",
                  message: `The page waits for dialog ${pending.id}. Take a snapshot and answer it first.`,
                })
              )
            return inTab(
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
                const dialog = dialogs.watch(what.tab)
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
                  if (shows) opens = dialogs.current(what.tab)
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
                  dialog: dialogs.current(what.tab) ?? opens,
                })
              }
            )
          }),
        waitFor: (wait, by) =>
          inTab(
            wait.tab,
            by,
            (tree) => stepOf(tree, wait),
            async (kept) => {
              const pending = dialogs.current(wait.tab)
              if (pending)
                throw new Refused({
                  code: "conflict",
                  message: `The page waits for dialog ${pending.id}. Answer it first.`,
                })
              await waitFor(kept.page, wait)
              return shown(wait.tab, kept, by.id)
            }
          ),
        release: (tab) =>
          Effect.suspend(() => {
            const driver = driving.get(tab)
            if (driver) {
              wait(tab, { agent: driver.agent, reason: "stopped" })
              tell(tab, null)
            }
            return RcMap.invalidate(held, tab)
          }),
        handoff: ({ tab, why }, by) =>
          // A Thread that waits there already hands nothing over.
          Effect.andThen(waiting(tab, by), () => {
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
            // The Person's turn: any drive there ends, and holds on the
            // tab stay for when they hand it back.
            if (driving.has(tab)) tell(tab, null)
            return Effect.void
          }),
        answered: (tab, agent) => Effect.sync(() => unwait(tab, agent)),
        allowed: (tab, agent, answer) =>
          Effect.gen(function* () {
            const was = waits.get(tab)?.get(agent)
            if (was?.reason !== "site") return false
            const { site } = was
            const rule = answer === "deny" ? "deny" : "allow"
            if (answer !== "once")
              yield* settings.write(BROWSER_FILE.name, siteKey(site), rule)
            answers.set(`${agent} ${site}`, rule)
            // Its waits for the site on other tabs end with this one.
            for (const [at, on] of waits) {
              const other = on.get(agent)
              if (other?.reason === "site" && other.site === site)
                unwait(at, agent)
            }
            return true
          }),
        settled: (agent) =>
          Effect.forEach(
            [...driving].filter(([, driver]) => driver.agent === agent),
            ([tab]) =>
              Effect.andThen(
                RcMap.invalidate(held, tab),
                Effect.sync(() => tell(tab, null))
              ),
            { discard: true }
          ),
      }
    })
  )
}
