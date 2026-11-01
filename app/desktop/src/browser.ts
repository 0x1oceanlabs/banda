/**
 * The browser's desktop part (ADR 0013). The page shows browser pages in
 * `<webview>`s; here they are kept apart from Banda (decision 8): only the
 * browser's profile, sandboxed, with no preload and no Node. A site asks
 * the Person before it uses the camera, the location or another program;
 * downloads go to the Person's Downloads; Banda's Alt keys and the
 * browser's own go to the window instead of the page (decision 5).
 */
import { existsSync } from "node:fs"
import { join, parse } from "node:path"
import {
  app,
  type BrowserWindow,
  dialog,
  type PermissionRequest,
  session,
  type WebContents,
} from "electron"
import { PARTITION, type Pressed, taken } from "@banda/browser-pane/desktop"

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
    // Until there are tabs, a page meant for a new tab opens in place.
    void page.loadURL(url).catch(() => undefined)
    return { action: "deny" }
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
    item.setSavePath(free(join(app.getPath("downloads"), item.getFilename())))
  })
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
