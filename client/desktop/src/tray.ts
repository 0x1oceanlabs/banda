/**
 * Banda's icon in macOS's menu bar and its menu (ADR 0086, decision 4),
 * as menubar.ts says they are for each status: Electron's `Tray`, its
 * number as the title beside the icon, and a plain macOS menu built again
 * as its items change, not while it is open (`menuSetter`). Its icons
 * are drawn at 1x and 2x (icons/menu-bar/draw.mjs), and copied beside
 * main (build.mjs). A hat that asks is drawn in colour, its tiles in the
 * menu bar's own: light or dark as the system is.
 *
 * The same `Tray` is the icon in the tray on Linux, a StatusNotifierItem
 * a tray host draws, and in Windows' notification area (ADR 0136,
 * proposed in #1871):
 *
 * - **No number beside it:** only macOS writes a title. It is in the
 *   tooltip and the menu.
 * - **Its ink** is that of the bar it sits on, as `nativeTheme` says it:
 *   Windows' taskbar, which has a mode apart from its apps'; on Linux the
 *   desktop's colour scheme, which is not the bar's own stylesheet, and
 *   which the window's look sets while its mode is not the system's
 *   (os-window/material.ts).
 * - **A click opens the window.** On Windows that is a left click, and
 *   Electron opens the menu on a right one. On Linux the host decides:
 *   it tells Banda of an "activation", whichever gesture it takes for
 *   one, and asks for the menu and draws it itself.
 */
import { join } from "node:path"
import type { EngineStatus } from "@banda/contract"
import {
  app,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  type NativeImage,
  nativeTheme,
  systemPreferences,
  Tray,
} from "electron"
import {
  hasMenuBar,
  type Icon,
  iconOf,
  type Item,
  lookOf,
  menuOf,
  menuSetter,
  rowIconOf,
} from "./menubar"

/** Where the icons are, beside main. */
const ICONS = join(import.meta.dirname, "menu-bar")

/** Whether the window draws on no screen (`--ozone-platform=headless`):
 * there is no tray then (`hasMenuBar`). */
export const headless = (): boolean =>
  app.commandLine.getSwitchValue("ozone-platform") === "headless"

/** What the menu's items do. */
export type MenuBarDoes = {
  /** Open Banda: the window, brought to the front. */
  readonly open: () => void
  /** A row: the window, on Thread `thread` of `project`. */
  readonly openThread: (project: string, thread: string, title: string) => void
  /** Quit Banda, which asks first while Agents work (closing.ts). */
  readonly quit: () => void
}

/**
 * A tray kept in main alone, for the end-to-end tests, as the notices'
 * desktop is (`BANDA_DESKTOP`): their window has no screen, where
 * Electron's `Tray` cannot be (`hasMenuBar`). They pick its menu's
 * items (`does`) and say whether a tray host is there (`host`) through
 * `globalThis.bandaTray`.
 */
export type RecordedTray = { host: boolean; does?: MenuBarDoes }

/** The recorded tray, where the tests ask for one (`BANDA_TRAY=recorded`);
 * a packaged app ignores it. */
export const recordedTray: RecordedTray | null =
  !app.isPackaged && process.env.BANDA_TRAY === "recorded"
    ? ((globalThis as { bandaTray?: RecordedTray }).bandaTray = { host: true })
    : null

/** The icon of a recorded `tray`: it keeps what its menu's items do. */
export const recordedBar = (
  tray: RecordedTray,
  does: MenuBarDoes
): ReturnType<typeof menuBar> => {
  tray.does = does
  return { show: () => {}, destroy: () => delete tray.does }
}

/** Whether the app Electron runs has the icon (`hasMenuBar`), and so
 * follows the status for it. */
export const hasIcon = (): boolean =>
  recordedTray !== null || hasMenuBar(process.platform, headless())

/** Whether the bar the icon sits on is dark, and each change of it
 * (`listen`, which returns how to stop). */
