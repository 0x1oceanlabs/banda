import { vi } from "vitest"
/** Electron's app: where downloads go, and the client certificates asked. */
const electron = vi.hoisted(() => ({ app: undefined as unknown }))
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  const app = Object.assign(new EventEmitter(), {
    getPath: () => "/home/person/Downloads",
  })
  electron.app = app
  return { app, ipcMain: new EventEmitter() }
})
import { EventEmitter } from "node:events"
import { agentsPartition, PARTITION } from "@banda/browser-pane/desktop"
import type { Ask } from "@banda/desktop-kit"
import type {
  Certificate,
  DownloadItem,
  Session,
  WebContents,
  WebPreferences,
} from "electron"
import { expect, it } from "vitest"
import { attaching, downloaded, keepCertificates, keepProfile } from "./profile"

const work = "0199a3c4-0000-7000-8000-000000000001"

type Answer = (granted: boolean) => void
type Request = (
  contents: unknown,
  permission: string,
  answer: Answer,
  details: { requestingUrl: string }
) => void

/** A profile as Electron's session is, in short: what is set up in it. */
function fakeProfile() {
  let agent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) banda/0.0.0 Chrome/140.0.7339.41 Electron/45.1.0 Safari/537.36"
  const handled = new Map<string, () => Response>()
  const events = new EventEmitter()
  const set: { check?: (...args: unknown[]) => boolean; request?: Request } = {}
  const profile = {
    getUserAgent: () => agent,
    setUserAgent: (next: string) => {
      agent = next
    },
    protocol: {
      handle: (scheme: string, handler: () => Response) =>
        handled.set(scheme, handler),
    },
    setPermissionCheckHandler: (check: (...args: unknown[]) => boolean) => {
      set.check = check
    },
    setPermissionRequestHandler: (request: Request) => {
      set.request = request
    },
    on: (event: string, listener: (...args: unknown[]) => void) =>
      events.on(event, listener),
  }
  return {
    profile: profile as unknown as Session,
    agent: () => agent,
    handled,
    events,
    set,
  }
}

/** A site's request of `permission` in `fake`, answered as `asked` says. */
const ask = (
  fake: ReturnType<typeof fakeProfile>,
  permission: string,
  site = "https://a.test/page"
) =>
  new Promise<boolean>((done) =>
    fake.set.request!({}, permission, done, { requestingUrl: site })
  )

it("every profile is kept alike, and an Agents' loads no file", async () => {
  for (const agents of [null, work]) {
    const fake = fakeProfile()
    const asks: Ask[] = []
    keepProfile(
      fake.profile,
      agents,
      () => null,
      async (asked) => {
        asks.push(asked)
        return true
      }
    )

    // Sites see Chrome.
    expect(fake.agent()).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36"
    )
    // What every site may do, what none may, and what the Person is
    // asked, once a site, in this profile; the question says whose tab.
    expect(await ask(fake, "fullscreen")).toBe(true)
    expect(await ask(fake, "hid")).toBe(false)
    expect(await ask(fake, "media")).toBe(true)
    expect(await ask(fake, "media")).toBe(true)
    expect(asks).toEqual([
      {
        message: "https://a.test wants to use your camera or microphone.",
        detail: agents === null ? "" : "It asks in a tab your Agents opened.",
        yes: "Allow",
        no: "Block",
      },
    ])
    expect(fake.set.check!({}, "media", "https://a.test")).toBe(true)
    expect(fake.set.check!({}, "media", "https://b.test")).toBe(false)

    // Downloads go to the Person's Downloads.
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => "notes.bin",
      setSavePath: (path: string) => (saved = path),
      getState: () => "progressing",
      getReceivedBytes: () => 0,
      getTotalBytes: () => 0,
    }) as unknown as DownloadItem
    let saved = ""
    fake.events.emit("will-download", {}, item)
    expect(saved).toBe("/home/person/Downloads/notes.bin")
    expect(downloaded(saved)).toBe(true)

    // An Agents' profile loads no file; the Person's does.
    const file = fake.handled.get("file")
    if (agents === null) expect(file).toBeUndefined()
    else expect(file?.().status).toBe(403)
  }
})

it("a page attaches only in a browser profile, at what that profile loads, kept apart from Banda", () => {
  const attach = (partition: string, src: string) => {
    const prefs: WebPreferences = { nodeIntegration: true }
    return { whose: attaching(prefs, { partition, src }), prefs }
  }
  const kept = {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    transparent: false,
    preload: expect.stringMatching(/\/browser-preload\.cjs$/),
  }
  const theirs = agentsPartition(work)
  for (const [partition, src, whose] of [
    [PARTITION, "https://a.test/", null],
    [PARTITION, "about:blank", null],
    [PARTITION, "file:///home/person/notes.html", null],
    [theirs, "https://a.test/", work],
    [theirs, "about:blank", work],
  ] as const) {
    const attached = attach(partition, src)
    expect(attached.whose, `${partition} ${src}`).toBe(whose)
    expect(attached.prefs).toEqual(kept)
  }
  for (const [partition, src] of [
    [theirs, "file:///home/person/notes.html"],
    [theirs, "about:settings"],
    [theirs, "chrome://settings"],
    ["persist:other", "https://a.test/"],
    ["", "https://a.test/"],
    ["persist:agents-work", "https://a.test/"],
    [`${theirs}x`, "https://a.test/"],
  ]) {
    const refused = attach(partition, src)
    expect(refused.whose, `${partition} ${src}`).toBeUndefined()
    expect(refused.prefs).toEqual({ nodeIntegration: true })
  }
})

it("an Agents' page shows a site no client certificate; the Person's picks as Chromium does", () => {
  const app = electron.app as EventEmitter
  const agents = { id: 1 } as WebContents
  const persons = { id: 2 } as WebContents
  const stop = keepCertificates((page) =>
    page === agents ? work : page === persons ? null : undefined
  )
  const certificate = {} as Certificate
  const asked = (page: WebContents | null) => {
    const event = { prevented: false, preventDefault: () => {} }
    event.preventDefault = () => void (event.prevented = true)
    const answers: unknown[][] = []
    app.emit(
      "select-client-certificate",
      event,
      page,
      "https://a.test/",
      [certificate],
      (...args: unknown[]) => answers.push(args)
    )
    return { prevented: event.prevented, answers }
  }
  expect(asked(agents)).toEqual({ prevented: true, answers: [[]] })
  expect(asked(persons)).toEqual({ prevented: false, answers: [] })
  expect(asked(null)).toEqual({ prevented: false, answers: [] })
  stop()
  expect(app.listenerCount("select-client-certificate")).toBe(0)
})
