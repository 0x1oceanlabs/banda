/** Gives the page its one bridge to the desktop (app/web/src/host.ts). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { Look } from "@bandaso/contract/look"
import type { Host, Notice } from "@bandaso/web/host"

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

contextBridge.exposeInMainWorld("bandaso", host)
