/** Gives the page its one bridge to the desktop (app/web/src/host.ts). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { BrowserNews, Pressed } from "@banda/browser-pane/desktop"
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
    listen: (listener) => {
      const heard = (_event: IpcRendererEvent, news: BrowserNews) =>
        listener(news)
      ipcRenderer.on("browser:news", heard)
      return () => {
        ipcRenderer.removeListener("browser:news", heard)
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

// A key the desktop took from a browser page is pressed in the window, so
// Banda's actions and the browser Pane hear it as their own (browser.ts).
ipcRenderer.on("browser:key", (_event, key: Pressed) => {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true })
  )
})
