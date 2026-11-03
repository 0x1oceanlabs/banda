/**
 * The check before a Visual shows (ADR 0037, decision 3): main lays the
 * page out in a window of its own, never shown, as the Thread would show
 * it, and answers its height, its picture and what its console said.
 * Banda's window has Chromium already, so nothing is downloaded, as T3
 * Code's headless browser is.
 *
 * The window draws offscreen in a session of its own that keeps nothing,
 * with its sound off, no new windows, no permissions, and no way to
 * leave the page. The page is served there as the Thread's frame gets it
 * (visuals.ts), sandboxed by its response.
 */
import {
  lookedAt,
  type VisualLook,
  visualLookOf,
} from "@banda/agents-pane/visual"
import type { WindowRequest } from "@banda/contract"
import type { Fit, Fitting, LayOut, Previewed } from "@banda/contract/agents"
import { windowGround } from "@banda/contract/look"
import { Look, Refused } from "@banda/desktop-kit"
import { Effect } from "effect"
import { BrowserWindow, nativeTheme, session } from "electron"
import { fitted, Logs } from "./laid"
import { HEIGHT } from "./page"
import { pageResponse } from "./visuals"

/** How tall the window is as the page first lays out, as T3 Code's. */
const VIEWPORT = 800
/** The tallest page it pictures. */
const TALLEST = 4_000
/** The pages being laid out now, by the address's ID. */
const laying = new Map<string, string>()

/** The session the window lays pages out in, made on first use. */
let made: Electron.Session | undefined
function previews(): Electron.Session {
  if (made) return made
  // No `persist:`: it keeps nothing past Banda's run.
  made = session.fromPartition("banda-visual-preview")
  made.protocol.handle("app", async (request) => {
    const html = laying.get(new URL(request.url).pathname.slice(1))
    return html === undefined
      ? new Response("Not found", { status: 404 })
      : pageResponse(html)
  })
  made.setPermissionRequestHandler((_contents, _permission, answer) =>
    answer(false)
  )
  return made
}

/** Two frames, so what changed is painted. */
const PAINTED = `new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`

/** The page's height as its frame would say it, once its fonts are in
 * and two frames painted. */
const MEASURE = `document.fonts.ready
  .then(() => ${PAINTED})
  .then(() => { const root = document.documentElement; return ${HEIGHT} })`

/** A page loaded in a window never shown, at `width`, in `look`'s
 * colours, with what its console says. */
type Laid = { shown: BrowserWindow; page: Electron.WebContents; logs: Logs }

/** Loads `html` into a window never shown, gives it to `use`, and then
 * lets the window go. Past its time (`stopped`), the window goes, and
 * whatever waits on it fails. */
async function inWindow<T>(
  html: string,
  width: number,
  look: VisualLook,
  stopped: AbortSignal,
  use: (laid: Laid) => Promise<T>
): Promise<T> {
  const id = crypto.randomUUID()
  laying.set(id, html)
  const shown = new BrowserWindow({
    show: false,
    // The page has no ground of its own; the picture shows it on the
    // Thread's, as the Thread does.
    backgroundColor: windowGround(look.variables["--background"]),
    width,
    height: VIEWPORT,
    useContentSize: true,
    webPreferences: {
      session: previews(),
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  const page = shown.webContents
  stopped.addEventListener("abort", () => shown.destroy())
  try {
    page.setAudioMuted(true)
    page.setWindowOpenHandler(() => ({ action: "deny" }))
    page.on("will-navigate", (event) => event.preventDefault())
    const logs = new Logs()
    page.on("console-message", ({ level, message }) =>
      logs.hear(level, message)
    )
    await page.loadURL(lookedAt(`app://preview/${id}`, look))
    return await use({ shown, page, logs })
  } finally {
    laying.delete(id)
    if (!shown.isDestroyed()) shown.destroy()
  }
}

/** The check: the page's height, console and picture at `width`. */
async function checked(
  { shown, page, logs }: Laid,
  width: number
): Promise<Previewed> {
  const height: number = await page.executeJavaScript(MEASURE, true)
  shown.setContentSize(width, Math.max(1, Math.min(TALLEST, height)))
  await page.executeJavaScript(PAINTED, true)
  const taken = await page.capturePage()
  const size = taken.getSize()
  const fit = fitted(size.width, size.height)
  const picture =
    fit.width === size.width ? taken : taken.resize({ ...fit, quality: "good" })
  return {
    width,
    height,
    console: logs.said(),
    pictures: [{ mime: "image/png", data: picture.toPNG().toString("base64") }],
  }
}

/** The page's height at each of `widths`, in one window resized. */
async function measured(
  { shown, page }: Laid,
  widths: readonly number[]
): Promise<Fit[]> {
  const fits: Fit[] = []
  for (const width of widths) {
    shown.setContentSize(width, VIEWPORT)
    fits.push({ width, height: await page.executeJavaScript(MEASURE, true) })
  }
  return fits
}

/** Runs `work` as the road asks it, a failure said as a refusal. */
const refusing = <T>(work: (stopped: AbortSignal) => Promise<T>) =>
  Effect.tryPromise({
    try: work,
    catch: (error) =>
      new Refused({
        message: `The page could not be laid out: ${error instanceof Error ? error.message : String(error)}.`,
      }),
  })

/** The look main lays a page out in, light or dark. */
const lookFor = (dark: boolean) =>
  Look.use((look) => look.current).pipe(
    Effect.map((now) => visualLookOf(now, dark))
  )

/** What the agents module's engine part asks main to lay out; the engine
 * checked its params, and the road stops it past the engine's time. */
export const lay_out = (request: WindowRequest) =>
  Effect.gen(function* () {
    const asked = request.params as LayOut
    const look = yield* lookFor(asked.appearance === "dark")
    return yield* refusing((stopped) =>
      inWindow(asked.html, asked.width, look, stopped, (laid) =>
        checked(laid, asked.width)
      )
    )
  })

/** What it asks for a Visual it shows: its heights at several widths,
 * in the look the window shows now. */
export const heights = (request: WindowRequest) =>
  Effect.gen(function* () {
    const { html, widths } = request.params as Fitting
    const look = yield* lookFor(nativeTheme.shouldUseDarkColors)
    return yield* refusing((stopped) =>
      inWindow(html, widths[0] ?? VIEWPORT, look, stopped, (laid) =>
        measured(laid, widths)
      )
    )
  })