type Bar = {
  readonly dark: () => boolean
  readonly listen: (changed: () => void) => () => void
}

/** The bar of `platform`. macOS's menu bar takes the system's
 * appearance, where the window's look sets only Banda's own; Windows'
 * taskbar and a Linux desktop are `nativeTheme`'s. */
function barOf(platform: NodeJS.Platform): Bar {
  if (platform === "darwin")
    return {
      dark: () =>
        systemPreferences.getUserDefault("AppleInterfaceStyle", "string") ===
        "Dark",
      listen: (changed) => {
        const watching = systemPreferences.subscribeNotification(
          "AppleInterfaceThemeChangedNotification",
          changed
        )
        return () => systemPreferences.unsubscribeNotification(watching)
      },
    }
  return {
    dark: () =>
      platform === "win32"
        ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
        : nativeTheme.shouldUseDarkColors,
    listen: (changed) => {
      nativeTheme.on("updated", changed)
      return () => void nativeTheme.removeListener("updated", changed)
    },
  }
}

/** The menu bar icon, or the tray's on `platform`, of the Banda named
 * `name`, whose own version is `version`; shown from now on, with no
 * status yet. */
export function menuBar(
  name: string,
  version: string,
  does: MenuBarDoes,
  platform: NodeJS.Platform
) {
  const mac = platform === "darwin"
  const bar = barOf(platform)
  const images = new Map<string, NativeImage>()
  const image = ({ file, template }: Icon) => {
    let made = images.get(file)
    if (!made) {
      // Its @2x beside it comes with it.
      made = nativeImage.createFromPath(join(ICONS, file))
      made.setTemplateImage(template)
      images.set(file, made)
    }
    return made
  }
  const icon = (status: EngineStatus | null) =>
    image(iconOf(lookOf(status).sign, bar.dark(), platform))

  let now: EngineStatus | null = null
  const tray = new Tray(icon(now))
  // A click opens macOS's menu; elsewhere it opens the window.
  if (mac) tray.setIgnoreDoubleClickEvents(true)
  else tray.on("click", () => does.open())

  const itemOf = (item: Item): MenuItemConstructorOptions => {
    switch (item.kind) {
      case "heading":
        return { type: "header", label: item.label }
      case "thread": {
        const mark = rowIconOf(item.state, platform)
        return {
          label: item.label,
          ...(item.sublabel !== undefined && { sublabel: item.sublabel }),
          ...(mark && { icon: image(mark) }),
          click: () => does.openThread(item.project, item.thread, item.title),
        }
      }
      case "line":
        return { label: item.label, enabled: false }
      case "separator":
        return { type: "separator" }
      case "open":
        return { label: item.label, click: () => does.open() }
      case "quit":
        return {
          label: item.label,
          // ⌘Q is the app menu's, which only macOS has (os-window/menus.ts).
          ...(mac && { accelerator: "Command+Q" }),
          click: () => does.quit(),
        }
    }
  }

  const menu = menuSetter((items: readonly Item[]) => {
    if (tray.isDestroyed()) return
    const made = Menu.buildFromTemplate(items.map(itemOf))
    made.on("menu-will-show", menu.opened)
    // Once the click it closed on has run, which comes next.
    made.on("menu-will-close", () => setTimeout(menu.closed, 0))
    tray.setContextMenu(made)
  })

  const draw = () => {
    if (tray.isDestroyed()) return
    const look = lookOf(now)
    tray.setImage(icon(now))
    if (mac) tray.setTitle(look.count, { fontType: "monospacedDigit" })
    tray.setToolTip(`${name}: ${look.said}`)
    menu.items(menuOf(now, name, version, platform))
  }
  draw()
  // The bar turns light or dark with the system.
  const unwatch = bar.listen(draw)

  return {
    /** Shows `status`, none while the follower says nothing. */
    show(status: EngineStatus | null) {
      now = status
      draw()
    },
    /** Takes the icon away. */
    destroy() {
      unwatch()
      tray.destroy()
    },
  }
}
