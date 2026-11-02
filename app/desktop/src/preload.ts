/** Gives the page its one bridge to the desktop (app/web/src/host.ts). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import {
  type BrowserNews,
  PARTITION,
  type Pressed,
} from "@banda/browser-pane/desktop"
import type { Look } from "@banda/contract/look"
import type { Host, Notice } from "@banda/web/host"

const host: Host = {
  engine: () => ipcRenderer.invoke("engine"),
  look: {
    current: () => ipcRenderer.invoke("look"),
    listen: (listener) => {
      const heard = (_event: IpcRendererEvent, look: Look) => listener(look)
      ipcRenderer.on("look", heard)
      return () => {
        ipcRenderer.removeListener("look", heard)
      }
    },
  },
  sidebar: {
    preset: (name) => ipcRenderer.invoke("sidebar.preset", name),
    edit: () => ipcRenderer.invoke("sidebar.edit"),
  },
  browser: {
    tabs: (where) => ipcRenderer.invoke("browser.tabs", where),
    reveal: (path) => ipcRenderer.send("browser.reveal", path),
    shown: (contents) => ipcRenderer.send("browser.shown", contents),
    created: (request, contents) =>
      ipcRenderer.send("browser.created", request, contents),
    pin: (extension, pinned) =>
      ipcRenderer.invoke("browser.pin", extension, pinned),
    remove: (extension) => ipcRenderer.invoke("browser.remove", extension),
    // electron-chrome-extensions answers these itself.
    actions: {
      state: () => extensions("browserAction.getState"),
      click: (extensionId, tabId) =>
        extensions("browserAction.activate", {
          eventType: "click",
          extensionId,
          tabId,
          anchorRect: { x: 0, y: 0, width: 0, height: 0 },
        }),
      popup: (extension, url, under) =>
        ipcRenderer.send("browser.popup", extension, url, under),
      listen: (listener) => {
        const heard = () => listener()
        ipcRenderer.on("browserAction.update", heard)
        void extensions("browserAction.addObserver")
        return () => {
          ipcRenderer.removeListener("browserAction.update", heard)
          void extensions("browserAction.removeObserver")
        }
      },
    },
    listen: (listener) => {
      const heard = (_event: IpcRendererEvent, news: BrowserNews) =>
        listener(news)
      ipcRenderer.on("browser:news", heard)
      return () => {
        ipcRenderer.removeListener("browser:news", heard)
      }
    },
  },
  settings: {
    open: (link) => ipcRenderer.send("settings.open", link ?? ""),
    set: (file, key, value) =>
      ipcRenderer.invoke("settings.set", file, key, value),
    reset: (file, key) => ipcRenderer.invoke("settings.reset", file, key),
    rename: (file, key, to) =>
      ipcRenderer.invoke("settings.rename", file, key, to),
    reveal: (file) => ipcRenderer.invoke("settings.reveal", file),
    themes: () => ipcRenderer.invoke("settings.themes"),
    listen: (go) => {
      const heard = (_event: IpcRendererEvent, link: string) => go(link)
      ipcRenderer.on("settings:open", heard)
      return () => {
        ipcRenderer.removeListener("settings:open", heard)
      }
    },
  },
  menu: {
    open: (route) => ipcRenderer.send("menu.open", route),
    listen: (open) => {
      const heard = (_event: IpcRendererEvent, route: string) => open(route)
      ipcRenderer.on("menu:open", heard)
      return () => {
        ipcRenderer.removeListener("menu:open", heard)
      }
    },
  },
  notify: {
    show: (notice: Notice) => ipcRenderer.send("notify:show", notice),
    withdraw: (key: string) => ipcRenderer.send("notify:withdraw", key),
    listen: (listener) => {
      const heard = (_event: IpcRendererEvent, key: string) => listener(key)
      ipcRenderer.on("notify:answer", heard)
      return () => {
        ipcRenderer.removeListener("notify:answer", heard)
      }
    },
    quiet: () => ipcRenderer.invoke("notify:quiet"),
  },
}

contextBridge.exposeInMainWorld("banda", host)

/** Asks electron-chrome-extensions about the browser's profile. */
function extensions(name: string, ...args: unknown[]) {
  return ipcRenderer.invoke("crx-msg-remote", PARTITION, name, ...args)
}

// A key the desktop took from a browser page is pressed in the window, so
// Banda's actions and the browser Pane hear it as their own (browser.ts).
ipcRenderer.on("browser:key", (_event, key: Pressed) => {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true })
  )
})
