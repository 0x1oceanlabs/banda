/**
 * The browser's desktop part (ADR 0013). The page shows browser pages in
 * `<webview>`s; here they are kept apart from Banda (decision 8): only the
 * browser's profile, sandboxed, with no preload and no Node. A site asks
 * the Person before it uses the camera, the location or another program;
 * downloads go to the Person's Downloads; Banda's Alt keys and the
 * browser's own go to the window instead of the page (decision 5). The
 * Pane hears of new tabs, icons and downloads as `BrowserNews`, and the
 * switch writes `browser.toml`. The blocker follows the look's
 * `blocker` (blocker.ts). All of it is the `Browser` service (ADR 0020).
 */
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join, parse } from "node:path"
import {
  BROWSER_BRIDGE,
  type BrowserNews,
  type Download,
  PARTITION,
  type Pressed,
  isAlt,
  taken,
} from "@banda/browser-pane/desktop"
import { BROWSER_FILE } from "@banda/contract/browser"
import { fileOf } from "@banda/contract/look"
import { Context, Effect, FiberSet, Layer, Schema, Stream } from "effect"
import {
  app,
  clipboard,
  Menu,
  type MenuItem,
  type DownloadItem,
  type PermissionRequest,
  session,
  shell,
  type WebContents,
} from "electron"
import { Blocker } from "./blocker"
import {
  type Answers,
  type Ask,
  type Broke,
  confirm,
  Look,
  type Refused,
  Settings,
  tellPage,
  text,
  Window,
} from "@banda/desktop-kit"
import { Cdp } from "./cdp"
import { BoxArg, Extensions } from "./extensions"
import { Tabs } from "./tabs"

/** What a page may open: the web, a blank page and the Person's files. */
const OPENS = /^(https?|about|file):/i

/** Changes `browser.toml`; refused when the value is not one it takes. */
type Changes = Effect.Effect<void, Refused | Broke>

export class Browser extends Context.Service<
  Browser,
  {
    /** Lets `contents`, Banda's page, show browser pages and nothing
     * else; the extensions hear of each page as a tab. */
    host(contents: WebContents): Effect.Effect<void>
    /** Shows the tabs on top of the pages or left of them. */
    tabs(where: "top" | "left"): Changes
    /** Pins the extension `id` to the browser's row, or takes it off. */
    pin(id: string, pinned: boolean): Changes
    /** Removes the extension `id`, once the Person says so, and its
     * button from the row. */
    remove(id: string): Changes
    /** Shows a file Banda downloaded in its folder; nothing for any
     * other. */
    reveal(path: string): Effect.Effect<void>
  }
>()("banda/Browser") {
  static readonly layer = Layer.effect(Browser)(
    Effect.gen(function* () {
      const extensions = yield* Extensions
      const tabs = yield* Tabs
      const window = yield* Window
      const settings = yield* Settings
      const look = yield* Look
      const blocker = new Blocker()
      // What a site's question runs stops with the layer.
      const run = yield* FiberSet.makeRuntimePromise()
      keepProfile(window.now, (asked) => run(confirm(window.now(), asked)))
      // The blocker follows browser.toml, a change at a time, in order.
      yield* Effect.forkScoped(
        look.changes.pipe(
          Stream.map((now) => fileOf(now.files, BROWSER_FILE).blocker),
          Stream.changes,
          Stream.runForEach((on) => Effect.promise(() => blocker.set(on)))
        )
      )
      const write = (key: string, value: unknown) =>
        settings.write("browser.toml", key, value)
      const pin = (id: string, pinned: boolean) =>
        Effect.gen(function* () {
          const files = yield* Look.part("files", "The browser's file")
          const browser = fileOf(files, BROWSER_FILE)
          const others = browser.pinned.filter((each) => each !== id)
          yield* write("pinned", pinned ? [...others, id] : others)
        }).pipe(Effect.provideService(Look, look))
      return {
        host: (contents) => Effect.sync(() => host(contents, tabs, extensions)),
        tabs: (where) => write("tabs", where),
        pin: (id, pinned) =>
          Effect.andThen(extensions.named(id), pin(id, pinned)),
        remove: (id) =>
          Effect.flatMap(extensions.remove(id), (removed) =>
            removed ? pin(id, false) : Effect.void
          ),
        reveal: (path) =>
          Effect.sync(() => {
            if (saved.has(path)) shell.showItemInFolder(path)
          }),
      }
    })
  )
}

