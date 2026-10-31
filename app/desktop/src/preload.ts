/** Gives the page its one bridge to the desktop (app/web/src/host.ts). */
import { contextBridge, ipcRenderer } from "electron"
import type { Host } from "@bandaso/web/host"

const host: Host = { engine: () => ipcRenderer.invoke("engine") }

contextBridge.exposeInMainWorld("bandaso", host)
