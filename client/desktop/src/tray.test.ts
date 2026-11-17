import { sep } from "node:path"
import type { EngineStatus } from "@banda/contract"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** Electron, faked: the one tray made, what was done to it (`did`), the
 * last menu set, and what the system says of its bars. */
const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  type Template = Array<Record<string, unknown>>
  const state = {
    did: [] as string[],
    /** The tray's listeners, by event. */
    on: new Map<string, Listener>(),
    menu: null as Template | null,
    destroyed: false,
    /** Chromium's `--ozone-platform`. */
    ozone: "",
    /** `nativeTheme`'s listeners to `updated`. */
    updated: new Set<Listener>(),
    theme: { dark: false, taskbarDark: false },
    /** macOS's appearance, and who watches it. */
    mac: { dark: false, watchers: new Map<number, Listener>() },
  }
  /** A picture's name as the tray is given it: its file under
   * `menu-bar/`, and whether it is a template. */
  const named = (image: { file: string; template: boolean }) =>
    `${image.file}${image.template ? " (template)" : ""}`
  class Tray {
    constructor(image: { file: string; template: boolean }) {
      state.did.push(`icon ${named(image)}`)
    }
    on(event: string, listener: Listener) {
      state.on.set(event, listener)
      return this
    }
    isDestroyed() {
      return state.destroyed
    }
    setIgnoreDoubleClickEvents() {
      state.did.push("ignores double clicks")
    }
    setImage(image: { file: string; template: boolean }) {
      state.did.push(`image ${named(image)}`)
    }
    setTitle(title: string) {
      state.did.push(`title "${title}"`)
    }
    setToolTip(tip: string) {
      state.did.push(`tooltip "${tip}"`)
    }
    setContextMenu(menu: { template: Template }) {
      state.menu = menu.template
      state.did.push("menu")
    }
    destroy() {
      state.destroyed = true
      state.did.push("destroyed")
    }
  }
  return {
    state,
    module: {
      app: {
        commandLine: {
          getSwitchValue: (name: string) =>
            name === "ozone-platform" ? state.ozone : "",
        },
      },
      Tray,
      Menu: {
        buildFromTemplate: (template: Template) => ({ template, on: () => {} }),
      },
      nativeImage: {
        createFromPath: (path: string) => {
          const image = {
            file: path.slice(path.lastIndexOf("menu-bar") + 9),
            template: false,
            setTemplateImage: (template: boolean) => {
              image.template = template
            },
          }
          return image
        },
      },
      nativeTheme: {
        get shouldUseDarkColors() {
          return state.theme.dark
        },
        get shouldUseDarkColorsForSystemIntegratedUI() {
          return state.theme.taskbarDark
        },
        on: (_: string, listener: Listener) => void state.updated.add(listener),
        removeListener: (_: string, listener: Listener) =>
          void state.updated.delete(listener),
      },
      systemPreferences: {
        getUserDefault: () => (state.mac.dark ? "Dark" : undefined),
        subscribeNotification: (_: string, listener: Listener) => {
          state.mac.watchers.set(1, listener)
          return 1
        },
        unsubscribeNotification: (id: number) =>
          void state.mac.watchers.delete(id),
      },
    },
  }
})
vi.mock("electron", () => electron.module)

import { headless, menuBar } from "./tray"

const { state } = electron

/** What the menu's items did. */
const acted: string[] = []
const does = {
  open: () => void acted.push("open"),
  openThread: (project: string, thread: string, title: string) =>
    void acted.push(`thread ${project} ${thread} ${title}`),
  quit: () => void acted.push("quit"),
}

/** The icon on `platform`. */
const on = (platform: NodeJS.Platform) =>
  menuBar("Banda Dev", "0.4.0-dev.457", does, platform)

/** The files' names with the system's own separator, as Linux writes
 * them. */
const did = () => state.did.map((one) => one.split(sep).join("/"))

/** The system's theme changes. */
const themeChanges = () => {
  for (const listener of state.updated) listener()
}

const status: EngineStatus = {
  running: true,
  version: "0.4.0-dev.458",
  agents: {
    working: 1,
    asking: 1,
    failed: 0,
    done: 1,
    waiting: 2,
    threads: [
      {
        thread: "t1",
        title: "Pricing page copy",
        project: "p1",
        project_name: "bandaso-site",
        state: "asking",
      },
      {
        thread: "t2",
        title: "Sidebar for arc",
        project: "p2",
        project_name: "banda",
        state: "done",
      },
      {
        thread: "t3",
        title: "Fix tile resize",
        project: "p2",
        project_name: "banda",
        state: "working",
      },
    ],
  },
}

beforeEach(() => {
  state.did.length = 0
  state.on.clear()
  state.menu = null
  state.destroyed = false
  state.updated.clear()
  state.theme = { dark: false, taskbarDark: false }
  state.mac.dark = false
  state.mac.watchers.clear()
  acted.length = 0
})