function host(
  contents: WebContents,
  tabs: Tabs["Service"],
  extensions: Extensions["Service"]
): void {
  contents.on("will-attach-webview", (event, prefs, params) => {
    if (params.partition !== PARTITION || !OPENS.test(params.src)) {
      event.preventDefault()
      return
    }
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    // A page paints its own canvas, as in a browser: white unless it asks
    // for dark (#194). Transparent, it showed Banda's background under
    // black text.
    prefs.transparent = false
  })
  contents.on("did-attach-webview", (_event, page) => {
    const tell = (news: BrowserNews) =>
      tellPage(contents, BROWSER_BRIDGE.listen, news)
    tabs.attached(page)
    keys(page, contents)
    keep(page, tell, extensions)
  })
}

/** The user agent the browser's pages send: Chrome's (`keepProfile`). */
export function userAgent(): string {
  return session.fromPartition(PARTITION).getUserAgent()
}

/** Banda's Alt keys and the browser's own go to the window, from a page
 * and an extension's popup alike (decision 5). */
export function keys(page: WebContents, window: WebContents): void {
  page.on("before-input-event", (event, input) => {
    const key: Pressed = {
      code: input.code,
      altKey: input.alt,
      ctrlKey: input.control,
      shiftKey: input.shift,
      metaKey: input.meta,
    }
    // Alt pressed or let go stays the page's, and the window hears it too:
    // with it held, the mouse moves and sizes Panes over a page as well
    // (ADR 0025, decisions 5 and 6).
    if (isAlt(input.code)) {
      if (!input.isAutoRepeat) {
        tellPage(window, BROWSER_BRIDGE.key, {
          ...key,
          ...(input.type === "keyUp" && { up: true as const }),
        })
      }
      return
    }
    if (input.type !== "keyDown") return
    if (!taken(key)) return
    event.preventDefault()
    tellPage(window, BROWSER_BRIDGE.key, key)
  })
}

function keep(
  page: WebContents,
  tell: (news: BrowserNews) => void,
  extensions: Extensions["Service"]
): void {
  extensions.attached(page)
  page.on("context-menu", (_event, params) =>
    menuOf(page, params, tell, extensions).popup()
  )
  page.setWindowOpenHandler(({ url, disposition }) => {
    if (!OPENS.test(url)) return { action: "deny" }
    // A popup that needs its opener, as a sign-in, opens as a window of
    // its own; one of those opens nothing more.
    if (disposition === "new-window") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { autoHideMenuBar: true },
      }
    }
    // The rest is a tab, which the Pane opens beside the page's.
    const background = disposition === "background-tab"
    tell({ kind: "open", from: page.id, url, background })
    return { action: "deny" }
  })
  // A page names its icon again on each load: it is sent once.
  let named = ""
  page.on("page-favicon-updated", (_event, icons) => {
    const first = icons[0]
    if (!first || first === named) return
    named = first
    void iconOf(page, first).then((icon) => {
      if (icon && !page.isDestroyed())
        tell({ kind: "icon", from: page.id, icon })
    })
  })
  page.on("did-create-window", (popup) =>
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  )
}

/**
 * A page's menu, as Chrome's in short: the link, the picture, the words or
 * the field under the pointer, the way back and forward, the extensions'
 * own items, and Inspect.
 */
