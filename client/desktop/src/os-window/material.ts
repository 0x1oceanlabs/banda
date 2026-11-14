/**
 * The windows' material and frame: what a window that shows Banda's page
 * is made of, and how it follows the look from then on. Where the look
 * asks for the system's glass, the main window lets the system's material
 * through (ADR 0023, ADR 0030); on macOS it draws its own title bar, and
 * the system's window buttons sit in it; and each window paints the
 * look's first colour before its page draws, and hears each look, as it
 * can show it. The bridge's `look` and `frame` are answered here.
 *
 * A part of the device's window (ADR 0089, decision 9): the windows are
 * made through it (`Material.open`), so it is a service. It follows the
 * look in its layer's scope, until main's runtime is disposed.
 */
import { BANDA, type Look as LookValue } from "@banda/contract/look"
import { type Answers, Look, none, tellPage } from "@banda/desktop-kit"
import { Context, Effect, Layer, Stream } from "effect"
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  nativeTheme,
} from "electron"
import { BRIDGE } from "../bridge"
import { firstFrame } from "../look"

/**
 * How a window lets the system's material through (ADR 0030): vibrancy
 * under the whole window on macOS, acrylic on Windows 11 from 22H2 (build
 * 22621), and on Linux a transparent window for the compositor to blur.
 * Windows 10 has no material: `null`, and the desk is solid there.
 * `made` is what the window is made with; `set` changes it while the
 * window shows, so the glass follows the look, even one that comes after
 * the window opened, as on a Mac's first start. Linux's transparent window
 * is made once: turning it on shows from the next start. `version` is the
 * system's, asked on Windows alone.
 */
export function systemMaterial(
  platform: NodeJS.Platform,
  version: () => string
): {
  made: BrowserWindowConstructorOptions
  set?: (shown: BrowserWindow, on: boolean) => void
} | null {
  return platform === "darwin"
    ? {
        made: { vibrancy: "under-window" },
        set: (shown, on) => shown.setVibrancy(on ? "under-window" : null),
      }
    : platform !== "win32"
      ? { made: { transparent: true } }
      : Number(version().split(".")[2]) >= 22621
        ? {
            made: { backgroundMaterial: "acrylic" },
            set: (shown, on) =>
              shown.setBackgroundMaterial(on ? "acrylic" : "none"),
          }
        : null
}

/** The background of a window that lets the system's material through. */
const CLEAR = "#00000000"

/**
 * On macOS the window draws its own title bar (ADR 0030): the system's is
 * hidden, and its window buttons sit at the start of Banda's bar, in the
 * middle of its height, `INSET` px with the room around them.
 */
const BUTTONS = { x: 12, width: 54, height: 14 }
export const INSET = 2 * BUTTONS.x + BUTTONS.width
/** Banda's bar's height before the first look comes. */
const BAR_HEIGHT = Number.parseFloat(BANDA.light["bar-height"])

/** Where the window buttons sit, for a bar as high as the look says. */
export function buttonsAt(now: LookValue | null): { x: number; y: number } {
  const bar = Number.parseFloat(now?.vars["--bar-height"] ?? "") || BAR_HEIGHT
  return { x: BUTTONS.x, y: Math.round((bar - BUTTONS.height) / 2) }
}

/** The look asks for the system's glass. */
function systemGlass(now: LookValue | null): boolean {
  return now?.desk.glass === true && now.desk.material === "system"
}

export class Material extends Context.Service<
  Material,
  {
    /**
     * Makes a window that shows Banda's page: `make` is handed what the
     * look and the system make it with (its first colour or the system's
     * material, and the main window's frame), and the window it makes
     * follows the look until it is closed. `main` is the main window: the
     * one that lets the system's material through and draws its own title
     * bar; a Pane's own window is solid, in the system's frame.
     */
    readonly open: (
      main: boolean,
      make: (made: BrowserWindowConstructorOptions) => BrowserWindow
    ) => Effect.Effect<BrowserWindow>
    /** The last look as `shown` can show it (`lookIn`); none before the
     * first. */
    readonly lookIn: (
      shown: BrowserWindow | null
    ) => Effect.Effect<LookValue | null>
    /** The room the window buttons take at the bar's start (`frame`):
     * none in full screen, and `null` where the system draws the frame, as
     * it does for a Pane's own window. */
    readonly insetOf: (
      shown: BrowserWindow | null
    ) => Effect.Effect<number | null>
  }
