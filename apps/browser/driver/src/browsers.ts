/**
 * The Chromiums the driver runs and their tabs (ADR 0132, decisions 3
 * and 4): one headless shell per profile folder, a Project's, started by
 * Playwright over a pipe on the first tab opened in it, and closed a
 * while after its last tab closed. A tab's id counts up across them all.
 * The sandbox is on: only a test on a system that refuses it turns it
 * off, through `sandbox`, which the program never sets (main.ts).
 */
import { mkdirSync, openSync, closeSync, rmSync } from "node:fs"
import { basename, extname, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type {
  Dialog,
  ReadTab,
  Screenshot,
  SeenTab,
  Shown,
} from "@banda/contract/browser"
import {
  type BrowserContext,
  type CDPSession,
  chromium,
  type Download,
  type Page,
} from "playwright-core"
import { capture, captured } from "./capture"
import {
  actOf,
  addressOf,
  type Fields,
  invalid,
  tabOf,
  text,
  waitOf,
} from "./decode"
import { held, waitsFor } from "./dialogs"
import { act, timedOut, waitFor } from "./hands"
import { keyboard } from "./keys"
import { ANSWERING, during, go, HISTORY, read, SETTLING, shown } from "./page"
import { messageOf, noTab, Refusal } from "./refusal"

/** How long a profile's Chromium runs on once its last tab closed. */
const IDLE = 60_000

/** The size every page is laid out for and pictured at. */
const VIEWPORT = { width: 1280, height: 800 }

export type Options = {
  /** The headless shell's program. */
  chromium: string
  /** The id of the first tab opened; 1 when left out. */
  firstTab?: number
  /** How long a profile's Chromium runs on once its last tab closed, in
   * milliseconds: a minute, unless a test says. */
  idle?: number
  /** For tests alone, on a system that refuses Chromium's sandbox to the
   * program they run: false starts it without. Banda never does (ADR
   * 0132, decision 2). */
  sandbox?: boolean
}

/** What answers the driver's requests. */
export type Calls = {
  /** Does `method` with `params`, and answers what it gives: refused
   * with a `Refusal`. Calls on one tab run one after another, in the
   * order they came. */
  call(method: string, params: Fields): Promise<unknown>
  /** Closes every Chromium it started. */
  close(): Promise<void>
}

type Profile = {
  readonly folder: string
  readonly context: BrowserContext
  readonly tabs: Map<number, Tab>
  /** Where its pages' downloads go, as the last `open` said. */
  downloads: string
  /** The tabs being opened in it now: it does not quit under them. */
  opening: number
  quitting: NodeJS.Timeout | undefined
}

type Tab = {
  readonly id: number
  readonly page: Page
  readonly profile: Profile
  readonly dialogs: ReturnType<typeof held>
  /** Its own CDP session, for what the browser knows of it. */
  readonly session: () => Promise<CDPSession>
  /** Hears of each file it begins to download, by the path it is saved
   * at. */
  readonly downloading: Set<(path: string) => void>
  /** Its last call, which the next one waits for. */
  last: Promise<unknown>
}

/** A name in `folder` no file has, as `name` or with a number after it,
 * taken at once with an empty file: no download writes over another. */
function free(folder: string, name: string): string {
  mkdirSync(folder, { recursive: true })
  // Only the file's own name, whatever the site suggested.
  const plain = basename(name).replace(/^\.+$/, "") || "download"
  const end = extname(plain)
  const stem = plain.slice(0, plain.length - end.length)
  for (let n = 0; ; n++) {
    const path = join(folder, n ? `${stem} (${n})${end}` : plain)
    try {
      closeSync(openSync(path, "wx"))
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
}

/** What Playwright threw, as the Agent hears it. */
const refusal = (error: unknown) =>
  error instanceof Refusal ? error : new Refusal({ message: messageOf(error) })

export function browsers(options: Options, log = console.error): Calls {
  const idle = options.idle ?? IDLE
  let next = options.firstTab ?? 1
  /** Each profile's Chromium, by its folder, from when it starts. */
  const profiles = new Map<string, Promise<Profile>>()
  /** Each Chromium that quits now: its profile is not started again
   * until it has, as one folder is one Chromium's. */
  const quits = new Map<string, Promise<void>>()
  const tabs = new Map<number, Tab>()
  const pages = new WeakMap<Page, Tab>()

  const quit = (profile: Profile) => {
    clearTimeout(profile.quitting)
    profiles.delete(profile.folder)
    const gone = profile.context
      .close()
      .catch((error: unknown) => log(`browser-driver: ${messageOf(error)}`))
      .finally(() => {
        if (quits.get(profile.folder) === gone) quits.delete(profile.folder)
      })
    quits.set(profile.folder, gone)
    return gone
  }

  /** Lets `profile`'s Chromium quit once it had no tab for `idle`. */
  const rest = (profile: Profile) => {
    clearTimeout(profile.quitting)
    if (profile.tabs.size || profile.opening) return
    profile.quitting = setTimeout(() => void quit(profile), idle)
  }

  /** Saves `download` in the profile's folder for them, under a name no
   * file there has, and tells its tab where. */
  const save = (tab: Tab, download: Download) => {
    let path: string
    try {
      path = free(tab.profile.downloads, download.suggestedFilename())
    } catch (error) {
      log(`browser-driver: a download was not saved: ${messageOf(error)}`)
      return void download.cancel().catch(() => {})
    }
    for (const heard of tab.downloading) heard(path)
    download.saveAs(path).catch((error: unknown) => {
      rmSync(path, { force: true })
      log(`browser-driver: ${path} was not saved: ${messageOf(error)}`)
    })
  }

  /** `page` of `profile` as a tab: with the next id, when it is none
   * yet. */
  const keep = (profile: Profile, page: Page): Tab => {
    const kept = pages.get(page)
    if (kept) return kept
    let session: Promise<CDPSession> | undefined
    const tab: Tab = {
      id: next++,
      page,
      profile,
      dialogs: held(page),
      session: () => (session ??= profile.context.newCDPSession(page)),
      downloading: new Set(),
      last: Promise.resolve(),
    }
    pages.set(page, tab)
    tabs.set(tab.id, tab)
    profile.tabs.set(tab.id, tab)
    clearTimeout(profile.quitting)
    page.on("download", (download) => save(tab, download))
    page.on("close", () => {
      tabs.delete(tab.id)
      profile.tabs.delete(tab.id)
      rest(profile)
    })
    return tab
  }

  const start = async (folder: string, downloads: string) => {
    await quits.get(folder)
    const context = await chromium
      .launchPersistentContext(folder, {
        executablePath: options.chromium,
        headless: true,
        chromiumSandbox: options.sandbox ?? true,
        viewport: VIEWPORT,
        acceptDownloads: true,
        // Every permission a site asks for is refused: a machine has no
        // camera, place or program to give (ADR 0132, decision 4).
        permissions: [],
      })
      .catch((error: unknown) => {
        throw new Refusal({
          code: "internal",
          message: `Banda's browser for Agents did not start: ${messageOf(error)}`,
        })
      })
    // The page it starts with is no tab.
    await Promise.all(context.pages().map((page) => page.close()))
    const profile: Profile = {
      folder,
      context,
      tabs: new Map(),
      downloads,
      opening: 0,
      quitting: undefined,
    }
    // A page a page opens is a tab too.
    context.on("page", (page) => keep(profile, page))
    // A Chromium that went by itself took its tabs with it.
    context.on("close", () => {
      clearTimeout(profile.quitting)
      for (const id of profile.tabs.keys()) tabs.delete(id)
      profile.tabs.clear()
      const kept = profiles.get(folder)
      void kept?.then((running) => {
        if (running === profile && profiles.get(folder) === kept)
          profiles.delete(folder)
      })
    })
    return profile
  }

  /** The Chromium of the profile in `folder`, started if it does not
   * run. */
  const profileOf = (folder: string, downloads: string) => {
    let profile = profiles.get(folder)
    if (!profile) {
      profile = start(folder, downloads)
      profiles.set(folder, profile)
      const mine = profile
      profile.catch(() => {
        if (profiles.get(folder) === mine) profiles.delete(folder)
      })
    }
    return profile
  }

  /** The tab's title as the browser has it, which asks its page
   * nothing: a blank page has none. */
  const titleOf = async (tab: Tab) => {
    const session = await tab.session()
    const { targetInfo } = await session.send("Target.getTargetInfo")
    return targetInfo.title === "about:blank" ? "" : targetInfo.title
  }

  const history = (tab: Tab) => {
    const entries = async () => {
      const session = await tab.session()
      return session.send("Page.getNavigationHistory")
    }
    return {
      canGoBack: async () => (await entries()).currentIndex > 0,
      canGoForward: async () => {
        const { currentIndex, entries: all } = await entries()
        return currentIndex < all.length - 1
      },
    }
  }

  const seen = async (tab: Tab) => ({
    id: tab.id,
    url: tab.page.url(),
    title: await titleOf(tab).catch(() => ""),
  })

  /** The tab as it is left: no Person acts in a tab of the driver's yet,
   * so none touched it. */
  const left = (tab: Tab, changed: Partial<Shown> = {}) =>
    shown(tab.id, tab.page, tab.dialogs, () => titleOf(tab), changed)

  /** `work`, unless the tab's page opens a dialog first: a dialog stops
   * its page, and what waits on the page with it, so the dialog is then
   * the answer. */
  const unlessDialog = async <A>(
    tab: Tab,
    work: () => Promise<A>
  ): Promise<{ done: A } | { dialog: Dialog }> => {
    const now = tab.dialogs.current()
    if (now) return { dialog: now }
    const watch = tab.dialogs.watch()
    try {
      const working = work().then((done) => ({ done }))
      working.catch(() => {})
      return await Promise.race([
        working,
        watch.opened.then((dialog) => ({ dialog })),
      ])
    } finally {
      watch.stop()
    }
  }

  const open = async (params: Fields): Promise<Shown> => {
    const folder = resolve(text(params, "profile"))
    const downloads = resolve(text(params, "downloads"))
    const given = text(params, "url", true)
    const url = given === undefined ? undefined : addressOf(given)
    const profile = await profileOf(folder, downloads)
    profile.opening++
    clearTimeout(profile.quitting)
    try {
      profile.downloads = downloads
      const tab = keep(profile, await profile.context.newPage())
      if (!url) return await left(tab)
      try {
        await tab.page.goto(url, { waitUntil: "commit", timeout: ANSWERING })
      } catch (error) {
        // Its address may answer yet: the tab stays, still loading.
        if (timedOut(error)) return { ...(await left(tab)), loading: true }
        // A tab that went nowhere is no tab: the Agent hears why.
        await tab.page.close().catch(() => {})
        throw error
      }
      // A tab opened at an address has been nowhere before it: not at
      // the blank page Chromium made it with.
      const session = await tab.session()
      await session.send("Page.resetNavigationHistory")
      return await left(tab)
    } finally {
      profile.opening--
      rest(profile)
    }
  }

  const navigate = async (tab: Tab, to: string): Promise<Shown> => {
    const pending = tab.dialogs.current()
    if (pending) throw waitsFor(pending)
    await unlessDialog(tab, () =>
      go(tab.page, { tab: tab.id, to }, history(tab))
    )
    return left(tab)
  }

  const snapshot = async (tab: Tab): Promise<ReadTab> => {
    const { page } = tab
    const reading = await unlessDialog(tab, () => read(page))
    if ("done" in reading) return { ...reading.done, dialog: null }
    return {
      url: page.url(),
      title: await titleOf(tab),
      tree: "",
      errors: [],
      dialog: reading.dialog,
    }
  }

  const screenshot = async (tab: Tab): Promise<Screenshot> => {
    const shot = await captured(tab.page, tab.dialogs, capture, "Try again.")
    return { tab: tab.id, title: await titleOf(tab), ...shot }
  }

  const acted = async (tab: Tab, what: ReturnType<typeof actOf>) => {
    const { page, dialogs, profile } = tab
    if (what.action === "dialog_accept" || what.action === "dialog_dismiss") {
      await dialogs.answer(
        what.dialog ?? "",
        what.action === "dialog_accept",
        what.text
      )
      await sleep(SETTLING)
      if (page.isClosed()) throw noTab(tab.id)
      // The page runs again, unless its answer opened another dialog.
      const state = await unlessDialog(tab, () =>
        page.evaluate(() => document.readyState).catch(() => "loading")
      )
      return {
        tab: tab.id,
        url: page.url(),
        title: await titleOf(tab),
        loading: "done" in state && state.done !== "complete",
        moved: true,
        opened: [],
        download: null,
        touched: false,
        dialog: dialogs.current(),
      } satisfies Shown
    }
    const pending = dialogs.current()
    if (pending) throw waitsFor(pending, "Take a snapshot and answer it first.")
    const before = new Set(profile.tabs.keys())
    let download: string | null = null
    const downloading = (path: string) => (download = path)
    tab.downloading.add(downloading)
    let moved: boolean
    try {
      moved = await during(page, dialogs, () => act(page, keyboard(page), what))
    } finally {
      tab.downloading.delete(downloading)
    }
    const opened: SeenTab[] = await Promise.all(
      [...profile.tabs.values()]
        .filter((other) => !before.has(other.id))
        .map(async (other) => ({
          ...(await seen(other)),
          driven: false,
          lent: false,
        }))
    )
    return left(tab, { moved, opened, download })
  }

  const waited = async (tab: Tab, wait: ReturnType<typeof waitOf>) => {
    const pending = tab.dialogs.current()
    if (pending) throw waitsFor(pending)
    await unlessDialog(tab, () => waitFor(tab.page, wait))
    return left(tab)
  }

  /** The tab `params` names. */
  const named = (params: Fields) => {
    const id = tabOf(params)
    const tab = tabs.get(id)
    if (!tab) throw noTab(id)
    return tab
  }

  /** `work` in `tab`, once its calls before this one are done. */
  const inTurn = <A>(tab: Tab, work: () => Promise<A>): Promise<A> => {
    const turn = tab.last.then(work)
    tab.last = turn.catch(() => {})
    return turn
  }

  /** Decodes what `method` needs of `params` now, as the call comes, and
   * takes its place in its tab's turn; the work itself comes later. */
  const begin = (method: string, params: Fields): Promise<unknown> => {
    switch (method) {
      case "open":
        text(params, "by")
        return open(params)
      case "navigate": {
        const tab = named(params)
        const to = text(params, "to")
        text(params, "by")
        if (!HISTORY.has(to)) addressOf(to)
        return inTurn(tab, () => navigate(tab, to))
      }
      case "snapshot": {
        const tab = named(params)
        text(params, "by")
        return inTurn(tab, () => snapshot(tab))
      }
      case "screenshot": {
        const tab = named(params)
        text(params, "by")
        return inTurn(tab, () => screenshot(tab))
      }
      case "act": {
        const what = actOf(params)
        const tab = named(params)
        text(params, "by")
        return inTurn(tab, () => acted(tab, what))
      }
      case "wait_for": {
        const wait = waitOf(params)
        const tab = named(params)
        text(params, "by")
        return inTurn(tab, () => waited(tab, wait))
      }
      case "tabs": {
        const folder = resolve(text(params, "profile"))
        const profile = profiles.get(folder)
        if (!profile) return Promise.resolve([])
        return profile.then(
          ({ tabs }) => Promise.all([...tabs.values()].map(seen)),
          () => []
        )
      }
      case "where": {
        const tab = named(params)
        return Promise.resolve({
          url: tab.page.url(),
          profile: tab.profile.folder,
        })
      }
      case "close": {
        // Not in its tab's turn: closing a tab ends what waits in it.
        const tab = named(params)
        return tab.page.close().then(() => null)
      }
      default:
        throw invalid(`The driver has no method "${method}".`)
    }
  }

  return {
    call: async (method, params) => {
      try {
        return await begin(method, params)
      } catch (error) {
        throw refusal(error)
      }
    },
    close: async () => {
      const starting = [...profiles.values()]
      await Promise.all(starting.map((profile) => profile.then(quit, () => {})))
      await Promise.all(quits.values())
    },
  }
}