function menuOf(
  page: WebContents,
  params: Electron.ContextMenuParams,
  tell: (news: BrowserNews) => void,
  extensions: Extensions["Service"]
): Menu {
  const items: Electron.MenuItemConstructorOptions[][] = []
  const tab = (url: string) =>
    tell({ kind: "open", from: page.id, url, background: true })
  if (params.linkURL && OPENS.test(params.linkURL)) {
    items.push([
      { label: "Open Link in New Tab", click: () => tab(params.linkURL) },
      {
        label: "Copy Link Address",
        click: () => clipboard.writeText(params.linkURL),
      },
    ])
  }
  if (params.mediaType === "image" && OPENS.test(params.srcURL)) {
    items.push([
      { label: "Open Image in New Tab", click: () => tab(params.srcURL) },
      {
        label: "Copy Image",
        click: () => page.copyImageAt(params.x, params.y),
      },
    ])
  }
  const edit = params.editFlags
  if (params.isEditable) {
    items.push([
      { role: "undo", enabled: edit.canUndo },
      { role: "redo", enabled: edit.canRedo },
      { role: "cut", enabled: edit.canCut },
      { role: "copy", enabled: edit.canCopy },
      { role: "paste", enabled: edit.canPaste },
      { role: "selectAll", enabled: edit.canSelectAll },
    ])
  } else if (params.selectionText.trim()) {
    items.push([{ role: "copy" }])
  }
  const history = page.navigationHistory
  items.push([
    {
      label: "Back",
      enabled: history.canGoBack(),
      click: () => history.goBack(),
    },
    {
      label: "Forward",
      enabled: history.canGoForward(),
      click: () => history.goForward(),
    },
    { label: "Reload", click: () => page.reload() },
  ])
  const groups: (Electron.MenuItemConstructorOptions | MenuItem)[][] = [
    ...items,
    extensions.menuItems(page, params),
    [
      {
        label: "Inspect",
        click: () => page.inspectElement(params.x, params.y),
      },
    ],
  ]
  return Menu.buildFromTemplate(
    groups
      .filter((group) => group.length)
      .flatMap((group, i) => (i ? [{ type: "separator" }, ...group] : group))
  )
}

/** The largest icon Banda takes from a site. */
const ICON_BYTES = 64 * 1024

/** The icon at `url`, fetched in the page's profile, as a data URL. */
async function iconOf(page: WebContents, url: string): Promise<string | null> {
  try {
    if (url.startsWith("data:image/"))
      return url.length < ICON_BYTES ? url : null
    if (!/^https?:/i.test(url)) return null
    const answer = await page.session.fetch(url)
    const type = answer.headers.get("content-type") ?? ""
    if (!answer.ok || !type.startsWith("image/")) return null
    const bytes = Buffer.from(await answer.arrayBuffer())
    if (bytes.length > ICON_BYTES) return null
    return `data:${type};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}

/** What a site asks for, in the words of the question; the rest is no. */
const ASKED: Partial<Record<string, string>> = {
  media: "use your camera or microphone",
  geolocation: "know your location",
  notifications: "show notifications",
  "clipboard-read": "read your clipboard",
  "display-capture": "see your screen",
  midiSysex: "use your MIDI devices",
  openExternal: "open another program",
}

/** What every site may do without asking. */
const GIVEN = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
  "pointerLock",
  "keyboardLock",
])

/**
 * Sets up the browser's profile: what sites may do, and where downloads
 * go. `window` hears of downloads; `confirm` asks the Person.
 */
function keepProfile(
  window: Window["Service"]["now"],
  confirm: (ask: Ask) => Promise<boolean>
): void {
  const profile = session.fromPartition(PARTITION)
  // Sites see Chrome: some, as Google's sign-in, refuse what says Electron.
  const agent = profile.getUserAgent()
  const platform = /^Mozilla\/5\.0 \([^)]*\)/.exec(agent)?.[0]
  const chrome = /Chrome\/\S+/.exec(agent)?.[0]
  if (platform && chrome) {
    profile.setUserAgent(
      `${platform} AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
    )
  }
  // The Person's answers, by site and what it asked, until Banda restarts.
  const answers = new Map<string, boolean>()
  profile.setPermissionCheckHandler(
    (_contents, permission, origin) =>
      GIVEN.has(permission) || answers.get(`${origin} ${permission}`) === true
  )
  profile.setPermissionRequestHandler(
    (_contents, permission, answer, details) => {
      if (GIVEN.has(permission)) return answer(true)
      const what = ASKED[permission]
      if (!what) return answer(false)
      const site = originOf(details.requestingUrl)
      const key = `${site} ${permission}`
      const known = answers.get(key)
      if (known !== undefined) return answer(known)
      void confirm(question(site, what, details)).then((yes) => {
        answers.set(key, yes)
        answer(yes)
      })
    }
  )
  profile.on("will-download", (_event, item) => {
    const path = free(join(app.getPath("downloads"), item.getFilename()))
    item.setSavePath(path)
    saved.add(path)
    const id = randomUUID()
    const tell = () =>
      tellPage(window()?.webContents, BROWSER_BRIDGE.listen, {
        kind: "download",
        download: downloadOf(id, path, item),
      })
    // Chromium says it on every piece received: the row hears it at most
    // a few times a second, and always at the end.
    let told = 0
    tell()
    item.on("updated", () => {
      if (Date.now() - told < TELL_EVERY) return
      told = Date.now()
      tell()
    })
    item.once("done", tell)
  })
}