>()("banda/Material") {
  /** The material of the system Electron runs on; a test names another. */
  static readonly layer = (
    platform: NodeJS.Platform = process.platform,
    version: () => string = () => process.getSystemVersion()
  ) =>
    Layer.effect(Material)(
      Effect.gen(function* () {
        const look = yield* Look
        const material = systemMaterial(platform, version)
        const ownFrame = platform === "darwin"
        /** The main window, while it is open. */
        let main: BrowserWindow | null = null
        /** The window that lets the desktop through, if one does (ADR
         * 0023). */
        let clear: BrowserWindow | null = null
        /** The windows that show the page, the main one and each Pane's
         * own. */
        const windows = new Set<BrowserWindow>()

        const insetOf = (shown: BrowserWindow | null): number | null => {
          if (!ownFrame || !shown || shown !== main) return null
          return shown.isFullScreen() ? 0 : INSET
        }

        /** The look as `shown` can show it. The system's glass shows only
         * where the window lets the desktop through, so a solid window's
         * page paints itself; Banda's own glass shows in every window
         * (ADR 0023). */
        const lookIn = (
          shown: BrowserWindow | null,
          now: LookValue
        ): LookValue =>
          systemGlass(now) && (material === null || shown !== clear)
            ? { ...now, desk: { ...now.desk, glass: false } }
            : now

        const listen = (now: LookValue) => {
          // Native parts (scrollbars, menus) and the page's own
          // prefers-color-scheme follow the look's mode.
          nativeTheme.themeSource = now.mode
          const background = firstFrame(now, nativeTheme.shouldUseDarkColors)
          // The main window's material follows the look where it can; a
          // Pane's own window is solid.
          const glass = systemGlass(now)
          const set = material?.set
          if (main && ownFrame) main.setWindowButtonPosition(buttonsAt(now))
          if (main && set && glass !== (main === clear)) {
            clear = glass ? main : null
            set(main, glass)
            if (glass) main.setBackgroundColor(CLEAR)
          }
          for (const shown of windows) {
            if (background && shown !== clear)
              shown.setBackgroundColor(background)
            tellPage(shown.webContents, BRIDGE.look.listen, lookIn(shown, now))
          }
        }
        // Electron's own parts are asked nothing before the app is ready,
        // as when main's root listened from `ready`.
        yield* Effect.forkScoped(
          Effect.promise(() => app.whenReady()).pipe(
            Effect.andThen(
              look.changes.pipe(
                Stream.runForEach((now) => Effect.sync(() => listen(now)))
              )
            )
          )
        )

        return {
          open: (isMain, make) =>
            Effect.map(look.current, (now) => {
              // The system's glass lets its material through (ADR 0023,
              // ADR 0030).
              const glass = isMain && material !== null && systemGlass(now)
              const opened = make({
                ...(isMain &&
                  ownFrame && {
                    titleBarStyle: "hidden",
                    trafficLightPosition: buttonsAt(now),
                  }),
                ...(glass ? material?.made : {}),
                backgroundColor: glass
                  ? CLEAR
                  : ((now &&
                      firstFrame(now, nativeTheme.shouldUseDarkColors)) ??
                    (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff")),
              })
              windows.add(opened)
              if (isMain) main = opened
              if (glass) clear = opened
              if (isMain && ownFrame) {
                // In full screen the system hides the window buttons: the
                // bar takes back their room.
                const tellFrame = () =>
                  tellPage(
                    opened.webContents,
                    BRIDGE.frame.listen,
                    insetOf(opened)
                  )
                opened.on("enter-full-screen", tellFrame)
                opened.on("leave-full-screen", tellFrame)
              }
              opened.on("closed", () => {
                windows.delete(opened)
                if (main === opened) main = null
                if (clear === opened) clear = null
              })
              return opened
            }),
          lookIn: (shown) =>
            Effect.map(look.current, (now) => (now ? lookIn(shown, now) : now)),
          insetOf: (shown) => Effect.sync(() => insetOf(shown)),
        }
      })
    )
}

/** Main's answers to the page's channels of `look`. */
export const lookAnswers: Answers<typeof BRIDGE.look, Material> = {
  current: [
    none,
    (_, event) =>
      Material.use((material) =>
        material.lookIn(BrowserWindow.fromWebContents(event.sender))
      ),
  ],
}

/** Main's answers to the page's channels of `frame`. */
export const frameAnswers: Answers<typeof BRIDGE.frame, Material> = {
  current: [
    none,
    (_, event) =>
      Material.use((material) =>
        material.insetOf(BrowserWindow.fromWebContents(event.sender))
      ),
  ],
}
