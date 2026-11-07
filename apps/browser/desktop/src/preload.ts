/** Electron replaces prompt() with an exception. This sandboxed shim
 * supplies its synchronous return value, and exposes no other API. */
import { contextBridge, ipcRenderer } from "electron"
import { PROMPT_CHANNEL } from "@banda/browser-pane/desktop"

contextBridge.exposeInMainWorld(
  "__bandaPrompt",
  (message: string, value: string) =>
    ipcRenderer.sendSync(PROMPT_CHANNEL, message, value)
)
contextBridge.executeInMainWorld({
  func: () => {
    const bridge = (
      window as unknown as {
        __bandaPrompt(message: string, value: string): string | null
      }
    ).__bandaPrompt
    window.prompt = (message = "", value = "") =>
      bridge(String(message), String(value))
  },
})