/** How often a running download is told of, in ms. */
const TELL_EVERY = 250

/** What Banda saved this run: the only files it shows in their folder. */
const saved = new Set<string>()

function downloadOf(id: string, path: string, item: DownloadItem): Download {
  const state = item.getState()
  return {
    id,
    name: parse(path).base,
    path,
    received: item.getReceivedBytes(),
    total: item.getTotalBytes(),
    state:
      state === "completed"
        ? "done"
        : state === "progressing"
          ? "running"
          : "failed",
  }
}

/** What a site's request asks the Person. */
function question(site: string, what: string, details: PermissionRequest): Ask {
  return {
    message: `${site} wants to ${what}.`,
    detail: "externalURL" in details ? String(details.externalURL ?? "") : "",
    yes: "Allow",
    no: "Block",
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

/** `path`, or `name (2).ext` and on, for a file not there yet. */
function free(path: string): string {
  const { dir, name, ext } = parse(path)
  let candidate = path
  for (let n = 2; existsSync(candidate); n++) {
    candidate = join(dir, `${name} (${n})${ext}`)
  }
  return candidate
}

const page = Schema.Tuple([Schema.Number])

/** How main answers the browser's channels (ADR 0028), which main takes
 * in through its `modules.ts` without naming them. */
export const browserAnswers: Answers<
  typeof BROWSER_BRIDGE,
  Browser | Extensions | Tabs | Cdp
> = {
  tabs: [
    Schema.Tuple([Schema.Literals(["top", "left"])]),
    ([where]) => Browser.use((browser) => browser.tabs(where)),
  ],
  reveal: [text, ([path]) => Browser.use((browser) => browser.reveal(path))],
  shown: [
    page,
    ([page]) => Extensions.use((extensions) => extensions.shown(page)),
  ],
  created: [
    Schema.Tuple([Schema.String, Schema.NullOr(Schema.Number)]),
    ([request, page]) => Tabs.use((tabs) => tabs.created(request, page)),
  ],
  stop: [page, ([page]) => Cdp.use((cdp) => cdp.stop(page))],
  pin: [
    Schema.Tuple([Schema.String, Schema.Boolean]),
    ([id, pinned]) => Browser.use((browser) => browser.pin(id, pinned)),
  ],
  remove: [text, ([id]) => Browser.use((browser) => browser.remove(id))],
  // What an extension's button sends.
  actions: {
    popup: [
      Schema.Tuple([Schema.String, Schema.String, BoxArg]),
      ([extension, url, under]) =>
        Extensions.use((extensions) => extensions.popup(extension, url, under)),
    ],
  },
}
