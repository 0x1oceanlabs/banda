/**
 * The browser's desktop part (ADR 0013). The page shows browser pages in
 * `<webview>`s; here they are kept apart from Banda (decision 8): only the
 * browser's profile, sandboxed, with no preload and no Node. A site asks
 * the Person before it uses the camera, the location or another program;
 * downloads go to the Person's Downloads; Banda's Alt keys and the
 * browser's own go to the window instead of the page (decision 5). The
 * Pane hears of new tabs, icons and downloads as `BrowserNews`, and the
 * switch writes `browser.toml`.
 */
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join, parse } from "node:path"
import {
  app,
  type BrowserWindow,
  dialog,
  type DownloadItem,
  type PermissionRequest,
  session,
  shell,
  type WebContents,
} from "electron"
import {
  type BrowserNews,
  type Download,
  PARTITION,
  type Pressed,
  taken,
} from "@banda/browser-pane/desktop"
import { type Tabs, withTopKey } from "@banda/contract/look"
import TEMPLATE from "../../../look/browser.toml"
import { rewrite } from "./whole"

/** What a page may open: the web, a blank page and the Person's files. */
const OPENS = /^(https?|about|file):/i

/** Lets `contents`, Banda's page, show browser pages and nothing else. */
export function hostPages(contents: WebContents): void {
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
  })
  contents.on("did-attach-webview", (_event, page) => keep(page, contents))
}

function keep(page: WebContents, window: WebContents): void {
  const tell = (news: BrowserNews) => window.send("browser:news", news)
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
  page.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return
    const key: Pressed = {
      code: input.code,
      altKey: input.alt,
      ctrlKey: input.control,
      shiftKey: input.shift,
      metaKey: input.meta,
    }
    if (!taken(key)) return
    event.preventDefault()
    window.send("browser:key", key)
  })
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
 * go. `window` is the one a question shows over.
 */
export function keepProfile(window: () => BrowserWindow | null): void {
  const profile = session.fromPartition(PARTITION)
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
      void ask(window(), site, what, details).then((yes) => {
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
      window()?.webContents.send("browser:news", {
        kind: "download",
        download: downloadOf(id, path, item),
      } satisfies BrowserNews)
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

/** Shows a file Banda downloaded in its folder; nothing for any other. */
export function reveal(path: unknown): void {
  if (typeof path === "string" && saved.has(path)) shell.showItemInFolder(path)
}

/** Writes where the tabs are into `file`, a `browser.toml`, keeping every
 * other line; a file not there yet starts from Banda's template. */
export function writeTabs(file: string, where: unknown): void {
  if (where !== "top" && where !== "left")
    throw new Error(
      `The tabs go "top" or "left", not ${JSON.stringify(where)}.`
    )
  rewrite(file, TEMPLATE, (text) =>
    withTopKey(text, "tabs", where satisfies Tabs)
  )
}

async function ask(
  window: BrowserWindow | null,
  site: string,
  what: string,
  details: PermissionRequest
): Promise<boolean> {
  const options = {
    type: "question" as const,
    message: `${site} wants to ${what}.`,
    detail: "externalURL" in details ? String(details.externalURL ?? "") : "",
    buttons: ["Allow", "Block"],
    defaultId: 1,
    cancelId: 1,
  }
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return response === 0
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
