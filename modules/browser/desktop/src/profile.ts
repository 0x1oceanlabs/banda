/**
 * The browser's profiles (ADR 0013, decision 8): the Person's, and one of
 * each Project's Agents, apart from it (ADR 0083, decision 4). Each is
 * kept alike. A page attaches only in one of them, sandboxed, with no Node
 * and no preload but the prompt's, at an address its profile loads. Sites
 * see Chrome; a site asks the Person before it uses the camera, the
 * location or another program, and the answer holds in that profile;
 * downloads go to the Person's Downloads. An Agents' profile loads the web
 * alone, never a file, and shows a site none of the Person's client
 * certificates.
 */
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join, parse } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProjectId } from "@banda/contract"
import {
  BROWSER_BRIDGE,
  type Download,
  opens,
  whosePartition,
} from "@banda/browser-pane/desktop"
import { type Ask, tellPage, type Window } from "@banda/desktop-kit"
import {
  app,
  type Certificate,
  type DownloadItem,
  type PermissionRequest,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron"

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
 * Whose the page Banda's page attaches is, as its `params` say, with
 * `prefs` made the browser's own: the Project whose Agents' profile it
 * loads in, or `null` for the Person's. None for a page of no browser
 * profile, or at an address its profile does not load: it does not
 * attach.
 */
export function attaching(
  prefs: WebPreferences,
  params: Record<string, string>
): ProjectId | null | undefined {
  const agents = whosePartition(params.partition ?? "")
  if (agents === undefined || !opens(params.src ?? "", agents)) return
  prefs.preload = fileURLToPath(
    new URL("./browser-preload.cjs", import.meta.url)
  )
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.sandbox = true
  prefs.webSecurity = true
  // A page paints its own canvas, as in a browser: white unless it asks
  // for dark (#194). Transparent, it showed Banda's background under
  // black text.
  prefs.transparent = false
  return agents
}

/**
 * Sets up `profile`, the browser's profile whose pages are those of the
 * Agents of `agents`, or the Person's when `null`: what sites may do, and
 * where downloads go. `window` hears of downloads; `confirm` asks the
 * Person. The Person's answers to a site hold in the profile they gave
 * them in.
 */
export function keepProfile(
  profile: Session,
  agents: ProjectId | null,
  window: Window["Service"]["now"],
  confirm: (ask: Ask) => Promise<boolean>
): void {
  // Sites see Chrome: some, as Google's sign-in, refuse what says Electron.
  const agent = profile.getUserAgent()
  const platform = /^Mozilla\/5\.0 \([^)]*\)/.exec(agent)?.[0]
  const chrome = /Chrome\/\S+/.exec(agent)?.[0]
  if (platform && chrome) {
    profile.setUserAgent(
      `${platform} AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
    )
  }
  // An Agents' page loads the web alone: no file, by any way it is asked.
  if (agents !== null)
    profile.protocol.handle(
      "file",
      () => new Response("An Agents' tab loads no file.", { status: 403 })
    )
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
      void confirm(question(site, what, details, agents)).then((yes) => {
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

/**
 * Answers a site that asks a page for a client certificate: an Agents'
 * page shows none, as the Person's certificates are theirs alone; the
 * Person's own picks as Chromium does. `whose` says whose a page is.
 * Returns how to stop.
 */
export function keepCertificates(
  whose: (page: WebContents) => ProjectId | null | undefined
): () => void {
  const asked = (
    event: Electron.Event,
    page: WebContents | null,
    _url: string,
    _list: Certificate[],
    answer: (certificate?: Certificate) => void
  ) => {
    if (!page || !whose(page)) return
    event.preventDefault()
    answer()
  }
  app.on("select-client-certificate", asked)
  return () => app.off("select-client-certificate", asked)
}

/** Whether Banda saved `path` this run: the only files it shows in their
 * folder. */
export function downloaded(path: string): boolean {
  return saved.has(path)
}

/** How often a running download is told of, in ms. */
const TELL_EVERY = 250

/** What Banda saved this run. */
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

/** What a site's request asks the Person, in a tab of the Agents of
 * `agents` or of theirs. */
function question(
  site: string,
  what: string,
  details: PermissionRequest,
  agents: ProjectId | null
): Ask {
  const external =
    "externalURL" in details ? String(details.externalURL ?? "") : ""
  const whose = agents === null ? "" : "It asks in a tab your Agents opened."
  return {
    message: `${site} wants to ${what}.`,
    detail: [whose, external].filter(Boolean).join("\n"),
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
