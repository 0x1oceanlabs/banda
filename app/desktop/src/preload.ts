/** Gives the page its one bridge to the desktop (app/web/src/host.ts). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { Look } from "@bandaso/contract/look"
import type { Host } from "@bandaso/web/host"

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
}

contextBridge.exposeInMainWorld("bandaso", host)
