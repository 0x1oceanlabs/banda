/** Electron replaces prompt() with an exception. This sandboxed shim
 * supplies its synchronous return value, and exposes no other API. It
 * also tells main of the sideways swipes the page has no use for, which
 * the page itself cannot send. */
import { contextBridge, ipcRenderer } from "electron"
import {
  passSwipes,
  PROMPT_CHANNEL,
  SWIPE_CHANNEL,
} from "@banda/browser-pane/desktop"

passSwipes(window, ({ deltaX, deltaY }) =>
  ipcRenderer.send(SWIPE_CHANNEL, deltaX, deltaY)
)

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