describe("in macOS's menu bar, as before", () => {
  it("is a template with its number beside it, a second line under each row, and ⌘Q on Quit Banda; a click is the menu's", () => {
    const bar = on("darwin")
    bar.show(status)
    expect(did()).toEqual([
      "icon asleepTemplate.png (template)",
      "ignores double clicks",
      "image asleepTemplate.png (template)",
      'title ""',
      'tooltip "Banda Dev: Offline"',
      "menu",
      "image asking-light.png",
      'title "2"',
      'tooltip "Banda Dev: 2 your turn"',
      "menu",
    ])
    expect(state.on.has("click")).toBe(false)
    expect(
      state.menu?.map((item) => [item.type, item.label, item.sublabel])
    ).toEqual([
      ["header", "Your turn", undefined],
      [undefined, "Pricing page copy", "bandaso-site · Asks you"],
      [undefined, "Sidebar for arc", "banda · Done"],
      ["header", "Working", undefined],
      [undefined, "Fix tile resize", "banda · Working"],
      ["separator", undefined, undefined],
      [undefined, "Open Banda", undefined],
      ["separator", undefined, undefined],
      [undefined, "Banda Dev dev.458", undefined],
      [undefined, "Quit Banda", undefined],
    ])
    expect(state.menu?.at(-1)?.accelerator).toBe("Command+Q")
    expect(state.menu?.[4]?.icon).toMatchObject({ template: true })
  })

  it("takes the menu bar's colour from the system's appearance, not from the window's look", () => {
    state.theme = { dark: true, taskbarDark: true }
    const bar = on("darwin")
    bar.show(status)
    expect(did().at(-4)).toBe("image asking-light.png")
    state.mac.dark = true
    state.mac.watchers.get(1)?.()
    expect(did().at(-3)).toBe("image asking-dark.png")
    expect(state.updated.size).toBe(0)
    bar.destroy()
    expect(state.mac.watchers.size).toBe(0)
  })
})

describe.each(["linux", "win32"] as const)(
  "in the tray on %s (ADR 0136, proposed in #1871)",
  (platform) => {
    const kind = platform === "win32" ? "ico" : "png"
    /** The system's bar turns dark or light. */
    const bar = (dark: boolean) => {
      if (platform === "win32") state.theme.taskbarDark = dark
      else state.theme.dark = dark
      themeChanges()
    }

    it("is the sign alone: no number beside it, which is in the tooltip and the menu's first line", () => {
      on(platform).show(status)
      expect(did()).toEqual([
        `icon tray/asleep-light.${kind}`,
        `image tray/asleep-light.${kind}`,
        'tooltip "Banda Dev: Offline"',
        "menu",
        `image tray/asking-light.${kind}`,
        'tooltip "Banda Dev: 2 your turn"',
        "menu",
      ])
      expect(state.menu?.[0]).toEqual({
        label: "Your turn · 2",
        enabled: false,
      })
    })

    it("its rows are one line each, with no heading's type, no second line and no ⌘Q", () => {
      on(platform).show(status)
      expect(
        state.menu?.map((item) => item.label ?? `(${String(item.type)})`)
      ).toEqual([
        "Your turn · 2",
        "Pricing page copy · Asks you",
        "Sidebar for arc · Done",
        "Working · 1",
        "Fix tile resize · Working",
        "(separator)",
        "Open Banda",
        "(separator)",
        "Banda Dev dev.458",
        "Quit Banda",
      ])
      for (const item of state.menu ?? []) {
        expect(item).not.toHaveProperty("sublabel")
        expect(item).not.toHaveProperty("accelerator")
        expect(item.type === undefined || item.type === "separator").toBe(true)
      }
      // A mark in colour where the row calls; none on one that works.
      expect(state.menu?.[1]?.icon).toMatchObject({
        file: "row-asking.png",
        template: false,
      })
      expect(state.menu?.[4]).not.toHaveProperty("icon")
    })

    it("a click on the icon opens the window, as Open Banda does; the rows and Quit Banda do theirs", () => {
      on(platform).show(status)
      state.on.get("click")?.()
      const click = (label: string) =>
        (
          state.menu?.find((item) => item.label === label)?.click as
            (() => void) | undefined
        )?.()
      click("Open Banda")
      click("Sidebar for arc · Done")
      click("Quit Banda")
      expect(acted).toEqual([
        "open",
        "open",
        "thread p2 t2 Sidebar for arc",
        "quit",
      ])
      expect(did()).not.toContain("ignores double clicks")
    })

    it("takes the ink of the bar it sits on, and follows it as the system's theme changes", () => {
      const shown = on(platform)
      shown.show(status)
      state.did.length = 0
      bar(true)
      expect(did()[0]).toBe(`image tray/asking-dark.${kind}`)
      bar(false)
      expect(
        did()
          .filter((one) => one.startsWith("image"))
          .at(-1)
      ).toBe(`image tray/asking-light.${kind}`)
      // macOS's appearance is not asked.
      expect(state.mac.watchers.size).toBe(0)
      shown.destroy()
      expect(state.updated.size).toBe(0)
      expect(did().at(-1)).toBe("destroyed")
    })

    it("takes only its own bar's word: the taskbar's on Windows, the desktop's scheme on Linux", () => {
      // The other one says dark.
      if (platform === "win32") state.theme.dark = true
      else state.theme.taskbarDark = true
      on(platform)
      expect(did()[0]).toBe(`icon tray/asleep-light.${kind}`)
    })
  }
)

it("knows a window that draws on no screen by Chromium's own switch", () => {
  expect(headless()).toBe(false)
  state.ozone = "headless"
  expect(headless()).toBe(true)
  state.ozone = "wayland"
  expect(headless()).toBe(false)
  state.ozone = ""
})
