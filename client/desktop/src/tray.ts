/**
 * Banda's icon in macOS's menu bar and its menu (ADR 0086, decision 4),
 * as menubar.ts says they are for each status: Electron's `Tray`, its
 * number as the title beside the icon, and a plain macOS menu built again
 * as its items change, not while it is open (`menuSetter`). Its icons
 * are drawn at 1x and 2x (icons/menu-bar/draw.mjs), and copied beside
 * main (build.mjs). A hat that asks is drawn in colour, its tiles in the
 * menu bar's own: light or dark as the system is. macOS alone: main makes
 * none elsewhere.
 */
import { join } from "node:path"
import type { EngineStatus } from "@banda/contract"
import {
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  type NativeImage,
  systemPreferences,
  Tray,
} from "electron"
import {
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

/** What the menu's items do. */
export type MenuBarDoes = {
  /** Open Banda: the window, brought to the front. */
  readonly open: () => void
  /** A row: the window, on Thread `thread` of `project`. */
  readonly openThread: (project: string, thread: string, title: string) => void
  /** Quit Banda, as ⌘Q is (closing.ts). */
  readonly quit: () => void
}

/** The menu bar icon of the Banda named `name`, whose own version is
 * `version`; shown from now on, with no status yet. */
export function menuBar(name: string, version: string, does: MenuBarDoes) {
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
  /** Whether the system's appearance is dark, which the menu bar takes;
   * the window's look sets only Banda's own. */
  const dark = () =>
    systemPreferences.getUserDefault("AppleInterfaceStyle", "string") === "Dark"

  let now: EngineStatus | null = null
  const tray = new Tray(image(iconOf(lookOf(now).sign, dark())))
  tray.setIgnoreDoubleClickEvents(true)

  const itemOf = (item: Item): MenuItemConstructorOptions => {
    switch (item.kind) {
      case "heading":
        return { type: "header", label: item.label }
      case "thread":
        return {
          label: item.label,
          sublabel: item.sublabel,
          icon: image(rowIconOf(item.state)),
          click: () => does.openThread(item.project, item.thread, item.title),
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
          accelerator: "Command+Q",
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
    tray.setImage(image(iconOf(look.sign, dark())))
    tray.setTitle(look.count, { fontType: "monospacedDigit" })
    tray.setToolTip(`${name}: ${look.said}`)
    menu.items(menuOf(now, name, version))
  }
  draw()
  // The menu bar turns light or dark with the system.
  const watching = systemPreferences.subscribeNotification(
    "AppleInterfaceThemeChangedNotification",
    draw
  )

  return {
    /** Shows `status`, none while the follower says nothing. */
    show(status: EngineStatus | null) {
      now = status
      draw()
    },
    /** Takes the icon away. */
    destroy() {
      systemPreferences.unsubscribeNotification(watching)
      tray.destroy()
    },
  }
}
